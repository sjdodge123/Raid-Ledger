/**
 * ROK-1943 — the Map tab's cross-player pin layer: strict response shape and
 * the `players` / `types` comma-list query rules (S11).
 */
import { describe, it, expect } from "vitest";
import {
    ValheimServerPinSchema,
    ValheimServerPinsQuerySchema,
    ValheimServerPinsResponseSchema,
    VALHEIM_SERVER_PINS_CAP,
    VALHEIM_SERVER_PINS_PLAYERS_MAX,
    VALHEIM_SERVER_PINS_TYPES_MAX,
} from "../valheim-server-pins.schema.js";

const pin = {
    x: 10.5,
    z: -20,
    type: "Icon4",
    label: "Swamp",
    checked: true,
    characterId: 7,
    characterName: "Ragnar",
};
const W = "1234567890123";
const query = (extra: Record<string, string>) =>
    ValheimServerPinsQuerySchema.safeParse({ worldUid: W, ...extra });
const ids = (n: number) => Array.from({ length: n }, (_, i) => String(i + 1)).join(",");
const types = (n: number) => Array.from({ length: n }, (_, i) => `T${i}`).join(",");

describe("ValheimServerPinSchema", () => {
    it("parses an attributed pin and an unlinked one", () => {
        expect(ValheimServerPinSchema.parse(pin)).toEqual(pin);
        const unlinked = { ...pin, characterId: null, characterName: "Unknown character" };
        expect(ValheimServerPinSchema.parse(unlinked)).toEqual(unlinked);
    });
    it("rejects extra keys (a SteamID, shared), a long label and an empty name", () => {
        expect(ValheimServerPinSchema.safeParse({ ...pin, steamId: "76561198000000001" }).success).toBe(false);
        expect(ValheimServerPinSchema.safeParse({ ...pin, shared: false }).success).toBe(false);
        expect(ValheimServerPinSchema.safeParse({ ...pin, label: "x".repeat(65) }).success).toBe(false);
        expect(ValheimServerPinSchema.safeParse({ ...pin, characterName: "" }).success).toBe(false);
    });
});

describe("ValheimServerPinsResponseSchema", () => {
    it("round-trips and rejects extra keys, a missing truncated flag and an over-cap list", () => {
        const r = { worldUid: W, pins: [pin], truncated: false };
        expect(ValheimServerPinsResponseSchema.parse(r)).toEqual(r);
        expect(ValheimServerPinsResponseSchema.safeParse({ ...r, extra: 1 }).success).toBe(false);
        expect(ValheimServerPinsResponseSchema.safeParse({ worldUid: W, pins: [] }).success).toBe(false);
        const over = { ...r, pins: Array.from({ length: VALHEIM_SERVER_PINS_CAP + 1 }, () => pin) };
        expect(ValheimServerPinsResponseSchema.safeParse(over).success).toBe(false);
    });
});

describe("ValheimServerPinsQuerySchema", () => {
    it("parses worldUid alone (players / types omitted)", () => {
        expect(query({}).data).toEqual({ worldUid: W });
    });
    it("splits and de-duplicates players and types", () => {
        expect(query({ players: "3,3,5", types: "Death,Icon4,Death" }).data).toEqual({
            worldUid: W,
            players: [3, 5],
            types: ["Death", "Icon4"],
        });
    });
    it("rejects a missing or malformed worldUid", () => {
        expect(ValheimServerPinsQuerySchema.safeParse({}).success).toBe(false);
        expect(query({ worldUid: "abc" }).success).toBe(false);
    });
    it("rejects empty, zero, non-numeric and oversized players lists", () => {
        for (const players of ["", "0", "a", "3,", "-1", "1.5", ids(VALHEIM_SERVER_PINS_PLAYERS_MAX + 1)]) {
            expect({ players, ok: query({ players }).success }).toEqual({ players, ok: false });
        }
        expect(query({ players: ids(VALHEIM_SERVER_PINS_PLAYERS_MAX) }).success).toBe(true);
    });
    it("rejects empty, malformed and oversized types lists", () => {
        for (const t of ["", "Bad-Type", "Death,", types(VALHEIM_SERVER_PINS_TYPES_MAX + 1)]) {
            expect({ t, ok: query({ types: t }).success }).toEqual({ t, ok: false });
        }
        expect(query({ types: types(VALHEIM_SERVER_PINS_TYPES_MAX) }).success).toBe(true);
    });
});
