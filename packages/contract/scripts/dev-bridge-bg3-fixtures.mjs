// BG3 save dev-bridge fixtures (ROK-2077), imported by
// gen-companion-dev-bridge-fixtures.mjs (which wipes and rewrites the whole
// fixtures folder, so these cannot come from a second script).
// Every value is synthetic: no real save name, profile id, GUID or path.
// saveRefs / campaign-key prefixes are made-up hex, not hashes of anything.

const row = (saveRef, prefix, over = {}) => ({
    saveRef, campaignKeyPrefix: prefix, campaignKeySource: 'save-folder', gameVersion: '4.1.1.6848561',
    savedAt: '2026-11-02T21:40:00Z', partySize: 4, nonSummonCount: 4, clientCount: 4,
    lsfVersions: { meta: 7, globals: 7 }, newAgeBytes: 6_701_312, fallbackReason: null, ...over,
});

const saves = {
    saves: [
        row('3f9a0c2b7d41', '9c1e5a07'),
        row('b07e44d1a9c3', '9c1e5a07', { savedAt: '2026-11-01T19:05:00Z', clientCount: 1, partySize: 5, nonSummonCount: 4 }),
        row('e512f8a06b3d', '41d7b2e9', {
            campaignKeySource: 'file-name', gameVersion: null, clientCount: null, newAgeBytes: 0,
            lsfVersions: { meta: null, globals: 7 }, fallbackReason: 'meta-missing',
        }),
    ],
    next: null,
};

const T = (type, version, elementSize, count, decoder) => ({ type, version, elementSize, count, decoder });
const types = [
    T('core.v0.Level', 0, 16, 1, 'ok'),
    T('core.v0.EntityId', 0, 8, 41_220, 'ok'),
    T('game.stats.v3.StatsComponent', 3, 36, 2_310, 'ok'),
    T('game.stats.v0.HealthComponent', 0, 32, 2_288, 'ok'),
    T('game.stats.v0.ClassesComponent', 0, 16, 412, 'ok'),
    T('game.inventory.v0.WieldingComponent', 0, 8, 1_904, 'ok'),
    T('game.inventory.v0.MemberComponent', 0, 16, 3_116, 'ok'),
    T('game.icon.v0.CustomIconsStorageComponent', 0, 24, 1, 'unsupported'),
    T('game.approval.v0.Ratings', 0, 40, 9, 'none'),
    T('EAbility', 0, 4, 7, 'none'),
];
const checks = {
    partyEntitiesFound: 4, partyMatchesSaveInfo: true, portraitsFound: 8, portraitsMapped: 4,
    metaNamesMatchParty: true, ownerProfileMatchesLocal: true,
};
const member = (slot, abilities, classId, subclassId) => ({
    slot,
    decoded: {
        abilities, proficiencyBonus: 3, maxHp: 52,
        classLevels: [{ classId, subclassId, level: 6 }],
        equipment: [{ slot: 'Helmet', statsId: 'ARM_Hat' }, { slot: 'MeleeMainHand', statsId: 'WPN_Longsword' }],
    },
});
const structure = {
    saveRef: '3f9a0c2b7d41',
    types,
    checks,
    party: [
        member(0, { str: 17, dex: 14, con: 15, int: 8, wis: 12, cha: 10 }, 'Fighter', 'BattleMaster'),
        member(1, { str: 8, dex: 14, con: 14, int: 17, wis: 12, cha: 10 }, 'Wizard', 'EvocationSchool'),
        member(2, { str: 10, dex: 17, con: 14, int: 12, wis: 13, cha: 8 }, 'Rogue', null),
        { slot: 3, decoded: { classLevels: [{ classId: 'Cleric', subclassId: 'LifeDomain', level: 6 }], equipment: [{ slot: 'Cloak', statsId: null }] } },
    ],
    next: null,
};
const unsupported = {
    saveRef: 'b07e44d1a9c3',
    types: types.map((t) => ({ ...t, decoder: t.decoder === 'ok' ? 'unsupported' : t.decoder })),
    checks: { ...checks, partyEntitiesFound: 0, partyMatchesSaveInfo: false, portraitsMapped: 0, metaNamesMatchParty: false },
    party: [{ slot: 0, decoded: {} }, { slot: 1, decoded: {} }],
    next: null,
};
const typesPage = { saveRef: '3f9a0c2b7d41', types, checks, party: [], next: 'p2_types_10' };

export const BG3_VALID = {
    'bg3-saves': saves,
    'bg3-save-structure': structure,
    'bg3-save-structure--unsupported': unsupported,
    'bg3-save-structure--types-page': typesPage,
};

// Undashed only: the contract spec's anonymisation guard rejects any dashed GUID
// and any SteamID64 (7656119 + 10 digits) on disk, so the long-digit case is a
// synthetic 17-digit id and the real Steam64 shape is an in-memory spec case.
const GUID_UNDASHED = '6f2b8c1e4d3a4b7e9a102c5d8e3f7a41';
const GUID_UNDERSCORED = '6f2b8c1e_4d3a_4b7e_9a10_2c5d8e3f7a41';
const GUID_DOUBLE_UNDERSCORED = '6f2b8c1e__4d3a__4b7e__9a10__2c5d8e3f7a41';
const LARIAN_HANDLE_UPPER = 'H6F2B8C1EG4D3AG4B7EG9A10G2C5D8E3F7A41';
const LARIAN_HANDLE = 'h6f2b8c1eg4d3ag4b7eg9a10g2c5d8e3f7a41';
const CLASS = 'party.0.decoded.classLevels.0.classId';
const STATS = 'party.0.decoded.equipment.0.statsId';
/** [name, base valid fixture, mutate, expected path, expected code] */
export const BG3_CASES = [
    ['bg3-saves--extra-key-name', 'bg3-saves', (m) => { m.saves[0].name = 'Tav'; }, 'saves.0', 'unrecognized_keys'],
    ['bg3-saves--save-ref-file-name', 'bg3-saves', (m) => { m.saves[0].saveRef = 'QuickSave_179'; }, 'saves.0.saveRef', 'invalid_format'],
    ['bg3-saves--unknown-fallback-reason', 'bg3-saves', (m) => { m.saves[2].fallbackReason = 'corrupt'; }, 'saves.2.fallbackReason', 'invalid_value'],
    ['bg3-saves--over-size', 'bg3-saves', (m) => { m.saves = Array.from({ length: 64 }, (_, i) => ({ ...m.saves[0], saveRef: `abcdef${100000 + i}` })); }, '', 'custom'],
    ['bg3-saves--missing-next', 'bg3-saves', (m) => { delete m.next; }, 'next', 'invalid_type'],
    ['bg3-save-structure--extra-decoded-key', 'bg3-save-structure', (m) => { m.party[0].decoded.position = [12.5, 3, -40.25]; }, 'party.0.decoded', 'unrecognized_keys'],
    ['bg3-save-structure--guid-in-stats-id', 'bg3-save-structure', (m) => { m.party[0].decoded.equipment[0].statsId = `ARM_${GUID_UNDASHED}`; }, STATS, 'custom'],
    ['bg3-save-structure--guid-in-type', 'bg3-save-structure', (m) => { m.types[0].type = `game.g${GUID_UNDASHED}.v0`; }, 'types.0.type', 'custom'],
    ['bg3-save-structure--display-name-class-id', 'bg3-save-structure', (m) => { m.party[0].decoded.classLevels[0].classId = 'Tav the Brave'; }, 'party.0.decoded.classLevels.0.classId', 'invalid_format'],
    ['bg3-save-structure--path-in-stats-id', 'bg3-save-structure', (m) => { m.party[0].decoded.equipment[0].statsId = 'Saves/Story/QuickSave_179.lsv'; }, STATS, 'invalid_format'],
    ['bg3-save-structure--ability-out-of-range', 'bg3-save-structure', (m) => { m.party[0].decoded.abilities.str = 31; }, 'party.0.decoded.abilities.str', 'too_big'],
    ['bg3-save-structure--save-ref-path', 'bg3-save-structure', (m) => { m.saveRef = 'Saves/Tav-1'; }, 'saveRef', 'invalid_format'],
    ['bg3-save-structure--over-size', 'bg3-save-structure', (m) => { m.types = Array.from({ length: 160 }, (_, i) => ({ ...m.types[2], count: i })); }, '', 'custom'],
    ['bg3-save-structure--guid-underscored', 'bg3-save-structure', (m) => { m.party[0].decoded.equipment[0].statsId = `ARM_${GUID_UNDERSCORED}`; }, STATS, 'custom'],
    ['bg3-save-structure--guid-larian-handle', 'bg3-save-structure', (m) => { m.party[0].decoded.equipment[0].statsId = `ARM_${LARIAN_HANDLE}`; }, STATS, 'custom'],
    ['bg3-save-structure--stats-id-display-name', 'bg3-save-structure', (m) => { m.party[0].decoded.equipment[0].statsId = 'Astarion'; }, STATS, 'invalid_format'],
    ['bg3-save-structure--long-digit-id', 'bg3-save-structure', (m) => { m.party[0].decoded.equipment[0].statsId = 'ARM_90000000012345678'; }, STATS, 'custom'],
    ['bg3-save-structure--equipment-slot-free-text', 'bg3-save-structure', (m) => { m.party[0].decoded.equipment[0].slot = 'Lucky_hat'; }, 'party.0.decoded.equipment.0.slot', 'invalid_value'],
    ['bg3-save-structure--duplicate-slot', 'bg3-save-structure', (m) => { m.party[1].slot = 0; }, 'party.1.slot', 'custom'],
    ['bg3-save-structure--next-folder-name', 'bg3-save-structure', (m) => { m.next = 'Tav_1234__QuickSave_12'; }, 'next', 'invalid_format'],
    ['bg3-saves--duplicate-save-ref', 'bg3-saves', (m) => { m.saves[1].saveRef = m.saves[0].saveRef; }, 'saves.1.saveRef', 'custom'],
    ['bg3-save-structure--guid-double-underscored', 'bg3-save-structure', (m) => { m.party[0].decoded.equipment[0].statsId = `ARM_${GUID_DOUBLE_UNDERSCORED}`; }, STATS, 'custom'],
    ['bg3-save-structure--guid-larian-handle-upper', 'bg3-save-structure', (m) => { m.party[0].decoded.equipment[0].statsId = `ARM_${LARIAN_HANDLE_UPPER}`; }, STATS, 'custom'],
    ['bg3-save-structure--duplicate-equipment-slot', 'bg3-save-structure', (m) => { m.party[0].decoded.equipment[1].slot = 'Helmet'; }, 'party.0.decoded.equipment.1.slot', 'custom'],
    ['bg3-save-structure--hex-fragment-class-id', 'bg3-save-structure', (m) => { m.party[0].decoded.classLevels[0].classId = '6f2b8c1e'; }, CLASS, 'invalid_format'],
    ['bg3-saves--next-folder-name', 'bg3-saves', (m) => { m.next = 'Tav-1234__QuickSave_12'; }, 'next', 'invalid_format'],
];
