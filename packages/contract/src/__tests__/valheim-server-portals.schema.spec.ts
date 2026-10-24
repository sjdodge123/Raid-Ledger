/**
 * ROK-1946 — the Map tab's scanned-portal layer read shape. Strict keys,
 * null height, the tag cap, an empty list and the "no scan yet" body.
 */
import { describe, it, expect } from "vitest";
import {
    ValheimServerPortalSchema,
    ValheimServerPortalsQuerySchema,
    ValheimServerPortalsResponseSchema,
} from "../valheim-server-portals.schema.js";

const portal = { prefab: "portal_wood", x: 10.5, y: 31.25, z: -20, tag: "home" };
const body = {
    worldUid: "1234567890123",
    scannedAt: "2026-10-20T18:00:00.000Z",
    omitted: 0,
    portals: [portal],
};

describe("ValheimServerPortalSchema", () => {
    it("parses a portal, including a null height and an empty tag", () => {
        expect(ValheimServerPortalSchema.parse(portal)).toEqual(portal);
        const flat = { ...portal, y: null, tag: "" };
        expect(ValheimServerPortalSchema.parse(flat)).toEqual(flat);
    });

    it("rejects an unknown key and a 65-char tag", () => {
        expect(ValheimServerPortalSchema.safeParse({ ...portal, id: 1 }).success).toBe(false);
        expect(ValheimServerPortalSchema.safeParse({ ...portal, tag: "x".repeat(65) }).success).toBe(false);
    });
});

describe("ValheimServerPortalsResponseSchema", () => {
    it("parses a scan, an empty scan and the no-scan body", () => {
        expect(ValheimServerPortalsResponseSchema.parse(body)).toEqual(body);
        const empty = { ...body, portals: [] };
        expect(ValheimServerPortalsResponseSchema.parse(empty)).toEqual(empty);
        const none = { worldUid: null, scannedAt: null, omitted: 0, portals: [] };
        expect(ValheimServerPortalsResponseSchema.parse(none)).toEqual(none);
    });

    it("rejects an unknown key, a negative omitted and a non-ISO scannedAt", () => {
        const bad = [
            { ...body, truncated: false },
            { ...body, omitted: -1 },
            { ...body, scannedAt: "yesterday" },
        ];
        expect(bad.map((b) => ValheimServerPortalsResponseSchema.safeParse(b).success)).toEqual([
            false,
            false,
            false,
        ]);
    });
});

describe("ValheimServerPortalsQuerySchema", () => {
    it("takes an optional int64 worldUid and rejects anything else", () => {
        expect(ValheimServerPortalsQuerySchema.parse({})).toEqual({});
        expect(ValheimServerPortalsQuerySchema.parse({ worldUid: "42" })).toEqual({ worldUid: "42" });
        expect(ValheimServerPortalsQuerySchema.safeParse({ worldUid: "abc" }).success).toBe(false);
    });
});
