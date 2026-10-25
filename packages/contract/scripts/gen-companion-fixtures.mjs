// Regenerates packages/contract/companion/*/v1/fixtures/ (ROK-1954) from the
// anonymised raw SaveInfo fixtures (`bg3-save/v1/fixtures/saveinfo/`, written
// by hand from the spec's transform) and the committed synthetic
// `placeholder-thumbnail.webp`. Every meta value is synthetic. Build dist first:
//   npm run build -w packages/contract && node packages/contract/scripts/gen-companion-fixtures.mjs
// Exits non-zero when an invalid case stops producing its EXPECTED issue.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    Bg3SaveInfoRawSchema,
    Bg3SaveMessageSchema,
    CompanionEnvelopeSchema,
    normaliseBg3SaveInfo,
} from '../dist/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'companion');
const BG3 = join(root, 'bg3-save', 'v1', 'fixtures');
const ENV = join(root, 'envelope', 'v1', 'fixtures');
const write = (dir, name, value) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), `${JSON.stringify(value, null, 2)}\n`);
};
const clone = (v) => structuredClone(v);

const webp = readFileSync(join(BG3, 'placeholder-thumbnail.webp'));
const thumbnail = {
    sha256: createHash('sha256').update(webp).digest('hex'),
    byteLength: webp.length,
    contentType: 'image/webp',
    width: 1280,
    height: 720,
};

const CASES = {
    'act2-party-4p-summon': { savedAt: '2026-10-24T12:00:00Z', capturedAt: '2026-10-24T12:00:05Z', campaignKey: '0123456789abcdef'.repeat(4), campaignKeySource: 'save-folder', thumbnail },
    'act1-solo-no-thumbnail': { savedAt: '2026-10-20T08:30:00Z', capturedAt: '2026-10-20T08:30:02Z', campaignKey: 'fedcba9876543210'.repeat(4), campaignKeySource: 'game-id', thumbnail: null },
    'ruleset-null': { savedAt: '2026-10-22T19:15:00Z', capturedAt: '2026-10-22T19:15:01Z', campaignKey: 'a1b2c3d4e5f60718'.repeat(4), campaignKeySource: 'save-folder', thumbnail },
};

const messages = {};
for (const [name, { capturedAt, ...meta }] of Object.entries(CASES)) {
    const raw = Bg3SaveInfoRawSchema.parse(JSON.parse(readFileSync(join(BG3, 'saveinfo', `${name}.saveinfo.json`), 'utf8')));
    const msg = {
        envelopeVersion: 1, contract: 'bg3-save', contractVersion: 1, capturedAt,
        appVersion: '0.1.0', collectorVersion: '0.1.0', payload: normaliseBg3SaveInfo(raw, meta),
    };
    messages[name] = Bg3SaveMessageSchema.parse(msg);
    write(BG3, `${name}.json`, msg);
}
const act2 = messages['act2-party-4p-summon'];

/** [name, mutate(clone of act2), expected path, expected code] */
const BG3_INVALID = [
    ['envelope-unknown-key', (m) => { m.extra = true; }, '', 'unrecognized_keys'],
    ['payload-unknown-key', (m) => { m.payload.extra = true; }, 'payload', 'unrecognized_keys'],
    ['party-position-key', (m) => { m.payload.party[0].Position = [0, 0, 0]; }, 'payload.party.0', 'unrecognized_keys'],
    ['summon-with-classes', (m) => { m.payload.party[1].classes = [{ main: 'Barbarian', sub: null }]; }, 'payload.party.1', 'custom'],
    ['xp-level-gt-total', (m) => { m.payload.party[0].xpLevel = m.payload.party[0].xpTotal + 1; }, 'payload.party.0', 'custom'],
    ['thumbnail-png', (m) => { m.payload.thumbnail.contentType = 'image/png'; }, 'payload.thumbnail.contentType', 'invalid_value'],
    ['thumbnail-too-large', (m) => { m.payload.thumbnail.byteLength = 1_048_577; }, 'payload.thumbnail.byteLength', 'too_big'],
    ['contract-version-2', (m) => { m.contractVersion = 2; }, 'contractVersion', 'invalid_value'],
    ['game-version-text', (m) => { m.payload.gameVersion = 'Patch 7 Hotfix'; }, 'payload.gameVersion', 'invalid_format'],
    ['captured-at-offset', (m) => { m.capturedAt = '2026-10-24T14:00:05+02:00'; }, 'capturedAt', 'invalid_format'],
    ['saved-after-captured', (m) => { m.payload.savedAt = '2026-10-24T12:00:06Z'; }, 'payload.savedAt', 'custom'],
    ['party-empty', (m) => { m.payload.party = []; }, 'payload.party', 'too_small'],
    ['campaign-key-raw-folder', (m) => { m.payload.campaignKey = 'Tav-123__QuickSave'; }, 'payload.campaignKey', 'invalid_format'],
];

const ENV_INVALID = [
    ['envelope-version-2', (m) => { m.envelopeVersion = 2; }, 'envelopeVersion', 'invalid_value'],
    ['contract-id-uppercase', (m) => { m.contract = 'BG3-Save'; }, 'contract', 'invalid_format'],
    ['missing-payload', (m) => { delete m.payload; }, 'payload', 'invalid_type'],
    ['unknown-key', (m) => { m.extra = true; }, '', 'unrecognized_keys'],
    ['app-version-not-semver', (m) => { m.appVersion = '1.2'; }, 'appVersion', 'invalid_format'],
];

function writeInvalid(dir, schema, cases) {
    const expected = {};
    for (const [name, mutate, path, code] of cases) {
        const m = clone(act2);
        mutate(m);
        const result = schema.safeParse(m);
        const issues = (result.error?.issues ?? []).map((i) => `${i.path.map(String).join('.')}|${i.code}`);
        if (result.success || !issues.includes(`${path}|${code}`)) {
            throw new Error(`${name}: expected ${path}|${code}, got ${JSON.stringify(issues)}`);
        }
        write(join(dir, 'invalid'), `${name}.json`, m);
        expected[name] = { path, code };
    }
    write(join(dir, 'invalid'), 'EXPECTED.json', expected);
}

writeInvalid(BG3, Bg3SaveMessageSchema, BG3_INVALID);
writeInvalid(ENV, CompanionEnvelopeSchema, ENV_INVALID);
write(ENV, 'bg3-save.json', act2);
write(ENV, 'unknown-contract.json', { ...clone(act2), contract: 'minecraft-world', payload: { world: 'Synthetic World' } });
console.log(`wrote fixtures under ${root}`);
