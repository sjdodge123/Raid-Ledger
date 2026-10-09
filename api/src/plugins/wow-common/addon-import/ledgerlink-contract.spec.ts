/**
 * LedgerLink v1 conformance + drift guard (ROK-1724). Raid Ledger owns the
 * addon wire format (`packages/contract/ledgerlink/v1/CONTRACT.md`):
 * - every golden `fixtures/*.txt` decodes, with the REAL decoder, to its
 *   `.json` (single-section `{ pages, payload }`, mixed `{ sections }`); every `fixtures/invalid/*.txt` fails with its `.json` code;
 * - the committed `schema.json` equals a fresh generation from the Zod
 *   source of truth. Fix drift with
 *   `npm run gen:ledgerlink-schema -w @raid-ledger/contract`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  ADDON_EXPORT_ENVELOPE_VERSION,
  AddonImportErrorCodeSchema,
  serializeLedgerLinkJsonSchema,
} from '@raid-ledger/contract';
import { decodeImportPaste } from './addon-import.decoder';
import { AddonImportError } from './addon-import.errors';
import { ledgerLinkFixtureView } from './testing/ledgerlink-fixture-view';

const V1 = join(
  __dirname,
  '../../../../../packages/contract/ledgerlink',
  `v${ADDON_EXPORT_ENVELOPE_VERSION}`,
);
const FIXTURES = join(V1, 'fixtures');
const INVALID = join(FIXTURES, 'invalid');

const namesIn = (dir: string): string[] =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.txt'))
    .map((f) => f.slice(0, -'.txt'.length))
    .sort();

const read = (dir: string, file: string): string =>
  readFileSync(join(dir, file), 'utf8');

function decodeErrorCode(paste: string): string {
  try {
    decodeImportPaste(paste);
  } catch (err) {
    if (err instanceof AddonImportError) return err.code;
    throw err;
  }
  return 'DECODED_WITHOUT_ERROR';
}

describe('LedgerLink v1 golden fixtures — valid', () => {
  const names = namesIn(FIXTURES);

  it('ships the agreed valid cases', () => {
    expect(names).toEqual([
      'char-forever-quests',
      'char-forever-talents-named',
      'char-normal',
      'char-null-ruleset-no-guild',
      'char-roleplaying',
      'guild-1-page',
      'guild-3-pages',
      'guild-8-pages-2000-members',
      'mixed-char-guild3-raid-shuffled',
      'mixed-char-raid',
      'raid',
    ]);
  });

  it.each(names)('%s.txt decodes to %s.json', (name) => {
    const expected: unknown = JSON.parse(read(FIXTURES, `${name}.json`));
    const decoded = decodeImportPaste(read(FIXTURES, `${name}.txt`));
    expect(ledgerLinkFixtureView(decoded)).toEqual(expected);
  });
});

describe('LedgerLink v1 golden fixtures — invalid', () => {
  const names = namesIn(INVALID);

  it('ships at least the unknown-key, oversized and page-set cases', () => {
    expect(names).toEqual(
      expect.arrayContaining([
        'unknown-key-officer-note',
        'decoded-too-large',
        'pages-missing-middle',
        'mixed-two-char',
        'mixed-guild-incomplete',
        'mixed-different-exporters',
        'mixed-11-tokens',
        'gender-unknown-value',
        'quests-completed-over-cap',
      ]),
    );
  });

  it.each(names)('invalid/%s.txt is rejected with its code', (name) => {
    const { code } = JSON.parse(read(INVALID, `${name}.json`)) as {
      code: string;
    };
    expect(AddonImportErrorCodeSchema.options).toContain(code);
    expect(decodeErrorCode(read(INVALID, `${name}.txt`))).toBe(code);
  });
});

describe('LedgerLink v1 schema.json drift guard', () => {
  it('matches a fresh generation from AddonExportSchema', () => {
    expect(read(V1, 'schema.json')).toBe(serializeLedgerLinkJsonSchema());
  });
});
