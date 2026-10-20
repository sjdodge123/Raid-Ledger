// Regenerates packages/contract/valheim-link/v1/fixtures/ (ROK-1829).
// Every value is synthetic: fake SteamID64s (765611980000000xx), invented
// character and world names, no seeds. Run from the repo root:
//   node packages/contract/scripts/gen-valheim-link-fixtures.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { recipesFixtures } from './gen-valheim-link-fixtures.recipes.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, gzipSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'valheim-link', 'v1', 'fixtures');
const invalidDir = join(dir, 'invalid');
mkdirSync(invalidDir, { recursive: true });

const write = (d, name, value) =>
    writeFileSync(join(d, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
const clone = (v) => structuredClone(v);

const header = {
    schemaVersion: 1,
    serverId: 'srv_fixture_01',
    capturedAt: '2026-10-17T20:15:00Z',
    gameVersion: '0.220.5',
    modVersion: '1.0.0',
};
const identity = {
    steamId: '76561198000000001',
    playerId: '1000000000000001',
    name: 'Testviking',
    worldUid: '1234567890123',
    worldName: 'Fixtureheim',
};
const stack = (prefab, extra = {}) => ({
    prefab, stack: 1, quality: 1, variant: 0, durability: null, maxDurability: null, ...extra,
});
const sword = stack('SwordIron', { quality: 3, durability: 180.5, maxDurability: 250 });
const helmet = stack('HelmetBronze', { quality: 2, durability: 300, maxDurability: 400 });

const characterVanilla = {
    ...header,
    kind: 'character',
    character: identity,
    equipment: [
        { slot: 'rightHand', item: sword },
        { slot: 'head', item: helmet },
    ],
    inventory: {
        grid: { width: 8, height: 4, extraRows: [] },
        items: [
            { x: 0, y: 0, equipped: true, item: sword },
            { x: 1, y: 0, equipped: true, item: helmet },
            { x: 2, y: 0, equipped: false, item: stack('Wood', { stack: 50 }) },
            { x: 7, y: 3, equipped: false, item: stack('CookedMeat', { stack: 12 }) },
        ],
    },
    skills: [
        { id: 'Swords', level: 34.25, accumulator: 12.5 },
        { id: 'Run', level: 41, accumulator: 0 },
        { id: '-1287461328', level: 3.5, accumulator: 1.75 },
    ],
    trophies: ['TrophyBoar', 'TrophyEikthyr'],
    knownItems: ['Wood', 'Stone', 'Resin', 'CopperOre'],
    knownRecipes: ['SwordIron', 'HelmetBronze', 'CookedMeat'],
};

const characterEaqs = clone(characterVanilla);
// int64 boundaries: the most negative playerId and the largest world uid.
characterEaqs.character = {
    ...identity, steamId: '76561198000000002', playerId: '-9223372036854775808',
    name: 'Fixturebjorn', worldUid: '9223372036854775807',
};
characterEaqs.inventory.grid = {
    width: 8, height: 6,
    extraRows: [{ y: 4, purpose: 'equipment' }, { y: 5, purpose: 'quickslot' }],
};
characterEaqs.inventory.items[0] = { x: 0, y: 4, equipped: true, item: sword };
characterEaqs.inventory.items[1] = { x: 1, y: 4, equipped: true, item: helmet };
characterEaqs.inventory.items.push({ x: 0, y: 5, equipped: false, item: stack('MeadHealthMinor', { stack: 4 }) });

/** Packed LSB-first bitset of a disc of explored pixels, gzip + base64. */
function disc(size, cx, cy, r) {
    const bytes = Buffer.alloc(Math.ceil((size * size) / 8));
    for (let py = cy - r; py <= cy + r; py++) {
        for (let px = cx - r; px <= cx + r; px++) {
            if ((px - cx) ** 2 + (py - cy) ** 2 > r * r) continue;
            const i = py * size + px;
            bytes[i >> 3] |= 1 << (i & 7);
        }
    }
    const data = gzipSync(bytes, { level: 9 }).toString('base64');
    return { encoding: 'gzip+base64-bitset-lsb0', width: size, height: size, data };
}

const mapPersonal = {
    ...header,
    kind: 'map',
    character: { steamId: identity.steamId, playerId: identity.playerId, worldUid: identity.worldUid },
    grid: { textureSize: 2048, pixelSizeMetres: 12 },
    explored: disc(2048, 1024, 1024, 120),
    sharedExplored: null,
    pins: [
        { type: 'Icon0', label: 'Camp', x: 120.5, z: -42.25, checked: false, shared: false },
        { type: 'Death', label: '', x: 900, z: 1450, checked: true, shared: false },
        { type: 'Boss', label: 'Fixture boss', x: -300, z: 610, checked: false, shared: false },
    ],
    baseMap: null,
};

/** Deterministic incompressible bytes (LCG), so the fixture never changes. */
function noise(n) {
    const out = Buffer.alloc(n);
    let x = 0x2545f491;
    for (let i = 0; i < n; i++) { x = (Math.imul(x, 1103515245) + 12345) >>> 0; out[i] = x >>> 24; }
    return out;
}
const bitmapWith = (size, data) => ({ encoding: 'gzip+base64-bitset-lsb0', width: size, height: size, data });

const sha = (c) => c.repeat(64);
const mapShared = clone(mapPersonal);
mapShared.sharedExplored = disc(2048, 1100, 980, 200);
mapShared.pins.push({ type: 'Icon3', label: 'Shared portal', x: 1200, z: -800, checked: false, shared: true });
mapShared.baseMap = { sha256: sha('a'), byteLength: 3_145_728, contentType: 'image/png', width: 2048, height: 2048 };

const itemDef = (prefab, name, category, icon, extra = {}) => ({
    prefab, name, category, maxStack: 1, maxQuality: 4, variants: 0, icon, ...extra,
});
const itemsAtlas = {
    ...header,
    kind: 'items',
    locale: 'English',
    atlas: { sha256: sha('b'), byteLength: 2_097_152, contentType: 'image/png', width: 1024, height: 1024 },
    items: [
        itemDef('SwordIron', 'Iron sword', 'OneHandedWeapon', { kind: 'atlas', x: 0, y: 0, w: 64, h: 64 }),
        itemDef('HelmetBronze', 'Bronze helmet', 'Helmet', { kind: 'atlas', x: 64, y: 0, w: 64, h: 64 }),
        itemDef('Wood', 'Wood', 'Material', { kind: 'atlas', x: 128, y: 0, w: 64, h: 64 }, { maxStack: 50, maxQuality: 1 }),
        itemDef('CapeLinen', 'Linen cape', 'Shoulder', { kind: 'atlas', x: 960, y: 960, w: 64, h: 64 }, { variants: 7 }),
    ],
};
const itemsFiles = {
    ...itemsAtlas,
    atlas: null,
    items: [
        // ROK-1833: one file icon references its uploaded blob, one does not.
        itemDef('SwordIron', 'Iron sword', 'OneHandedWeapon', {
            kind: 'file',
            file: 'SwordIron.png',
            blob: { sha256: sha('c'), byteLength: 4096, contentType: 'image/png', width: 64, height: 64 },
        }),
        itemDef('FixtureModdedAxe', 'Fixture axe', 'TwoHandedWeapon', { kind: 'file', file: 'FixtureModdedAxe.png' }),
        itemDef('FixtureNoIcon', 'Fixture thing', 'Misc', null, { maxStack: 10, maxQuality: 1 }),
    ],
};

const valid = {
    'character-vanilla': characterVanilla,
    'character-eaqs': characterEaqs,
    'map-personal': mapPersonal,
    'map-shared-layer': mapShared,
    'items-atlas': itemsAtlas,
    'items-file-icons': itemsFiles,
};
for (const [name, v] of Object.entries(valid)) write(dir, name, v);

/** `<prefix>-<case>` fixtures putting each junk value in `character.<field>`. */
const idJunk = (prefix, field, values) =>
    Object.fromEntries(Object.entries(values).map(([k, v]) => [
        `${prefix}-${k}`,
        [{ ...characterVanilla, character: { ...identity, [field]: v } }, { path: `character.${field}`, code: 'invalid_format' }],
    ]));

/** name → [message, { path, code }] of the issue it must raise. */
const invalid = {
    'unknown-top-level-key': [{ ...characterVanilla, worldSeed: 'FAKESEED' }, { path: '', code: 'unrecognized_keys' }],
    'steamid-as-number': [{ ...characterVanilla, character: { ...identity, steamId: 76561198000000001 } }, { path: 'character.steamId', code: 'invalid_type' }],
    'schema-version-2': [{ ...characterVanilla, schemaVersion: 2 }, { path: 'schemaVersion', code: 'invalid_value' }],
    'unknown-kind': [{ ...characterVanilla, kind: 'world' }, { path: 'kind', code: 'invalid_union' }],
    'inventory-slot-outside-grid': [(() => { const c = clone(characterVanilla); c.inventory.items[3].x = 8; return c; })(), { path: 'inventory.items.3', code: 'custom' }],
    'duplicate-equip-slot': [(() => { const c = clone(characterVanilla); c.equipment[1].slot = 'rightHand'; return c; })(), { path: 'equipment.1', code: 'custom' }],
    'durability-half-null': [(() => { const c = clone(characterVanilla); c.equipment[0].item = { ...sword, maxDurability: null }; return c; })(), { path: 'equipment.0.item.maxDurability', code: 'custom' }],
    'map-bitmap-size-mismatch': [{ ...mapPersonal, explored: disc(1024, 512, 512, 60) }, { path: 'explored', code: 'custom' }],
    'items-atlas-icon-without-atlas': [{ ...itemsAtlas, atlas: null }, { path: 'atlas', code: 'custom' }],
    'items-file-icon-blob-bad-sha': [{ ...itemsFiles, items: [itemDef('SwordIron', 'Iron sword', 'OneHandedWeapon', { kind: 'file', file: 'SwordIron.png', blob: { sha256: 'nope', byteLength: 4096, contentType: 'image/png', width: 64, height: 64 } })] }, { path: 'items.0.icon.blob.sha256', code: 'invalid_format' }],
    'int64-out-of-range': [{ ...characterVanilla, character: { ...identity, playerId: '9223372036854775808' } }, { path: 'character.playerId', code: 'custom' }],
    'int64-leading-zero': [{ ...characterVanilla, character: { ...identity, playerId: '01000000000000001' } }, { path: 'character.playerId', code: 'invalid_format' }],
    'mod-version-not-semver': [{ ...characterVanilla, modVersion: '01.0.0' }, { path: 'modVersion', code: 'invalid_format' }],
    'steamid-below-individual-base': [{ ...characterVanilla, character: { ...identity, steamId: '76561197960265727' } }, { path: 'character.steamId', code: 'custom' }],
    // Junk id spellings: the regex aborts, so the range refine never meets
    // them (`BigInt('abc')` would throw out of safeParse). int64 '-1' is a
    // valid long, so the int64 negative case is '-0'.
    ...idJunk('steamid', 'steamId', { 'not-digits': 'abc', negative: '-1', exponent: '1e5', '40-digits': '1'.repeat(40) }),
    ...idJunk('int64', 'playerId', { 'not-digits': 'abc', 'negative-zero': '-0', exponent: '1e5', '40-digits': '1'.repeat(40) }),
    'captured-at-too-precise': [{ ...characterVanilla, capturedAt: '2026-10-17T20:15:00.1234Z' }, { path: 'capturedAt', code: 'too_big' }],
    'extra-row-unlisted': [(() => { const c = clone(characterEaqs); c.inventory.grid.extraRows.pop(); return c; })(), { path: 'inventory.grid.extraRows', code: 'custom' }],
    'extra-row-vanilla': [(() => { const c = clone(characterVanilla); c.inventory.grid.extraRows = [{ y: 2, purpose: 'other' }]; return c; })(), { path: 'inventory.grid.extraRows.0', code: 'custom' }],
    // Schema-level bitmap rejections. Corrupt / short / bomb gzip that LOOKS
    // valid is the server's job (CONTRACT.md §6) — the api spec covers it.
    'map-bitmap-not-gzip': [{ ...mapPersonal, explored: bitmapWith(2048, deflateSync(Buffer.alloc(524_288)).toString('base64')) }, { path: 'explored.data', code: 'invalid_format' }],
    'map-bitmap-empty': [{ ...mapPersonal, explored: bitmapWith(2048, '') }, { path: 'explored.data', code: 'too_small' }],
    'map-bitmap-oversized-compressed': [{ ...mapPersonal, grid: { textureSize: 64, pixelSizeMetres: 12 }, explored: bitmapWith(64, gzipSync(noise(4096), { level: 0 }).toString('base64')) }, { path: 'explored.data', code: 'custom' }],
    'map-basemap-size-mismatch': [{ ...mapShared, baseMap: { ...mapShared.baseMap, width: 1024, height: 1024 } }, { path: 'baseMap', code: 'custom' }],
};
const recipes = recipesFixtures(header);
for (const [name, v] of Object.entries(recipes.valid)) write(dir, name, v);
const expected = {};
for (const [name, [msg, want]] of Object.entries({ ...invalid, ...recipes.invalid })) {
    write(invalidDir, name, msg);
    expected[name] = want;
}
write(invalidDir, 'EXPECTED', expected);
console.log(`wrote ${Object.keys(valid).length} valid + ${Object.keys(invalid).length} invalid fixtures to ${dir}`);
