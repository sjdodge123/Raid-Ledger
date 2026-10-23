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

const STEAM = "76561198000000001";
const player = {
    steamId: STEAM,
    name: "Ragnar",
    deaths: 3,
    lastDeathAt: "2026-10-20T18:00:00.000Z",
    characterId: 7,
};
const pin = { x: 10.5, z: -20, steamId: STEAM, characterName: "Ragnar", type: "Death" };

describe("ValheimDeathPlayerSchema", () => {
    it("parses an attributed player and a name-only one", () => {
        expect(ValheimDeathPlayerSchema.parse(player)).toEqual(player);
        const nameOnly = { ...player, steamId: null, characterId: null };
        expect(ValheimDeathPlayerSchema.parse(nameOnly)).toEqual(nameOnly);
    });
    it("rejects zero deaths, an empty name, a bad SteamID and extra keys", () => {
        expect(ValheimDeathPlayerSchema.safeParse({ ...player, deaths: 0 }).success).toBe(false);
        expect(ValheimDeathPlayerSchema.safeParse({ ...player, name: "" }).success).toBe(false);
        expect(ValheimDeathPlayerSchema.safeParse({ ...player, steamId: "123" }).success).toBe(false);
        expect(ValheimDeathPlayerSchema.safeParse({ ...player, userId: 1 }).success).toBe(false);
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
    it("rejects a pin with no SteamID or an unknown key", () => {
        expect(ValheimDeathPinSchema.safeParse({ ...pin, steamId: null }).success).toBe(false);
        expect(ValheimDeathPinSchema.safeParse({ ...pin, at: "x" }).success).toBe(false);
    });
});
