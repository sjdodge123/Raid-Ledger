/**
 * ROK-1930 — the Deaths widget + death-pin read shapes. One parse and at
 * least one reject case per schema; every shape is strict.
 */
import { describe, it, expect } from "vitest";
import {
    ValheimDeathPlayerSchema,
    ValheimDeathsResponseSchema,
    ValheimDeathPinSchema,
    ValheimDeathPinsResponseSchema,
} from "../valheim-deaths.schema.js";

const player = {
    key: "c7",
    name: "Ragnar",
    deaths: 3,
    lastDeathAt: "2026-10-20T18:00:00.000Z",
    characterId: 7,
};
const pin = { x: 10.5, z: -20, characterId: 7, characterName: "Ragnar", type: "Death" };

describe("ValheimDeathPlayerSchema", () => {
    it("parses an attributed player and a name-only one", () => {
        expect(ValheimDeathPlayerSchema.parse(player)).toEqual(player);
        const nameOnly = { ...player, key: "nRagnar", characterId: null };
        expect(ValheimDeathPlayerSchema.parse(nameOnly)).toEqual(nameOnly);
    });
    it("rejects zero deaths, an empty name, a bad key, a SteamID and extra keys", () => {
        expect(ValheimDeathPlayerSchema.safeParse({ ...player, deaths: 0 }).success).toBe(false);
        expect(ValheimDeathPlayerSchema.safeParse({ ...player, name: "" }).success).toBe(false);
        expect(ValheimDeathPlayerSchema.safeParse({ ...player, key: "" }).success).toBe(false);
        expect(ValheimDeathPlayerSchema.safeParse({ ...player, key: "76561198000000001" }).success).toBe(false);
        expect(ValheimDeathPlayerSchema.safeParse({ ...player, steamId: "76561198000000001" }).success).toBe(false);
        expect(ValheimDeathPlayerSchema.safeParse({ ...player, userId: 1 }).success).toBe(false);
    });
});

describe("ValheimDeathPlayerSchema pictures (ROK-1941 D13)", () => {
    const pic = (mediaId: number) => ({
        mediaId,
        thumbPath: `/hubs/1/media/${mediaId}/thumb`,
        capturedAt: "2026-10-20T18:00:00.000Z",
    });
    it("parses up to 3 pictures with a pictureCount", () => {
        const withPics = { ...player, pictures: [pic(1), pic(2), pic(3)], pictureCount: 5 };
        expect(ValheimDeathPlayerSchema.parse(withPics)).toEqual(withPics);
    });
    it("rejects 4 pictures, a negative count, a bad mediaId and extra picture keys", () => {
        const bad = (o: object) => ValheimDeathPlayerSchema.safeParse({ ...player, ...o }).success;
        expect(bad({ pictures: [pic(1), pic(2), pic(3), pic(4)] })).toBe(false);
        expect(bad({ pictureCount: -1 })).toBe(false);
        expect(bad({ pictures: [pic(0)] })).toBe(false);
        expect(bad({ pictures: [{ ...pic(1), fullPath: "/x" }] })).toBe(false);
        expect(bad({ pictures: [{ ...pic(1), capturedAt: "yesterday" }] })).toBe(false);
    });
});

describe("ValheimDeathsResponseSchema", () => {
    it("parses a list with since, and an empty list with since null", () => {
        const r = { players: [player], since: "2026-10-01T00:00:00.000Z" };
        expect(ValheimDeathsResponseSchema.parse(r)).toEqual(r);
        expect(ValheimDeathsResponseSchema.parse({ players: [], since: null })).toEqual({
            players: [],
            since: null,
        });
    });
    it("rejects more than 200 players and a non-ISO since", () => {
        const many = Array.from({ length: 201 }, () => player);
        expect(ValheimDeathsResponseSchema.safeParse({ players: many, since: null }).success).toBe(false);
        expect(ValheimDeathsResponseSchema.safeParse({ players: [], since: "yesterday" }).success).toBe(false);
    });
});

describe("ValheimDeathPinSchema / ValheimDeathPinsResponseSchema", () => {
    it("parses a pin list", () => {
        const r = { worldUid: "1234567890123", pins: [pin] };
        expect(ValheimDeathPinsResponseSchema.parse(r)).toEqual(r);
    });
    it("parses an unlinked pin; rejects a SteamID or an unknown key", () => {
        expect(ValheimDeathPinSchema.parse({ ...pin, characterId: null })).toEqual({ ...pin, characterId: null });
        expect(ValheimDeathPinSchema.safeParse({ ...pin, steamId: "76561198000000001" }).success).toBe(false);
        expect(ValheimDeathPinSchema.safeParse({ ...pin, at: "x" }).success).toBe(false);
    });
});
