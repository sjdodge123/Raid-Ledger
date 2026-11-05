// BG3 catalogue + characterKeyPrefix dev-bridge fixtures (ROK-2079 OQ-4,
// ROK-2081 ruling 6), imported by gen-companion-dev-bridge-fixtures.mjs.
// Every value is synthetic: key prefixes are made-up hex, pak entry paths and
// item names are public game-data examples, never a real install path.

const AT = '2026-11-04T20:15:00Z';
const COLLECTORS = [
    { id: 'wow-ledgerlink', enabled: true, paused: false, lastScanAt: AT, lastUploadAt: null, pending: 0 },
    { id: 'bg3-save', enabled: true, paused: false, lastScanAt: AT, lastUploadAt: AT, pending: 0 },
];
const report = {
    state: 'ready', reason: null, buildMs: 41_250, builtAt: '2026-11-04T20:01:12Z',
    counts: { items: 18_402, origins: 11, quests: 412, waypoints: 0, skipped: 3 },
    lastLookup: { total: 8, resolvedName: 7, resolvedRarity: 7, at: AT },
};
const absentReport = { state: 'absent', reason: 'unsupported-store', buildMs: null, builtAt: null, counts: null, lastLookup: null };

const entry = (name, sizeOnDisk, size, method, part = 0) => ({ name, sizeOnDisk, size, method, part });
const install = {
    found: true, store: 'steam', next: null,
    paks: [
        { rel: 'Shared.pak', parts: 1, entriesMatched: [
            entry('Public/Shared/Stats/Generated/Data/Armor.txt', 412_330, 2_901_442, 'lz4'),
            entry('Public/Shared/Stats/Generated/Data/Weapon.txt', 98_114, 701_220, 'lz4'),
        ] },
        { rel: 'Gustav.pak', parts: 3, entriesMatched: [
            entry('Public/Gustav/RootTemplates/_merged.lsf', 61_440_112, 188_220_416, 'zstd', 2),
            entry('Public/Gustav/Origins/Origins.lsx', 20_480, 88_120, 'lz4', 0),
        ] },
        { rel: 'Localization/English.pak', parts: 1, entriesMatched: [
            entry('Localization/English/english.loca', 9_910_552, 31_455_870, 'lz4'),
        ] },
    ],
};

const item = (slot, statsId, name, rarity) => ({ slot, statsId, name, rarity });
const catalogue = {
    saveRef: '3f9a0c2b7d41', catalogueState: 'ready', next: null,
    hitRate: { total: 4, resolvedName: 3, resolvedRarity: 3 },
    party: [
        { slot: 0, items: [item('Helmet', 'ARM_Hat', 'Hat', 'Common'), item('MeleeMainHand', 'WPN_Longsword', 'Longsword', 'Common')] },
        { slot: 1, items: [item('Cloak', null, null, null), item('Amulet', 'ARM_Amulet_Necromancy_Thay', 'Necromancy of Thay', 'Legendary')] },
    ],
};
const noCatalogue = {
    ...catalogue, catalogueState: 'failed', hitRate: { total: 4, resolvedName: 0, resolvedRarity: 0 },
    party: catalogue.party.map((r) => ({ ...r, items: r.items.map((i) => ({ ...i, name: null, rarity: null })) })),
};

export const CATALOGUE_VALID = {
    'collectors--bg3-catalogue': { collectors: COLLECTORS, bg3Catalogue: report },
    'collectors--bg3-catalogue-absent': { collectors: COLLECTORS, bg3Catalogue: absentReport },
    'bg3-install': install,
    'bg3-install--absent': { found: false, store: null, paks: [], next: null },
    'bg3-install--entries-page': { ...install, paks: [install.paks[1]], next: 'p2_paks_2' },
    'bg3-save-catalogue': catalogue,
    'bg3-save-catalogue--no-catalogue': noCatalogue,
};

/** Adds `characterKeyPrefix` to the first three party rows of the golden structure (row 3 keeps it absent). */
export const withCharacterKeys = (structure) => ({
    ...structure,
    party: structure.party.map((r, i) => (i < 3 ? { slot: r.slot, characterKeyPrefix: ['a41c09e7', '5be2d013', 'c7f0a6b4'][i], decoded: r.decoded } : r)),
});

const GUID_UNDASHED = '6f2b8c1e4d3a4b7e9a102c5d8e3f7a41';
const NAME = 'party.0.items.0.name';
/** [name, base valid fixture, mutate, expected path, expected code] */
export const CATALOGUE_CASES = [
    ['bg3-save-structure--character-key-prefix-upper', 'bg3-save-structure--character-keys', (m) => { m.party[0].characterKeyPrefix = 'A41C09E7'; }, 'party.0.characterKeyPrefix', 'invalid_format'],
    ['bg3-save-structure--character-key-prefix-long', 'bg3-save-structure--character-keys', (m) => { m.party[0].characterKeyPrefix = 'a41c09e7f'; }, 'party.0.characterKeyPrefix', 'invalid_format'],
    ['collectors--bg3-catalogue-extra-key', 'collectors--bg3-catalogue', (m) => { m.bg3Catalogue.installDir = 'Baldurs Gate 3'; }, 'bg3Catalogue', 'unrecognized_keys'],
    ['collectors--bg3-catalogue-ready-no-counts', 'collectors--bg3-catalogue', (m) => { m.bg3Catalogue.counts = null; }, 'bg3Catalogue.counts', 'custom'],
    ['collectors--bg3-catalogue-reason-wrong-state', 'collectors--bg3-catalogue-absent', (m) => { m.bg3Catalogue.reason = 'timeout'; }, 'bg3Catalogue.reason', 'custom'],
    ['collectors--bg3-catalogue-unknown-reason', 'collectors--bg3-catalogue-absent', (m) => { m.bg3Catalogue.reason = 'gog'; }, 'bg3Catalogue.reason', 'invalid_value'],
    ['collectors--bg3-catalogue-lookup-over-total', 'collectors--bg3-catalogue', (m) => { m.bg3Catalogue.lastLookup.resolvedName = 9; }, 'bg3Catalogue.lastLookup.resolvedName', 'custom'],
    ['bg3-install--drive-rel', 'bg3-install', (m) => { m.paks[0].rel = 'D:/Games/Baldurs Gate 3/Data/Shared.pak'; }, 'paks.0.rel', 'custom'],
    ['bg3-install--parent-rel', 'bg3-install', (m) => { m.paks[0].rel = '../Shared.pak'; }, 'paks.0.rel', 'custom'],
    ['bg3-install--rel-not-pak', 'bg3-install', (m) => { m.paks[0].rel = 'Shared.lsv'; }, 'paks.0.rel', 'invalid_format'],
    ['bg3-install--paks-when-absent', 'bg3-install', (m) => { m.found = false; }, 'paks', 'custom'],
    ['bg3-install--unknown-method', 'bg3-install', (m) => { m.paks[0].entriesMatched[0].method = 'deflate'; }, 'paks.0.entriesMatched.0.method', 'invalid_value'],
    ['bg3-install--duplicate-rel', 'bg3-install', (m) => { m.paks[1].rel = m.paks[0].rel; }, 'paks.1.rel', 'custom'],
    ['bg3-save-catalogue--character-name', 'bg3-save-catalogue', (m) => { m.party[0].characterName = 'Tav'; }, 'party.0', 'unrecognized_keys'],
    ['bg3-save-catalogue--name-without-catalogue', 'bg3-save-catalogue--no-catalogue', (m) => { m.party[0].items[0].name = 'Hat'; }, NAME, 'custom'],
    ['bg3-save-catalogue--hit-rate-over-total', 'bg3-save-catalogue', (m) => { m.hitRate.resolvedRarity = 5; }, 'hitRate.resolvedRarity', 'custom'],
    ['bg3-save-catalogue--guid-in-name', 'bg3-save-catalogue', (m) => { m.party[0].items[0].name = `Hat ${GUID_UNDASHED}`; }, NAME, 'custom'],
    ['bg3-save-catalogue--duplicate-item-slot', 'bg3-save-catalogue', (m) => { m.party[0].items[1].slot = 'Helmet'; }, 'party.0.items.1.slot', 'custom'],
    ['bg3-save-catalogue--next-path', 'bg3-save-catalogue', (m) => { m.next = 'Saves/Story/QuickSave_1'; }, 'next', 'invalid_format'],
];
