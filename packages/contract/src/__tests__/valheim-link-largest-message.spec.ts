import { describe, expect, it } from 'vitest';
import {
    VALHEIM_LINK_BINARY_MAX_BYTES,
    VALHEIM_LINK_BITMAP_DATA_MAX_CHARS,
    VALHEIM_LINK_BITMAP_EDGE_MAX,
    VALHEIM_LINK_CHARACTER_MAX_BYTES,
    VALHEIM_LINK_PIECES_MAX,
    VALHEIM_LINK_PROCESSES_MAX,
    VALHEIM_LINK_PROCESSORS_MAX,
    VALHEIM_LINK_RECIPE_ENTRIES_MAX,
    VALHEIM_LINK_RECIPES_MAX,
    VALHEIM_LINK_RECIPES_MAX_BYTES,
    VALHEIM_LINK_REQUIREMENTS_MAX,
    VALHEIM_LINK_STATION_LEVEL_MAX,
    VALHEIM_LINK_STATIONS_MAX,
    VALHEIM_LINK_GRID_EDGE_MAX,
    VALHEIM_LINK_INT64_MIN,
    VALHEIM_LINK_INVENTORY_ITEMS_MAX,
    VALHEIM_LINK_ITEMS_MAX_BYTES,
    VALHEIM_LINK_ITEM_EXPORT_MAX,
    VALHEIM_LINK_KNOWN_MAX,
    VALHEIM_LINK_MAP_MAX_BYTES,
    VALHEIM_LINK_PINS_MAX,
    VALHEIM_LINK_SKILLS_MAX,
    VALHEIM_LINK_TROPHIES_MAX,
} from '../valheim-link-common.schema.js';
import { VALHEIM_LINK_VANILLA_ROWS, ValheimEquipSlotSchema } from '../valheim-link-character.schema.js';
import { VALHEIM_LINK_WORLD_COORD_MAX } from '../valheim-link-map.schema.js';
import { ValheimLinkMessageSchema } from '../valheim-link-message.schema.js';

/**
 * ROK-1855 — CONTRACT.md §7 promises that a schema-valid message never trips
 * its kind's body cap: the array and string caps are what bind. These builders
 * fill every array, put every string at its maximum length (free text as
 * control characters, which JSON escapes to 6 bytes each) and pick the longest
 * numeric literals the limits allow, so the next field added to a kind fails
 * here instead of in production (the `items` file-icon `blob` did exactly
 * that: ≈ 11.05 MB against a 10 MiB cap).
 */

/** UTF-8 length without node types: one to four bytes per code point. */
function utf8Bytes(s: string): number {
    let n = 0;
    for (const ch of s) {
        const c = ch.codePointAt(0) ?? 0;
        n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
    }
    return n;
}
/** Free text: control characters serialise as `\u0001` — six bytes a char. */
const ctl = (n: number): string => '\u0001'.repeat(n);
/** SteamID64 is exactly 17 digits, so this is its widest form. */
const STEAMID64_LARGEST = '9'.repeat(17);
/** A unique prefab id at the 96-char limit of `ValheimPrefabIdSchema`. */
const prefab = (i: number): string => `p${i}`.padEnd(96, 'x');
const binaryRef = (edge: number) => ({
    sha256: 'f'.repeat(64),
    byteLength: VALHEIM_LINK_BINARY_MAX_BYTES,
    contentType: 'image/png' as const,
    width: edge,
    height: edge,
});
const header = {
    schemaVersion: 1 as const,
    serverId: 'S'.repeat(64),
    capturedAt: '2026-01-01T00:00:00.000Z',
    gameVersion: '9999.99999.99999.99999',
    modVersion: `99999.99999.99999-${'a'.repeat(46)}`,
};
const itemStack = (i: number) => ({
    prefab: prefab(i),
    stack: 100_000,
    quality: 10,
    variant: 63,
    durability: 999999.9999999999,
    maxDurability: 999999.9999999999,
});

function largestCharacter(): unknown {
    const edge = VALHEIM_LINK_GRID_EDGE_MAX;
    return {
        ...header,
        kind: 'character',
        character: {
            steamId: STEAMID64_LARGEST,
            playerId: VALHEIM_LINK_INT64_MIN,
            name: ctl(32),
            worldUid: VALHEIM_LINK_INT64_MIN,
            worldName: ctl(64),
        },
        // Slots must be unique, so the 32-entry cap is bounded by the 9 slots.
        equipment: ValheimEquipSlotSchema.options.map((slot, i) => ({ slot, item: itemStack(i) })),
        inventory: {
            grid: {
                width: edge,
                height: edge,
                extraRows: Array.from({ length: edge - VALHEIM_LINK_VANILLA_ROWS }, (_, i) => ({
                    y: VALHEIM_LINK_VANILLA_ROWS + i,
                    purpose: 'equipment',
                })),
            },
            items: Array.from({ length: VALHEIM_LINK_INVENTORY_ITEMS_MAX }, (_, i) => ({
                x: i % edge,
                y: Math.floor(i / edge),
                equipped: true,
                item: itemStack(i),
            })),
        },
        skills: Array.from({ length: VALHEIM_LINK_SKILLS_MAX }, (_, i) => ({
            id: `-s${i}`.padEnd(64, 's'),
            level: 99.99999999999999,
            accumulator: 999999.9999999999,
        })),
        trophies: Array.from({ length: VALHEIM_LINK_TROPHIES_MAX }, (_, i) => prefab(i)),
        knownItems: Array.from({ length: VALHEIM_LINK_KNOWN_MAX }, (_, i) => prefab(i)),
        knownRecipes: Array.from({ length: VALHEIM_LINK_KNOWN_MAX }, (_, i) => prefab(i)),
    };
}

function largestMap(): unknown {
    const edge = VALHEIM_LINK_BITMAP_EDGE_MAX;
    const bitmap = {
        encoding: 'gzip+base64-bitset-lsb0',
        width: edge,
        height: edge,
        data: `H4sI${'A'.repeat(VALHEIM_LINK_BITMAP_DATA_MAX_CHARS - 4)}`,
    };
    const coord = -(VALHEIM_LINK_WORLD_COORD_MAX - 0.000000000004);
    return {
        ...header,
        kind: 'map',
        character: { steamId: STEAMID64_LARGEST, playerId: VALHEIM_LINK_INT64_MIN, worldUid: VALHEIM_LINK_INT64_MIN },
        grid: { textureSize: edge, pixelSizeMetres: 255.99999999999997 },
        explored: bitmap,
        sharedExplored: bitmap,
        pins: Array.from({ length: VALHEIM_LINK_PINS_MAX }, () => ({
            type: 'T'.repeat(32),
            label: ctl(64),
            x: coord,
            z: coord,
            checked: true,
            shared: true,
        })),
        baseMap: binaryRef(edge),
    };
}

function largestItems(): unknown {
    return {
        ...header,
        kind: 'items',
        locale: 'L'.repeat(32),
        atlas: binaryRef(16_384),
        items: Array.from({ length: VALHEIM_LINK_ITEM_EXPORT_MAX }, (_, i) => ({
            prefab: prefab(i),
            name: ctl(96),
            category: 'C'.repeat(48),
            maxStack: 100_000,
            maxQuality: 10,
            variants: 64,
            // A file icon with its blob reference is the widest icon shape.
            icon: { kind: 'file', file: `${'f'.repeat(100)}.png`, blob: binaryRef(16_384) },
        })),
    };
}

// ROK-1854 — `recipes`: the 12 000-entry budget binds; 1 input per process first,
// then 16 resources per recipe until it is spent, then empty recipes and pieces.
const atlasIcon = { kind: 'atlas', x: 15_872, y: 15_872, w: 512, h: 512 };
const recipeResource = (j: number) => ({
    prefab: prefab(j), amount: 10_000, amountPerLevel: 10_000, extraAmountOnlyOneIngredient: 10_000, recover: false, upgraderResource: false,
});
function recipeAt(i: number, resourceCount: number) {
    return {
        id: `r${i}`.padEnd(96, 'x'), result: prefab(i), amount: 10_000, enabled: false, station: prefab(0), repairStation: prefab(0),
        minStationLevel: VALHEIM_LINK_STATION_LEVEL_MAX, upgradeOnly: false, anyOneOf: false, qualityResultAmountMultiplier: 99.99999999999997,
        formula: 'vanilla', resources: Array.from({ length: resourceCount }, (_, j) => recipeResource(j)),
    };
}
function pieceAt(i: number) {
    return { prefab: prefab(i), name: ctl(96), category: 'C'.repeat(48), tool: prefab(0), station: prefab(0), icon: atlasIcon, resources: [] };
}
function largestRecipes(): unknown {
    const inputs = VALHEIM_LINK_PROCESSES_MAX;
    const budget = VALHEIM_LINK_RECIPE_ENTRIES_MAX - inputs;
    const full = Math.floor(budget / VALHEIM_LINK_REQUIREMENTS_MAX);
    const rest = budget % VALHEIM_LINK_REQUIREMENTS_MAX;
    return {
        ...header,
        kind: 'recipes',
        locale: 'L'.repeat(32),
        atlas: binaryRef(16_384),
        stations: Array.from({ length: VALHEIM_LINK_STATIONS_MAX }, (_, i) => ({
            prefab: prefab(i), name: ctl(96), maxLevel: VALHEIM_LINK_STATION_LEVEL_MAX, stackableExtension: false, upgrader: false, icon: atlasIcon,
        })),
        recipes: Array.from({ length: VALHEIM_LINK_RECIPES_MAX }, (_, i) =>
            recipeAt(i, i < full ? VALHEIM_LINK_REQUIREMENTS_MAX : i === full ? rest : 0)),
        pieces: Array.from({ length: VALHEIM_LINK_PIECES_MAX }, (_, i) => pieceAt(i)),
        processors: Array.from({ length: VALHEIM_LINK_PROCESSORS_MAX }, (_, i) => ({
            prefab: prefab(i), type: 'incinerator', fuel: prefab(0), fuelPerProduct: 1_000, fuelSecondsPerUnit: 86399.99999999999,
            windPowered: false, requiresRoof: false, maxInput: 10_000, burntResult: prefab(0), defaultResult: { prefab: prefab(0), perInputs: 10_000 },
        })),
        processes: Array.from({ length: VALHEIM_LINK_PROCESSES_MAX }, (_, i) => ({
            processor: prefab(i % VALHEIM_LINK_PROCESSORS_MAX), inputs: [{ prefab: prefab(0), amount: 10_000 }], anyOneOf: false,
            output: { prefab: prefab(0), amount: 10_000 }, seconds: 604799.9999999999, priority: -10_000,
        })),
    };
}

const KINDS = [
    ['character', largestCharacter, VALHEIM_LINK_CHARACTER_MAX_BYTES],
    ['map', largestMap, VALHEIM_LINK_MAP_MAX_BYTES],
    ['items', largestItems, VALHEIM_LINK_ITEMS_MAX_BYTES],
    ['recipes', largestRecipes, VALHEIM_LINK_RECIPES_MAX_BYTES],
] as const;

describe.each(KINDS)('largest schema-valid %s message (ROK-1855)', (kind, build, cap) => {
    it(`is accepted by the schema and fits VALHEIM_LINK_${kind.toUpperCase()}_MAX_BYTES`, () => {
        const msg = build();
        const parsed = ValheimLinkMessageSchema.safeParse(msg);
        expect(parsed.success, JSON.stringify(parsed.error?.issues.slice(0, 3))).toBe(true);
        const bytes = utf8Bytes(JSON.stringify(msg));
        // A builder that quietly shrank would pass the cap for the wrong reason.
        expect(bytes).toBeGreaterThan(cap / 2);
        expect(bytes, `${kind}: ${bytes} bytes vs cap ${cap}`).toBeLessThanOrEqual(cap);
    });
});

describe('recipes entry cap (ROK-1854)', () => {
    it('one more resource over VALHEIM_LINK_RECIPE_ENTRIES_MAX is too_big at the root', () => {
        const msg = largestRecipes() as { recipes: Array<{ resources: unknown[] }> };
        const spare = msg.recipes.find((r) => r.resources.length < VALHEIM_LINK_REQUIREMENTS_MAX);
        if (!spare) throw new Error('builder left no recipe with room');
        spare.resources.push({ prefab: 'extra', amount: 1, amountPerLevel: 1, extraAmountOnlyOneIngredient: 0, recover: false });
        const res = ValheimLinkMessageSchema.safeParse(msg);
        expect(res.success).toBe(false);
        expect(res.error?.issues.some((i) => i.code === 'too_big' && i.path.length === 0)).toBe(true);
    });
});
