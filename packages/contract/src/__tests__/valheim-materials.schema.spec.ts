/**
 * ROK-1859 — the Materials read shape gains bases, personal.byBase and a
 * per-container base + index. All additive (optional); strict keys still hold.
 */
import { describe, it, expect } from "vitest";
import {
    ValheimContainerSummarySchema,
    ValheimMaterialsBaseSchema,
    ValheimMaterialsPersonalSchema,
    ValheimMaterialsResponseSchema,
    ValheimMaterialsTrendSchema,
} from "../valheim-materials.schema.js";

const KEY = "A".repeat(22);
const stack = { prefab: "Wood", quality: 1, total: 40, chests: 2 };
const base = { key: KEY, x: 3, z: -53, chestCount: 2, vehicleCount: 0, totals: [stack] };
const personal = { totals: [stack], chestCount: 1, omittedPrivate: null };
const response = {
    worldUid: "1234567890123",
    capturedAt: "2026-10-20T18:00:00.000Z",
    gameVersion: "0.220.5",
    catalogFallback: false,
    shared: {
        totals: [stack],
        chestCount: 2,
        warnings: { unreadable: 0, omittedEntries: 0, omittedShared: 0 },
    },
    personal,
    items: {},
    atlas: null,
};
const chest = {
    key: KEY, prefab: "piece_chest_wood", x: 1, y: 30, z: 2, privacy: "shared",
    vehicle: false, slots: 10, usedSlots: 1, unreadable: false, omittedEntries: 0, stackCount: 1,
};

describe("ValheimMaterialsBaseSchema", () => {
    it("parses a base and rejects an unknown key, a short key and zero chests", () => {
        expect(ValheimMaterialsBaseSchema.parse(base)).toEqual(base);
        expect(ValheimMaterialsBaseSchema.safeParse({ ...base, id: 1 }).success).toBe(false);
        expect(ValheimMaterialsBaseSchema.safeParse({ ...base, key: "short" }).success).toBe(false);
        expect(ValheimMaterialsBaseSchema.safeParse({ ...base, chestCount: 0 }).success).toBe(false);
    });
});

describe("ValheimMaterialsResponseSchema bases", () => {
    it("parses with and without bases (additive)", () => {
        expect(ValheimMaterialsResponseSchema.parse(response)).toEqual(response);
        const withBases = { ...response, bases: [base] };
        expect(ValheimMaterialsResponseSchema.parse(withBases)).toEqual(withBases);
    });

    it("still rejects an unknown top-level key", () => {
        expect(ValheimMaterialsResponseSchema.safeParse({ ...response, extra: 1 }).success).toBe(false);
    });
});

describe("ValheimMaterialsPersonalSchema byBase", () => {
    it("parses byBase with a base key and a null (away from bases) row", () => {
        const byBase = [
            { base: KEY, chestCount: 1, totals: [stack] },
            { base: null, chestCount: 2, totals: [] },
        ];
        const p = { ...personal, byBase };
        expect(ValheimMaterialsPersonalSchema.parse(p)).toEqual(p);
    });

    it("rejects a byBase row with an unknown key", () => {
        const p = { ...personal, byBase: [{ base: null, chestCount: 1, totals: [], owner: "x" }] };
        expect(ValheimMaterialsPersonalSchema.safeParse(p).success).toBe(false);
    });
});

describe("ValheimContainerSummarySchema base + index", () => {
    it("parses without, with a base and with a null base", () => {
        expect(ValheimContainerSummarySchema.parse(chest)).toEqual(chest);
        const based = { ...chest, base: KEY, index: 2 };
        expect(ValheimContainerSummarySchema.parse(based)).toEqual(based);
        const away = { ...chest, base: null, index: 1 };
        expect(ValheimContainerSummarySchema.parse(away)).toEqual(away);
    });

    it("rejects index 0 and an unknown key", () => {
        expect(ValheimContainerSummarySchema.safeParse({ ...chest, index: 0 }).success).toBe(false);
        expect(ValheimContainerSummarySchema.safeParse({ ...chest, id: 9 }).success).toBe(false);
    });
});

describe("ValheimMaterialsTrendSchema (ROK-2014)", () => {
    const day = (date: string, gains: Record<string, number> = { Wood: 20, Stone: -10 }) => ({ date, gains });
    const trend = { days: [day("2026-10-17"), day("2026-10-16", {}), day("2026-10-14")] };

    it("parses up to 3 days with integer gains, empty gains allowed", () => {
        expect(ValheimMaterialsTrendSchema.parse(trend)).toEqual(trend);
        expect(ValheimMaterialsTrendSchema.parse({ days: [] })).toEqual({ days: [] });
    });

    it("rejects 4 days, a non-integer gain, a bad date and an unknown key", () => {
        const four = { days: [...trend.days, day("2026-10-11")] };
        expect(ValheimMaterialsTrendSchema.safeParse(four).success).toBe(false);
        const frac = { days: [day("2026-10-17", { Wood: 1.5 })] };
        expect(ValheimMaterialsTrendSchema.safeParse(frac).success).toBe(false);
        expect(ValheimMaterialsTrendSchema.safeParse({ days: [day("17/10/2026")] }).success).toBe(false);
        expect(ValheimMaterialsTrendSchema.safeParse({ days: [{ ...day("2026-10-17"), x: 1 }] }).success).toBe(false);
    });

    it("rides optionally on shared, personal, bases[] and personal.byBase[]", () => {
        const withTrend = {
            ...response,
            shared: { ...response.shared, trend },
            personal: { ...personal, trend, byBase: [{ base: KEY, chestCount: 1, totals: [stack], trend }] },
            bases: [{ ...base, trend }],
        };
        expect(ValheimMaterialsResponseSchema.parse(withTrend)).toEqual(withTrend);
        expect(ValheimMaterialsResponseSchema.parse(response)).toEqual(response);
        const bad = { ...response, shared: { ...response.shared, trend: { days: [day("x")] } } };
        expect(ValheimMaterialsResponseSchema.safeParse(bad).success).toBe(false);
    });
});
