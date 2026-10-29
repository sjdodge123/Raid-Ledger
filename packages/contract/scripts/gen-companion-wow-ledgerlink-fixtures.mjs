// Regenerates packages/contract/companion/wow-ledgerlink/v1/fixtures/ (ROK-1964)
// from the anonymised LedgerLink v1 golden strings in
// packages/contract/ledgerlink/v1/fixtures/*.txt (read verbatim, never edited).
// Every envelope meta value is synthetic. Build dist first:
//   npm run build -w packages/contract && node packages/contract/scripts/gen-companion-wow-ledgerlink-fixtures.mjs
// Exits non-zero when an invalid case stops producing its EXPECTED issue.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPANION_WOW_LEDGERLINK_EXPORT_MAX, WowLedgerlinkMessageSchema } from '../dist/index.js';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEDGERLINK = join(pkg, 'ledgerlink', 'v1', 'fixtures');
const OUT = join(pkg, 'companion', 'wow-ledgerlink', 'v1', 'fixtures');
const write = (dir, name, value) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), `${JSON.stringify(value, null, 2)}\n`);
};

/** Valid cases: the LedgerLink fixture each wraps, and a synthetic capture time. */
const CASES = {
    'char-normal': '2026-10-28T12:00:05Z',
    'guild-3-pages': '2026-10-28T12:05:05Z',
    'mixed-char-guild3-raid-shuffled': '2026-10-28T12:10:05Z',
    'guild-8-pages-2000-members': '2026-10-28T12:15:05Z',
};

const messageFor = (name, capturedAt) => ({
    envelopeVersion: 1, contract: 'wow-ledgerlink', contractVersion: 1, capturedAt,
    appVersion: '0.1.0', collectorVersion: '0.1.0',
    payload: { exportString: readFileSync(join(LEDGERLINK, `${name}.txt`), 'utf8') },
});

for (const [name, capturedAt] of Object.entries(CASES)) {
    const msg = messageFor(name, capturedAt);
    WowLedgerlinkMessageSchema.parse(msg);
    write(OUT, `${name}.json`, msg);
}

/** [name, mutate(base message), expected path, expected code] */
const INVALID = [
    ['envelope-unknown-key', (m) => { m.extra = true; }, '', 'unrecognized_keys'],
    ['payload-unknown-key', (m) => { m.payload.ruleset = 'normal'; }, 'payload', 'unrecognized_keys'],
    ['export-missing', (m) => { delete m.payload.exportString; }, 'payload.exportString', 'invalid_type'],
    ['export-empty', (m) => { m.payload.exportString = ''; }, 'payload.exportString', 'too_small'],
    ['export-over-cap', (m) => { m.payload.exportString = 'A'.repeat(COMPANION_WOW_LEDGERLINK_EXPORT_MAX + 1); }, 'payload.exportString', 'too_big'],
    ['export-not-string', (m) => { m.payload.exportString = ['!RL1!char!eJx']; }, 'payload.exportString', 'invalid_type'],
    ['contract-version-2', (m) => { m.contractVersion = 2; }, 'contractVersion', 'invalid_value'],
    ['contract-bg3-save', (m) => { m.contract = 'bg3-save'; }, 'contract', 'invalid_value'],
];

const expected = {};
for (const [name, mutate, path, code] of INVALID) {
    const m = messageFor('char-normal', CASES['char-normal']);
    mutate(m);
    const result = WowLedgerlinkMessageSchema.safeParse(m);
    const issues = (result.error?.issues ?? []).map((i) => `${i.path.map(String).join('.')}|${i.code}`);
    if (result.success || !issues.includes(`${path}|${code}`)) {
        throw new Error(`${name}: expected ${path}|${code}, got ${JSON.stringify(issues)}`);
    }
    write(join(OUT, 'invalid'), `${name}.json`, m);
    expected[name] = { path, code };
}
write(join(OUT, 'invalid'), 'EXPECTED.json', expected);
console.log(`wrote fixtures under ${OUT}`);
