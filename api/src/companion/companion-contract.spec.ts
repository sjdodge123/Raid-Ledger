/**
 * ROK-1954 — Companion envelope v1 + `bg3-save` v1 conformance and drift
 * guard. Raid Ledger owns the Companion wire format
 * (`packages/contract/companion/`):
 * - C1/C2 every golden `fixtures/*.json` parses with its schema;
 * - C3 every `fixtures/invalid/*.json` is rejected — never thrown — with the
 *   issue path + code listed in `fixtures/invalid/EXPECTED.json`;
 * - C4 each anonymised raw `saveinfo/<case>.saveinfo.json` normalises to the
 *   golden `<case>.json` payload;
 * - C5 the fixtures and docs stay anonymised; C6 the placeholder WebP matches
 *   the golden thumbnail ref and is a flat single-colour image;
 * - C7 each committed `schema.json` equals a fresh generation (fix drift with
 *   `npm run build -w packages/contract && node
 *   packages/contract/scripts/gen-companion-schemas.mjs`); C8 the bg3 schema
 *   keeps `additionalProperties: false` on every object.
 * Lives in the api (like `valheim-link-contract.spec.ts`) because the
 * contract workspace has no Node types for reading fixture files.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import {
  Bg3SaveInfoRawSchema,
  Bg3SaveMessageSchema,
  CompanionEnvelopeSchema,
  lookupCompanionContract,
  normaliseBg3SaveInfo,
  serializeBg3SaveJsonSchema,
  serializeCompanionEnvelopeJsonSchema,
  type Bg3SaveMessage,
} from '@raid-ledger/contract';

const ROOT = join(__dirname, '../../../packages/contract/companion');
const ENV_V1 = join(ROOT, 'envelope', 'v1');
const BG3_V1 = join(ROOT, 'bg3-save', 'v1');
const ENV_FIX = join(ENV_V1, 'fixtures');
const BG3_FIX = join(BG3_V1, 'fixtures');
const SAVEINFO = join(BG3_FIX, 'saveinfo');
const RAW_SUFFIX = '.saveinfo.json';

const read = (dir: string, file: string): string =>
  readFileSync(join(dir, file), 'utf8');
const readJson = (dir: string, file: string): unknown =>
  JSON.parse(read(dir, file));
const namesIn = (dir: string): string[] =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'EXPECTED.json')
    .map((f) => f.slice(0, -'.json'.length))
    .sort();
const rawNames = (): string[] =>
  readdirSync(SAVEINFO)
    .filter((f) => f.endsWith(RAW_SUFFIX))
    .map((f) => f.slice(0, -RAW_SUFFIX.length))
    .sort();
const bg3Fixture = (name: string): Bg3SaveMessage =>
  Bg3SaveMessageSchema.parse(readJson(BG3_FIX, `${name}.json`));

/** Every file under `dir`, recursively, as a path relative to `dir`. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name));
}

/** Own property `key` of a JSON object node; fails loudly when absent. */
function prop(node: unknown, key: string): unknown {
  if (typeof node !== 'object' || node === null || !(key in node)) {
    throw new Error(`schema node has no "${key}"`);
  }
  const entry = Object.entries(node).find(([k]) => k === key);
  return entry?.[1];
}

/** `additionalProperties` of an object node, or `'<absent>'` (an open object). */
function additionalPropertiesOf(node: unknown): unknown {
  if (typeof node !== 'object' || node === null) return '<not an object>';
  return 'additionalProperties' in node
    ? node.additionalProperties
    : '<absent>';
}

/** The `{type:'object'}` branch of a nullable `anyOf`. */
function objectBranch(node: unknown): unknown {
  const branches = z.array(z.unknown()).parse(prop(node, 'anyOf'));
  const hit = branches.find((b) => prop(b, 'type') === 'object');
  if (hit === undefined) throw new Error('anyOf has no object branch');
  return hit;
}

const SchemaCases: ReadonlyArray<{
  label: string;
  dir: string;
  schema: z.ZodType;
}> = [
  {
    label: 'envelope',
    dir: join(ENV_FIX, 'invalid'),
    schema: CompanionEnvelopeSchema,
  },
  {
    label: 'bg3-save',
    dir: join(BG3_FIX, 'invalid'),
    schema: Bg3SaveMessageSchema,
  },
];

describe('Companion v1 golden fixtures — valid (C1, C2)', () => {
  it('ships the agreed bg3-save cases', () => {
    expect(namesIn(BG3_FIX)).toEqual([
      'act1-solo-no-thumbnail',
      'act2-party-4p-summon',
      'ruleset-null',
    ]);
  });

  it('ships the agreed envelope cases', () => {
    expect(namesIn(ENV_FIX)).toEqual(['bg3-save', 'unknown-contract']);
  });

  it.each(namesIn(BG3_FIX))(
    'bg3-save %s parses as message and envelope',
    (name) => {
      const body = readJson(BG3_FIX, `${name}.json`);
      expect(
        Bg3SaveMessageSchema.safeParse(body).error?.issues,
      ).toBeUndefined();
      expect(
        CompanionEnvelopeSchema.safeParse(body).error?.issues,
      ).toBeUndefined();
    },
  );

  it.each(namesIn(ENV_FIX))('envelope %s parses as an envelope', (name) => {
    const result = CompanionEnvelopeSchema.safeParse(
      readJson(ENV_FIX, `${name}.json`),
    );
    expect(result.error?.issues).toBeUndefined();
  });

  it('envelope bg3-save.json is a copy of the act2 message', () => {
    expect(readJson(ENV_FIX, 'bg3-save.json')).toEqual(
      readJson(BG3_FIX, 'act2-party-4p-summon.json'),
    );
  });

  it('envelope bg3-save.json resolves to the bg3-save v1 contract', () => {
    const env = CompanionEnvelopeSchema.parse(
      readJson(ENV_FIX, 'bg3-save.json'),
    );
    const hit = lookupCompanionContract(env.contract, env.contractVersion);
    expect(hit.kind === 'ok' && hit.spec.schema).toBe(Bg3SaveMessageSchema);
  });

  it('unknown-contract.json is a registry miss, not a parse error', () => {
    const env = CompanionEnvelopeSchema.parse(
      readJson(ENV_FIX, 'unknown-contract.json'),
    );
    expect(
      lookupCompanionContract(env.contract, env.contractVersion).kind,
    ).toBe('unknown_contract');
  });
});

describe.each(SchemaCases)(
  'Companion v1 $label fixtures — invalid (C3)',
  ({ dir, schema }) => {
    const expected = z
      .record(
        z.string(),
        z.object({ path: z.string(), code: z.string() }).strict(),
      )
      .parse(readJson(dir, 'EXPECTED.json'));
    const names = namesIn(dir);

    it('lists an expected issue for every invalid fixture', () => {
      expect(Object.keys(expected).sort()).toEqual(names);
    });

    /** safeParse, with a throw reported as data so the assertion names it. */
    const parseInvalid = (name: string) => {
      try {
        return {
          result: schema.safeParse(readJson(dir, `${name}.json`)),
          threw: null,
        };
      } catch (err) {
        return { result: null, threw: String(err) };
      }
    };

    it.each(names)('%s is rejected with its EXPECTED path + code', (name) => {
      const { result, threw } = parseInvalid(name);
      expect({ name, threw, success: result?.success }).toEqual({
        name,
        threw: null,
        success: false,
      });
      const issues = (result?.error?.issues ?? []).map((i) => ({
        path: i.path.map(String).join('.'),
        code: i.code,
      }));
      expect(issues).toContainEqual(expected[name]);
    });
  },
);

describe('bg3-save v1 raw SaveInfo round-trip (C4)', () => {
  it('ships a raw twin for every golden message', () => {
    expect(rawNames()).toEqual(namesIn(BG3_FIX));
  });

  it.each(rawNames())('%s normalises to the golden payload', (name) => {
    const raw = Bg3SaveInfoRawSchema.parse(
      readJson(SAVEINFO, `${name}${RAW_SUFFIX}`),
    );
    const { payload } = bg3Fixture(name);
    const meta = {
      savedAt: payload.savedAt,
      campaignKey: payload.campaignKey,
      campaignKeySource: payload.campaignKeySource,
      thumbnail: payload.thumbnail,
    };
    expect(normaliseBg3SaveInfo(raw, meta)).toEqual(payload);
  });
});

describe('Companion fixtures stay anonymised (C5)', () => {
  const RawPrivacy = z
    .object({
      'Active Party': z
        .object({
          Characters: z.array(z.object({ Position: z.unknown() }).loose()),
        })
        .loose(),
      'Save Name': z.string(),
    })
    .loose();

  it.each(rawNames())(
    '%s zeroes every Position and uses a generic save name',
    (name) => {
      const raw = RawPrivacy.parse(readJson(SAVEINFO, `${name}${RAW_SUFFIX}`));
      const positions = raw['Active Party'].Characters.map((c) => c.Position);
      expect(positions.length).toBeGreaterThan(0);
      expect(positions).toEqual(positions.map(() => [0, 0, 0]));
      expect(raw['Save Name']).toMatch(/^QuickSave_\d+$/);
    },
  );

  it('no fixture or doc holds a SteamID64, a GUID, a drive path or a /Users/ path', () => {
    const textFiles = filesUnder(ROOT).filter((f) => !f.endsWith('.webp'));
    expect(textFiles.filter((f) => f.endsWith('.md')).length).toBeGreaterThan(
      3,
    );
    expect(textFiles.length).toBeGreaterThan(20);
    const leaks = textFiles.filter((f) =>
      /7656119\d{10}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-|[A-Z]:\\|\/Users\//i.test(
        readFileSync(f, 'utf8'),
      ),
    );
    expect(leaks).toEqual([]);
  });
});

describe('bg3-save v1 placeholder thumbnail (C6)', () => {
  it('the committed WebP matches the act2 thumbnail ref', async () => {
    const bytes = readFileSync(join(BG3_FIX, 'placeholder-thumbnail.webp'));
    const meta = await sharp(bytes).metadata();
    expect({
      sha256: createHash('sha256').update(bytes).digest('hex'),
      byteLength: bytes.length,
      contentType: `image/${meta.format}`,
      width: meta.width,
      height: meta.height,
    }).toEqual(bg3Fixture('act2-party-4p-summon').payload.thumbnail);
  });

  it('is a flat single-colour image, so a real screenshot cannot pass (ruling 5)', async () => {
    const bytes = readFileSync(join(BG3_FIX, 'placeholder-thumbnail.webp'));
    const { channels } = await sharp(bytes).stats();
    expect(channels.length).toBeGreaterThanOrEqual(3);
    const spread = channels.map((c, i) => ({
      channel: i,
      range: c.max - c.min,
    }));
    expect(spread.filter((c) => c.range > 1)).toEqual([]);
  });
});

describe('Companion v1 schema.json drift guards (C7)', () => {
  it('envelope schema.json matches a fresh generation', () => {
    expect(read(ENV_V1, 'schema.json')).toBe(
      serializeCompanionEnvelopeJsonSchema(),
    );
  });

  it('bg3-save schema.json matches a fresh generation', () => {
    expect(read(BG3_V1, 'schema.json')).toBe(serializeBg3SaveJsonSchema());
  });
});

describe('bg3-save v1 schema.json stays closed (C8)', () => {
  const root: unknown = readJson(BG3_V1, 'schema.json');
  const payload = prop(prop(root, 'properties'), 'payload');
  const member = prop(prop(prop(payload, 'properties'), 'party'), 'items');
  const klass = prop(prop(prop(member, 'properties'), 'classes'), 'items');
  const thumbnail = objectBranch(
    prop(prop(payload, 'properties'), 'thumbnail'),
  );

  it.each([
    ['message', root],
    ['payload', payload],
    ['party member', member],
    ['class', klass],
    ['thumbnail', thumbnail],
  ])('%s object has additionalProperties: false', (label, node) => {
    expect({
      label,
      additionalProperties: additionalPropertiesOf(node),
    }).toEqual({
      label,
      additionalProperties: false,
    });
  });
});
