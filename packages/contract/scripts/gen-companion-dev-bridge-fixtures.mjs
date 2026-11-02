// Regenerates packages/contract/companion/dev-bridge/v1/fixtures/ (ROK-2055).
// Every value is synthetic: no real account, realm, character, guild or path.
// Build dist first:
//   npm run build -w packages/contract && node packages/contract/scripts/gen-companion-dev-bridge-fixtures.mjs
// Exits non-zero when a valid case stops parsing or an invalid case stops
// producing its EXPECTED issue.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEV_BRIDGE_MESSAGES } from '../dist/index.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'companion', 'dev-bridge', 'v1', 'fixtures');
const INVALID = join(FIX, 'invalid');
const write = (dir, name, value) => writeFileSync(join(dir, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
const clone = (v) => structuredClone(v);
const ID = '01JBX7Q2M3N4P5R6S7T8V9W0XY';
const AT = '2026-11-01T18:30:00Z';

const professions = {
    title: 'Can an addon read professions?',
    flavor: 'auto',
    after: 'PLAYER_LOGIN',
    ttlHours: 72,
    calls: [
        { id: 'profs', fn: 'GetProfessions' },
        { id: 'n', fn: 'GetNumSkillLines' },
        { id: 'skill', fn: 'GetSkillLineInfo', args: ['$i'], forEach: { countFrom: 'n', max: 60 } },
        { id: 'ts', presence: 'C_TradeSkillUI' },
    ],
};
const result = {
    probeId: ID, capturedAt: '2026-11-01T19:02:11Z', addonVersion: '0.1.0', truncated: false,
    calls: [
        { id: 'profs', status: 'missing' },
        { id: 'n', status: 'ok', values: [2] },
        { id: 'skill', status: 'ok', iterations: [
            { i: 1, status: 'ok', values: ['Professions', true, false, 0, 0, 0, 0] },
            { i: 2, status: 'ok', values: ['Herbalism', false, false, 112, 0, 0, 300] },
        ] },
        { id: 'ts', status: 'ok', values: ['nil'] },
    ],
};
const nested = { ...clone(result), calls: [{ id: 'roster', status: 'ok', values: ['Tester', { rank: 'Officer', note: '<redacted>', tags: ['raider', { main: true }] }] }] };

const VALID = {
    'probe-request--professions': professions,
    'probe-request--minimal': { title: 'Guild check', calls: [{ id: 'g', fn: 'IsInGuild' }] },
    'probe-result--professions': result,
    'probe-result--nested-tables': nested,
    health: { app: 'rl-companion', appVersion: '0.4.0', bridgeVersion: 1, devMode: true, probesEnabled: true, wowDir: 'D:/Games/World of Warcraft', flavors: ['_classic_era_', '_anniversary_'], wowRunning: false, uptimeSec: 5400, now: AT },
    addons: { flavor: '_anniversary_', next: 'cGFnZTI', addons: [
        { folder: 'LedgerLink', title: 'LedgerLink', version: '1.4.0', interface: '11507', savedVariables: ['LedgerLinkDB'], loadOnDemand: false },
        { folder: 'LedgerLinkProbe', title: null, version: null, interface: '11507, 20505', savedVariables: [], loadOnDemand: false },
    ] },
    'sv-raw': { flavor: '_anniversary_', scope: 'account', path: '_anniversary_/WTF/Account/TESTACCOUNT/SavedVariables/LedgerLink.lua', bytes: 18342, mtime: AT, text: 'LedgerLinkDB = {\n\t["version"] = 1,\n', next: null },
    'sv-parsed': { flavor: '_anniversary_', next: null, files: [
        { scope: 'account', account: 'TESTACCOUNT', mtime: AT, topKeys: ['version', 'outbox'], outbox: [{ guidHash: 'a3f1'.repeat(16), section: 'roster', source: 'guild', at: AT, exportedAt: null, pages: 2, bytes: 6100, decodes: true }], blockedCount: 0, region: 'EU' },
        { scope: 'character', account: 'TESTACCOUNT', realm: 'Testrealm', character: 'Testchar', mtime: AT, topKeys: ['settings'], outbox: [], blockedCount: 1, region: null },
    ] },
    'probe-queued': { probeId: ID, status: 'queued', flavor: '_anniversary_', answersOn: 'next UI load, then next save' },
    'probe-list': { next: null, probes: [{ probeId: ID, title: professions.title, status: 'answered', submittedAt: AT, answeredAt: '2026-11-01T19:05:00Z' }] },
    'probe-detail--answered': { probeId: ID, title: professions.title, status: 'answered', submittedAt: AT, answeredAt: '2026-11-01T19:05:00Z', request: professions, result, next: null },
    'probe-detail--queued': { probeId: ID, title: professions.title, status: 'queued', submittedAt: AT, request: professions, next: null },
    'probe-cancelled': { probeId: ID, status: 'cancelled' },
    logs: { next: 'bG9nczI', lines: [
        { at: AT, level: 'info', target: 'dev_bridge', msg: 'GET /dev/v1/health 200 412B from 192.168.0.229' },
        { at: AT, level: 'warn', target: 'dev_bridge::auth', msg: 'rejected Authorization: Bearer <redacted> from 192.168.0.50' },
    ] },
    collectors: { collectors: [{ id: 'wow-ledgerlink', enabled: true, paused: false, lastScanAt: AT, lastUploadAt: null, pending: 1 }, { id: 'bg3-save', enabled: false, paused: false, lastScanAt: null, lastUploadAt: null, pending: 0, lastError: 'Save folder not found' }] },
    'error--invalid-request': { error: 'invalid_request', issues: [{ path: ['calls', 0, 'fn'], code: 'custom', message: 'Function not allowed (denied)' }] },
    'error--probes-disabled': { error: 'probes_disabled' },
    'error--unauthorized': { error: 'unauthorized' },
};

const withFn = (fn) => (m) => { m.calls[0].fn = fn; };
/** [name, base valid fixture, mutate, expected path, expected code] */
const CASES = [
    ['probe-request--deny-send-chat-message', 'probe-request--professions', withFn('SendChatMessage'), 'calls.0.fn', 'custom'],
    ['probe-request--deny-set-cvar', 'probe-request--professions', withFn('SetCVar'), 'calls.0.fn', 'custom'],
    ['probe-request--deny-loadstring', 'probe-request--professions', withFn('loadstring'), 'calls.0.fn', 'custom'],
    ['probe-request--deny-run-script', 'probe-request--professions', withFn('RunScript'), 'calls.0.fn', 'custom'],
    ['probe-request--deny-guild-uninvite', 'probe-request--professions', withFn('GuildUninvite'), 'calls.0.fn', 'custom'],
    ['probe-request--deny-use-container-item', 'probe-request--professions', withFn('C_Container.UseContainerItem'), 'calls.0.fn', 'custom'],
    ['probe-request--deny-get-quest-reward', 'probe-request--professions', withFn('GetQuestReward'), 'calls.0.fn', 'custom'],
    ['probe-request--deny-cancel-unit-buff', 'probe-request--professions', withFn('CancelUnitBuff'), 'calls.0.fn', 'custom'],
    ['probe-request--not-read-verb', 'probe-request--professions', withFn('DoEmote'), 'calls.0.fn', 'custom'],
    ['probe-request--fn-four-segments', 'probe-request--professions', withFn('A.B.C.GetMoney'), 'calls.0.fn', 'invalid_format'],
    ['probe-request--arg-table', 'probe-request--professions', (m) => { m.calls[0].args = [{}]; }, 'calls.0.args.0', 'invalid_union'],
    ['probe-request--loop-token-without-foreach', 'probe-request--professions', (m) => { m.calls[0].args = ['$i']; }, 'calls.0.args', 'custom'],
    ['probe-request--foreach-forward-ref', 'probe-request--professions', (m) => { m.calls[2].forEach.countFrom = 'later'; }, 'calls.2.forEach.countFrom', 'custom'],
    ['probe-request--duplicate-call-id', 'probe-request--professions', (m) => { m.calls[1].id = 'profs'; }, 'calls.1.id', 'custom'],
    ['probe-request--fn-and-presence', 'probe-request--professions', (m) => { m.calls[0].presence = 'C_TradeSkillUI'; }, 'calls.0', 'custom'],
    ['probe-request--ttl-too-long', 'probe-request--professions', (m) => { m.ttlHours = 169; }, 'ttlHours', 'too_big'],
    ['probe-request--calls-empty', 'probe-request--professions', (m) => { m.calls = []; }, 'calls', 'too_small'],
    ['probe-request--after-unknown-event', 'probe-request--professions', (m) => { m.after = 'CHAT_MSG_WHISPER'; }, 'after', 'invalid_value'],
    ['probe-request--lua-source-key', 'probe-request--professions', (m) => { m.lua = 'SendChatMessage("hi")'; }, '', 'unrecognized_keys'],
    ['probe-result--string-too-long', 'probe-result--professions', (m) => { m.calls[1].values = ['x'.repeat(513)]; }, 'calls.1.values.0', 'too_big'],
    ['probe-result--unknown-status', 'probe-result--professions', (m) => { m.calls[0].status = 'skipped'; }, 'calls.0.status', 'invalid_value'],
    ['health--bridge-version-2', 'health', (m) => { m.bridgeVersion = 2; }, 'bridgeVersion', 'invalid_value'],
    ['sv-raw--parent-path', 'sv-raw', (m) => { m.path = '../../secrets.txt'; }, 'path', 'custom'],
    ['probe-list--missing-next', 'probe-list', (m) => { delete m.next; }, 'next', 'invalid_type'],
    ['logs--unredacted-token', 'logs', (m) => { m.lines[1].msg = 'rejected Authorization: Bearer rlcdev_abc123'; }, 'lines.1.msg', 'custom'],
    ['error--unknown-code', 'error--unauthorized', (m) => { m.error = 'teapot'; }, 'error', 'invalid_value'],
];

const schemaFor = (name) => {
    const key = name.split('--')[0];
    const schema = DEV_BRIDGE_MESSAGES[key];
    if (!schema) throw new Error(`no message schema for ${name}`);
    return schema;
};

rmSync(FIX, { recursive: true, force: true });
mkdirSync(INVALID, { recursive: true });
for (const [name, value] of Object.entries(VALID)) {
    schemaFor(name).parse(value);
    write(FIX, name, value);
}
const expected = {};
let failed = 0;
for (const [name, base, mutate, path, code] of CASES) {
    const value = clone(VALID[base]);
    mutate(value);
    const res = schemaFor(name).safeParse(value);
    const hit = !res.success && res.error.issues.some((i) => i.path.join('.') === path && i.code === code);
    if (!hit) {
        failed += 1;
        console.error(`${name}: expected ${path} ${code}, got`, res.success ? 'success' : res.error.issues.map((i) => `${i.path.join('.')} ${i.code}`));
    }
    write(INVALID, name, value);
    expected[name] = { path, code };
}
writeFileSync(join(INVALID, 'EXPECTED.json'), `${JSON.stringify(expected, null, 2)}\n`);
console.log(`wrote ${Object.keys(VALID).length} valid + ${CASES.length} invalid fixtures`);
process.exit(failed === 0 ? 0 : 1);
