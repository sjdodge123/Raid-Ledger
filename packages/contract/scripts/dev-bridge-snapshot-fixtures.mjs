// LedgerLink dev snapshot fixtures (ROK-2072), imported by
// gen-companion-dev-bridge-fixtures.mjs (which wipes and rewrites the whole
// fixtures folder, so these cannot come from a second script).
// Every value is synthetic: no real name, realm, guild, GUID or Enum.GameRule
// member (`SyntheticRuleA/B` are placeholders, never a guessed real name).
// The max-size builders land EXACTLY on their caps (throws if they drift).

const SNAPSHOT_MAX = 49_152;
const HEAD_MAX = 4_096;
const ITEM_MAX = 3_072;
const PAGE_MAX = 16_384;
const ID = '01JBX7Q2M3N4P5R6S7T8V9W0XY';
const ID2 = '01JBX7Q2M3N4P5R6S7T8V9W0XZ';
const KEY = 'a3f1'.repeat(16); // = the sv-parsed fixture's guidHash (AC-11 join)

const bytes = (v) => Buffer.byteLength(JSON.stringify(v), 'utf8');
/** Split `total` chars over `slots` strings of ≤ cap chars, as evenly as possible. */
const spread = (total, slots, cap) => {
    if (total < 0 || total > slots * cap) throw new Error(`cannot spread ${total} over ${slots}×${cap}`);
    return Array.from({ length: slots }, (_, i) => 'x'.repeat(Math.floor(total / slots) + (i < total % slots ? 1 : 0)));
};
/** `build(strings)` with `slots` empty strings, then filled so it serialises to exactly `limit` bytes. */
const exact = (limit, slots, cap, build) => {
    const value = build(spread(limit - bytes(build(spread(0, slots, cap))), slots, cap));
    if (bytes(value) !== limit) throw new Error(`exact build is ${bytes(value)} bytes, wanted ${limit}`);
    return value;
};

const forever = {
    snapshotVersion: 1, addonVersion: '1.4.0', capturedAt: '2026-11-03T20:15:00Z', trigger: 'logout',
    client: { version: '1.60.1', build: '99999', buildDate: 'Nov 1 2026', interface: 11507, tocInterface: 11507, locale: 'enUS', region: 90 },
    character: { class: 'WARRIOR', level: 12, faction: 'Alliance', inGuild: true },
    ruleset: {
        isGameRuleActive: 'function', enumGameRule: 'table', rulesTruncated: false,
        rules: [{ name: 'SyntheticRuleA', value: 1, active: true }, { name: 'SyntheticRuleB', value: 2, active: false }],
        ledgerLink: { value: 'normal', source: 'detected' },
    },
    calls: [
        { fn: 'UnitGUID', args: ['player'], status: 'presence', type: 'function' },
        { fn: 'GetRealmName', status: 'presence', type: 'function' },
        { fn: 'GetBuildInfo', status: 'ok', values: ['1.60.1', '99999', 'Nov 1 2026', 11507] },
        { fn: 'C_SkillInfo.GetNumSkillLines', status: 'missing' },
        { fn: 'GetMoney', status: 'ok', values: [12345] },
    ],
    apis: [
        { path: 'C_GameRules.GetForeverExperiencePreset', type: 'nil' },
        { path: 'C_GameRules.IsGameRuleActive', type: 'function' },
        { path: 'C_GameRules.IsHardcoreActive', type: 'nil' },
        { path: 'C_SkillInfo', type: 'nil' },
        { path: 'C_SkillInfo.GetSkillLineInfo', type: 'nil' },
        { path: 'Enum.GameRule', type: 'table' },
        { path: 'GetProfessions', type: 'function' },
        { path: 'GetSkillLineInfo', type: 'nil' },
    ],
    sections: [
        { id: 'S3', status: 'ok', lines: ['S3 talents: 3 tabs', 'tab 1: 5/21 points', 'quests in log: 4'] },
        { id: 'S9', status: 'ok', lines: ['S9 professions', 'GetProfessions: function', 'GetSkillLineInfo: nil', 'C_SkillInfo: nil'] },
    ],
    truncated: false,
};
const minimal = {
    ...structuredClone(forever),
    client: { version: '1.60.1', build: '99999', buildDate: 'Nov 1 2026', interface: 11507, tocInterface: null, locale: 'enUS', region: null },
    character: { class: null, level: null, faction: null, inGuild: false },
    ruleset: { isGameRuleActive: 'nil', enumGameRule: 'nil', rules: [], rulesTruncated: false, ledgerLink: { value: null, source: null } },
    calls: [{ fn: 'GetMoney', status: 'missing' }],
    apis: forever.apis.map(({ path }) => ({ path, type: 'nil' })),
    sections: [],
};

/** Filler calls (5 value strings each, ≤ 2.6 KiB per item) appended to `forever` until it sits at the 48 KiB cap. */
const fillerCalls = (strings) => Array.from({ length: strings.length / 5 }, (_, c) => ({ fn: 'GetCVar', status: 'ok', values: strings.slice(c * 5, c * 5 + 5) }));
const withFiller = (strings) => ({ ...structuredClone(forever), calls: [...forever.calls, ...fillerCalls(strings)], truncated: true });
const FILLER_CALLS = 19;
const maxSize = exact(SNAPSHOT_MAX, FILLER_CALLS * 5, 511, withFiller);

/** A head at exactly 4 KiB: 16 rules whose `error` strings carry the filler. */
const headRules = (strings) => strings.map((error, i) => ({ name: `SyntheticRule${String.fromCharCode(65 + i)}`, value: i + 1, active: null, error }));
const maxHeadSection = exact(ITEM_MAX, 40, 256, (lines) => ({ id: 'S9', status: 'ok', lines, truncated: true }));
const pageSnapshot = (strings) => ({
    ...structuredClone(forever), addonVersion: `9999.9999.9999-${'a'.repeat(49)}`,
    ruleset: { ...forever.ruleset, rules: headRules(strings), rulesTruncated: true },
    calls: [], apis: [], sections: [], truncated: true,
});
const headOf = ({ calls: _c, apis: _a, sections: _s, ...head }) => head;
const maxHeadSnapshot = { ...exact(HEAD_MAX, 16, 256, (s) => headOf(pageSnapshot(s))), calls: [], apis: [], sections: [maxHeadSection] };
const envelope = (snapshot) => ({
    flavor: `_${'z'.repeat(32)}_`, characterKey: 'f'.repeat(64), snapshotId: 'Z'.repeat(64), digest: 'e'.repeat(64),
    receivedAt: '2026-11-03T20:15:00.123Z', lastCapturedAt: '2026-11-03T20:15:00.123Z', seenCount: Number.MAX_SAFE_INTEGER, latest: false,
    snapshot, next: 'n'.repeat(128),
});
const maxPage = envelope(maxHeadSnapshot);

const page = {
    flavor: '_anniversary_', characterKey: KEY, snapshotId: ID, digest: '5d2c'.repeat(16),
    receivedAt: '2026-11-02T21:00:00Z', lastCapturedAt: '2026-11-03T20:15:00Z', seenCount: 3, latest: true,
    snapshot: forever, next: null,
};
const entry = (snapshotId, latest, capturedAt, missingApis) => ({
    snapshotId, flavor: '_anniversary_', characterKey: KEY, digest: (latest ? '5d2c' : '0b7e').repeat(16),
    capturedAt, lastCapturedAt: capturedAt, receivedAt: capturedAt, seenCount: latest ? 3 : 1, latest,
    addonVersion: '1.4.0', clientVersion: latest ? '1.60.1' : '1.15.7', clientBuild: '99999', interface: 11507,
    missingApis, activeRules: latest ? ['SyntheticRuleA'] : [], truncated: false,
});
const history = { entries: [entry(ID, true, '2026-11-03T20:15:00Z', 5), entry(ID2, false, '2026-11-01T18:30:00Z', 0)], next: null };

/** Sizes the generator prints; any drift off a cap throws here. */
export const SNAPSHOT_SIZES = { maxSize: bytes(maxSize), head: bytes(headOf(maxHeadSnapshot)), item: bytes(maxHeadSection), page: bytes(maxPage) };
if (SNAPSHOT_SIZES.head !== HEAD_MAX || SNAPSHOT_SIZES.item !== ITEM_MAX || SNAPSHOT_SIZES.page > PAGE_MAX) {
    throw new Error(`snapshot max fixtures are off their caps: ${JSON.stringify(SNAPSHOT_SIZES)}`);
}

export const SNAPSHOT_VALID = {
    'ledgerlink-snapshot--minimal': minimal,
    'ledgerlink-snapshot--forever': forever,
    'ledgerlink-snapshot--max-size': maxSize,
    'ledgerlink-snapshot-page': page,
    'ledgerlink-snapshot-page--max-page': maxPage,
    'ledgerlink-snapshot-history': history,
    'error--not-found': { error: 'not_found' },
};

/** Grows the first filler value string under 511 chars by one byte: 48 KiB + 1. */
const plusOneByte = (m) => {
    const call = m.calls.find((c) => c.fn === 'GetCVar');
    call.values[0] = `${call.values[0]}x`;
};
/** [name, base valid fixture, mutate, expected path, expected code] */
export const SNAPSHOT_CASES = [
    ['ledgerlink-snapshot--guid-in-line', 'ledgerlink-snapshot--forever', (m) => { m.sections[0].lines[0] = 'target Player-1234-0ABCDEF0'; }, 'sections.0.lines.0', 'custom'],
    ['ledgerlink-snapshot--snapshot-version-2', 'ledgerlink-snapshot--forever', (m) => { m.snapshotVersion = 2; }, 'snapshotVersion', 'invalid_value'],
    ['ledgerlink-snapshot--unknown-key-name', 'ledgerlink-snapshot--forever', (m) => { m.character.name = 'Testchar'; }, 'character', 'unrecognized_keys'],
    ['ledgerlink-snapshot--item-too-big', 'ledgerlink-snapshot--forever', (m) => { m.sections[0].lines = Array.from({ length: 40 }, () => 'x'.repeat(256)); }, 'sections.0', 'custom'],
    ['ledgerlink-snapshot--over-size', 'ledgerlink-snapshot--max-size', plusOneByte, '', 'custom'],
    ['ledgerlink-snapshot--presence-with-values', 'ledgerlink-snapshot--forever', (m) => { m.calls[0].values = ['x']; }, 'calls.0', 'custom'],
    ['ledgerlink-snapshot--duplicate-api', 'ledgerlink-snapshot--forever', (m) => { m.apis[1].path = m.apis[0].path; }, 'apis.1', 'custom'],
    ['ledgerlink-snapshot-page--character-key-short', 'ledgerlink-snapshot-page', (m) => { m.characterKey = 'a3f1'; }, 'characterKey', 'invalid_format'],
    ['ledgerlink-snapshot-history--missing-next', 'ledgerlink-snapshot-history', (m) => { delete m.next; }, 'next', 'invalid_type'],
];
