/**
 * ROK-1829 — RL Valheim Link v1 conformance + drift guard. Raid Ledger owns
 * the mod's wire format (`packages/contract/valheim-link/v1/CONTRACT.md`):
 * - every golden `fixtures/*.json` parses with `ValheimLinkMessageSchema`,
 *   and every inline explored bitmap inflates to exactly ceil(w·h/8) bytes;
 * - every `fixtures/invalid/*.json` is rejected with the issue path + code
 *   listed in `fixtures/invalid/EXPECTED.json`;
 * - the committed `schema.json` equals a fresh generation from the Zod
 *   source. Fix drift with `npm run build -w packages/contract && node
 *   packages/contract/scripts/gen-valheim-link-schema.mjs`.
 * Lives in the api (like `ledgerlink-contract.spec.ts`) because the
 * contract workspace has no Node types for reading the fixture files.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { z } from 'zod';
import {
  VALHEIM_LINK_SCHEMA_VERSION,
  ValheimLinkMessageSchema,
  serializeValheimLinkJsonSchema,
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

  it.each(names)('%s is rejected with its EXPECTED path + code', (name) => {
    const result = ValheimLinkMessageSchema.safeParse(
      readJson(INVALID, `${name}.json`),
    );
    const issues = (result.error?.issues ?? []).map((i) => ({
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
