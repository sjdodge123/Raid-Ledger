/**
 * ROK-1829 — RL Valheim Link v1 conformance + drift guard. Raid Ledger owns
 * the mod's wire format (`packages/contract/valheim-link/v1/CONTRACT.md`):
 * - every golden `fixtures/*.json` parses with `ValheimLinkMessageSchema`,
 *   and every inline explored bitmap inflates to exactly ceil(w·h/8) bytes;
 * - the CONTRACT.md §6 server bitmap rule (bounded gunzip, exact length,
 *   one member) rejects corrupt, truncated, short, bomb and two-member gzip
 *   that Zod lets through;
 * - every `fixtures/invalid/*.json` is rejected — never thrown — with the
 *   issue path + code listed in `fixtures/invalid/EXPECTED.json`;
 * - the committed `schema.json` equals a fresh generation from the Zod
 *   source. Fix drift with `npm run build -w packages/contract && node
 *   packages/contract/scripts/gen-valheim-link-schema.mjs`.
 * Lives in the api (like `ledgerlink-contract.spec.ts`) because the
 * contract workspace has no Node types for reading the fixture files.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync, inflateRawSync } from 'node:zlib';
import { z } from 'zod';
import {
  VALHEIM_LINK_SCHEMA_VERSION,
  ValheimExploredBitmapSchema,
  ValheimLinkMessageSchema,
  serializeValheimLinkJsonSchema,
  valheimLinkBitmapBytes,
  type ValheimExploredBitmap,
} from '@raid-ledger/contract';

const V1 = join(
  __dirname,
  '../../../../packages/contract/valheim-link',
  `v${VALHEIM_LINK_SCHEMA_VERSION}`,
);
const FIXTURES = join(V1, 'fixtures');
const INVALID = join(FIXTURES, 'invalid');

const read = (dir: string, file: string): string =>
  readFileSync(join(dir, file), 'utf8');
const readJson = (dir: string, file: string): unknown =>
  JSON.parse(read(dir, file));
const namesIn = (dir: string): string[] =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'EXPECTED.json')
    .map((f) => f.slice(0, -'.json'.length))
    .sort();

const inflatedBytes = (bitmap: ValheimExploredBitmap): number =>
  gunzipSync(Buffer.from(bitmap.data, 'base64')).length;

/** gzip header length when FLG = 0 (no FEXTRA/FNAME/FCOMMENT/FHCRC). */
const GZIP_PLAIN_HEADER = 10;
const GZIP_TRAILER = 8;

/**
 * Input bytes a zlib engine consumed — `{ info: true }` returns
 * `{ buffer, engine }`, which `@types/node` does not model; -1 when absent.
 */
function bytesConsumed(out: unknown): number {
  if (typeof out !== 'object' || out === null || !('engine' in out)) return -1;
  const { engine } = out;
  if (typeof engine !== 'object' || engine === null) return -1;
  if (!('bytesWritten' in engine)) return -1;
  return typeof engine.bytesWritten === 'number' ? engine.bytesWritten : -1;
}

/**
 * The CONTRACT.md §6 server rule, as ROK-1833 must implement it:
 * 1. gunzip with `maxOutputLength = valheimLinkBitmapBytes(w, h)`; any decode
 *    error (corrupt, truncated, CRC/ISIZE mismatch, too long) rejects;
 * 2. the inflated length must be exact;
 * 3. ONE member: Node's gunzip silently joins concatenated members, so the
 *    header must be the plain 10 bytes (FLG = 0) and a raw inflate of
 *    everything between it and the 8-byte trailer must consume ALL of it.
 */
function serverAcceptsBitmap(bitmap: ValheimExploredBitmap): boolean {
  const want = valheimLinkBitmapBytes(bitmap.width, bitmap.height);
  const gz = Buffer.from(bitmap.data, 'base64');
  try {
    const raw = gunzipSync(gz, { maxOutputLength: want });
    if (raw.length !== want || gz[3] !== 0) return false;
    const body = gz.subarray(GZIP_PLAIN_HEADER, gz.length - GZIP_TRAILER);
    const out: unknown = inflateRawSync(body, {
      maxOutputLength: want,
      info: true,
    });
    return bytesConsumed(out) === body.length;
  } catch {
    return false;
  }
}

const withData = (
  bitmap: ValheimExploredBitmap,
  bytes: Buffer,
): ValheimExploredBitmap => ({ ...bitmap, data: bytes.toString('base64') });

describe('Valheim Link v1 golden fixtures — valid', () => {
  const names = namesIn(FIXTURES);

  it('ships the agreed valid cases', () => {
    expect(names).toEqual([
      'character-eaqs',
      'character-vanilla',
      'items-atlas',
      'items-file-icons',
      'map-personal',
      'map-shared-layer',
      'recipes-processing',
      'recipes-vanilla',
    ]);
  });

  it.each(names)('%s parses with ValheimLinkMessageSchema', (name) => {
    const result = ValheimLinkMessageSchema.safeParse(
      readJson(FIXTURES, `${name}.json`),
    );
    expect(result.error?.issues ?? []).toEqual([]);
  });

  it.each(names.filter((n) => n.startsWith('map-')))(
    '%s bitmaps inflate to exactly ceil(width·height/8) bytes',
    (name) => {
      const msg = ValheimLinkMessageSchema.parse(
        readJson(FIXTURES, `${name}.json`),
      );
      if (msg.kind !== 'map') throw new Error(`${name} is not a map message`);
      const layers = [msg.explored, msg.sharedExplored].filter(
        (b): b is ValheimExploredBitmap => b !== null,
      );
      expect(layers.map(inflatedBytes)).toEqual(
        layers.map((b) => Math.ceil((b.width * b.height) / 8)),
      );
    },
  );
});

describe('Valheim Link v1 server bitmap rule (CONTRACT.md §6)', () => {
  const msg = ValheimLinkMessageSchema.parse(
    readJson(FIXTURES, 'map-personal.json'),
  );
  if (msg.kind !== 'map') throw new Error('map-personal is not a map message');
  const golden = msg.explored;
  const want = valheimLinkBitmapBytes(golden.width, golden.height);
  const gz = Buffer.from(golden.data, 'base64');
  const corrupt = Buffer.from(gz);
  corrupt.writeUInt32LE(
    (corrupt.readUInt32LE(corrupt.length - 8) ^ 1) >>> 0,
    corrupt.length - 8,
  );
  const inflated = gunzipSync(gz);
  const raw1 = inflated.subarray(0, want >> 1);
  const raw2 = inflated.subarray(want >> 1);
  const cases: [string, ValheimExploredBitmap, boolean][] = [
    ['golden bitmap', golden, true],
    ['truncated gzip', withData(golden, gz.subarray(0, gz.length - 8)), false],
    ['corrupt CRC', withData(golden, corrupt), false],
    [
      'short: one byte under w·h/8',
      withData(golden, gzipSync(Buffer.alloc(want - 1))),
      false,
    ],
    [
      'bomb: 64× w·h/8',
      withData(golden, gzipSync(Buffer.alloc(want * 64))),
      false,
    ],
    [
      'two members joining to exactly w·h/8',
      withData(golden, Buffer.concat([gzipSync(raw1), gzipSync(raw2)])),
      false,
    ],
    [
      'empty member, then the golden member',
      withData(golden, Buffer.concat([gzipSync(Buffer.alloc(0)), gz])),
      false,
    ],
  ];

  it.each(cases)(
    '%s is schema-valid; the server rule decides',
    (name, bitmap, ok) => {
      expect({
        name,
        schemaValid: ValheimExploredBitmapSchema.safeParse(bitmap).success,
      }).toEqual({ name, schemaValid: true });
      expect({ name, accepted: serverAcceptsBitmap(bitmap) }).toEqual({
        name,
        accepted: ok,
      });
    },
  );
});

describe('Valheim Link v1 golden fixtures — invalid', () => {
  const expected = z
    .record(
      z.string(),
      z.object({ path: z.string(), code: z.string() }).strict(),
    )
    .parse(readJson(INVALID, 'EXPECTED.json'));
  const names = namesIn(INVALID);

  it('lists an expected issue for every invalid fixture', () => {
    expect(Object.keys(expected).sort()).toEqual(names);
  });

  /** safeParse, with a throw reported as data so the assertion names it. */
  const parseInvalid = (name: string) => {
    try {
      const result = ValheimLinkMessageSchema.safeParse(
        readJson(INVALID, `${name}.json`),
      );
      return { result, threw: null };
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
});

describe('Valheim Link v1 schema.json drift guard', () => {
  it('matches a fresh generation from ValheimLinkMessageSchema', () => {
    expect(read(V1, 'schema.json')).toBe(serializeValheimLinkJsonSchema());
  });
});
