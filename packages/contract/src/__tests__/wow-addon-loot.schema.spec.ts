/**
 * ROK-2184 — the LedgerLink v2 `loot` section. Caps, strict keys, enum
 * spellings and the window refinements (spec §Size caps, rulings Q4/Q5/Q9).
 * Every rule is asserted from both sides: the base passes, one mutation fails.
 */
import { describe, it, expect } from 'vitest';
import {
    ADDON_LOOT_ATTRIBUTION_WINDOW_SECONDS,
    ADDON_LOOT_DEDUP_BUCKET_SECONDS,
    ADDON_LOOT_DEFAULT_MIN_QUALITY,
    ADDON_LOOT_DROPS_MAX,
    ADDON_LOOT_ENCOUNTER_NAME_MAX,
    ADDON_LOOT_LINK_MAX,
    ADDON_LOOT_LOOTER_NAME_MAX,
    ADDON_LOOT_QUANTITY_MAX,
    ADDON_LOOT_WINDOW_DAYS,
    AddonLootDataSchema,
    AddonLootDropSchema,
    AddonLootImportSummarySchema,
    AddonLootMethodSchema,
} from '../index.js';

const AT = 1_790_000_000;
const drop = {
    at: AT - 600,
    itemId: 16800,
    quantity: 1,
    quality: 4,
    looterName: 'Lootero',
    looterGuid: 'Player-0000-00000002',
    method: 'master',
    instanceId: 409,
    difficultyId: 9,
    encounterId: 663,
    encounterName: 'Example Boss',
};
const data = (drops: unknown[] = [drop], over: Record<string, unknown> = {}) => ({
    windowStart: AT - 30 * 86_400, windowEnd: AT, minQuality: 2, drops, ...over,
});
const okDrop = (over: Record<string, unknown>) => AddonLootDropSchema.safeParse({ ...drop, ...over }).success;
const okData = (d: unknown) => AddonLootDataSchema.safeParse(d).success;

describe('loot constants (spec §Size caps, Q4/Q5/Q9)', () => {
    it('pins every cap', () => {
        expect({
            drops: ADDON_LOOT_DROPS_MAX,
            looterName: ADDON_LOOT_LOOTER_NAME_MAX,
            encounterName: ADDON_LOOT_ENCOUNTER_NAME_MAX,
            link: ADDON_LOOT_LINK_MAX,
            quantity: ADDON_LOOT_QUANTITY_MAX,
            dedupBucket: ADDON_LOOT_DEDUP_BUCKET_SECONDS,
            attribution: ADDON_LOOT_ATTRIBUTION_WINDOW_SECONDS,
            windowDays: ADDON_LOOT_WINDOW_DAYS,
            minQuality: ADDON_LOOT_DEFAULT_MIN_QUALITY,
        }).toEqual({
            drops: 500, looterName: 100, encounterName: 128, link: 512, quantity: 1000,
            dedupBucket: 120, attribution: 300, windowDays: 30, minQuality: 2,
        });
    });
});

describe('AddonLootDropSchema', () => {
    it('accepts the full drop and the minimal drop', () => {
        expect(okDrop({})).toBe(true);
        expect(AddonLootDropSchema.safeParse({
            at: AT, itemId: 1, quantity: 1, looterName: 'A', method: 'unknown',
        }).success).toBe(true);
    });

    it('spells the methods exactly', () => {
        expect(AddonLootMethodSchema.options).toEqual(['master', 'roll', 'direct', 'unknown']);
        expect(okDrop({ method: 'need' })).toBe(false);
    });

    it('is strict — a roll value or chat text rejects the drop', () => {
        expect(okDrop({ roll: 87 })).toBe(false);
        expect(okDrop({ chat: 'grats' })).toBe(false);
    });

    it('enforces string caps at the boundary', () => {
        expect(okDrop({ looterName: 'x'.repeat(100) })).toBe(true);
        expect(okDrop({ looterName: 'x'.repeat(101) })).toBe(false);
        expect(okDrop({ looterName: '' })).toBe(false);
        expect(okDrop({ encounterName: 'x'.repeat(128) })).toBe(true);
        expect(okDrop({ encounterName: 'x'.repeat(129) })).toBe(false);
        expect(okDrop({ link: 'x'.repeat(512) })).toBe(true);
        expect(okDrop({ link: 'x'.repeat(513) })).toBe(false);
    });

    it('enforces numeric ranges', () => {
        expect(okDrop({ quantity: 1000 })).toBe(true);
        expect(okDrop({ quantity: 1001 })).toBe(false);
        expect(okDrop({ quantity: 0 })).toBe(false);
        expect(okDrop({ itemId: 0 })).toBe(false);
        expect(okDrop({ quality: 7 })).toBe(true);
        expect(okDrop({ quality: 8 })).toBe(false);
        expect(okDrop({ at: AT * 1000 })).toBe(false);
        expect(okDrop({ itemId: '16800' })).toBe(false);
    });

    it('requires a well-formed GUID when one is sent', () => {
        expect(okDrop({ looterGuid: 'Player-0000-0000000g' })).toBe(false);
    });

    it('only accepts encounterName together with encounterId (Q4)', () => {
        const { encounterId: _omit, ...noId } = drop;
        expect(AddonLootDropSchema.safeParse(noId).success).toBe(false);
        const { encounterName: _name, ...trash } = noId;
        expect(AddonLootDropSchema.safeParse(trash).success).toBe(true);
    });
});

describe('AddonLootDataSchema', () => {
    it('accepts a window with drops and an empty window', () => {
        expect(okData(data())).toBe(true);
        expect(okData(data([]))).toBe(true);
    });

    it('caps drops at 500', () => {
        expect(okData(data(Array.from({ length: 500 }, () => drop)))).toBe(true);
        expect(okData(data(Array.from({ length: 501 }, () => drop)))).toBe(false);
    });

    it('requires windowStart, windowEnd and minQuality (Q9)', () => {
        const { minQuality: _q, ...noQuality } = data();
        expect(okData(noQuality)).toBe(false);
        const { windowStart: _s, ...noStart } = data();
        expect(okData(noStart)).toBe(false);
        expect(okData(data([], { minQuality: 8 }))).toBe(false);
    });

    it('rejects windowEnd before windowStart', () => {
        expect(okData(data([], { windowStart: AT, windowEnd: AT - 1 }))).toBe(false);
        expect(okData(data([], { windowStart: AT, windowEnd: AT }))).toBe(true);
    });

    it('rejects a drop outside the window, naming its path', () => {
        const res = AddonLootDataSchema.safeParse(data([drop, { ...drop, at: AT + 1 }]));
        expect(res.success).toBe(false);
        expect(res.error?.issues.map((i) => i.path.join('.'))).toEqual(['drops.1.at']);
        expect(okData(data([{ ...drop, at: AT - 30 * 86_400 - 1 }]))).toBe(false);
    });

    it('is strict at the data level', () => {
        expect(okData(data([], { bank: {} }))).toBe(false);
    });
});

describe('AddonLootImportSummarySchema', () => {
    it('carries drop counts and the window', () => {
        const summary = { drops: 4, newDrops: 3, duplicateDrops: 1, windowStart: 1, windowEnd: 2 };
        expect(AddonLootImportSummarySchema.parse(summary)).toEqual(summary);
        expect(AddonLootImportSummarySchema.safeParse({ ...summary, newDrops: -1 }).success).toBe(false);
    });
});
