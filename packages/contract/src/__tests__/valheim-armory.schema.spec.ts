/**
 * ROK-1835 — Valheim armory read/claim shapes. One parse and at least one
 * reject case per schema. Every shape is strict, so a `steamId` (never shown
 * to members, Q10) cannot ride along on a response.
 *
 * Runs under the contract workspace's own vitest config
 * (`npm test -w @raid-ledger/contract`).
 */
import { describe, it, expect } from "vitest";
import {
  ValheimClaimSourceSchema,
  ValheimCharacterSummarySchema,
  ValheimCharacterListResponseSchema,
  ValheimCharacterDetailSchema,
  ValheimMapMetaSchema,
  ValheimAssignOwnerBodySchema,
  ValheimClaimEventSchema,
  ValheimClaimEventListResponseSchema,
} from "../valheim-armory.schema.js";

const AT = "2026-10-18T12:00:00.000Z";

const summary = {
  id: 1,
  pelicanServerId: 7,
  serverName: "Viking Hall",
  name: "Ragnar",
  worldName: "Midgard",
  claimedBy: { id: 3, username: "jake", avatar: null },
  claimSource: "auto",
  capturedAt: AT,
  gameVersion: "0.219.16",
};

const detail = {
  ...summary,
  equipment: [],
  inventory: { grid: { width: 8, height: 4, extraRows: [] }, items: [] },
  skills: [{ id: "Swords", level: 12.5, accumulator: 3 }],
  trophies: ["TrophyBoar"],
  maps: [{ id: 4, worldUid: "123", capturedAt: AT }],
};

const pin = {
  type: "Icon0",
  label: "home",
  x: 1,
  z: -2,
  checked: false,
  shared: false,
};

const mapMeta = {
  id: 4,
  worldUid: "123",
  grid: { textureSize: 2048, pixelSizeMetres: 12 },
  pins: [pin],
  hasSharedExplored: true,
  baseMap: { sha256: "a".repeat(64), width: 2048, height: 2048, ready: false },
  capturedAt: AT,
};

const event = {
  id: 9,
  profileId: 1,
  action: "admin_assign",
  fromUserId: 3,
  toUserId: 5,
  actorUserId: 1,
  createdAt: AT,
};

describe("ValheimClaimSourceSchema", () => {
  it("accepts the three sources and rejects others", () => {
    for (const s of ["auto", "manual", "admin"]) {
      expect(ValheimClaimSourceSchema.parse(s)).toBe(s);
    }
    expect(ValheimClaimSourceSchema.safeParse("steam").success).toBe(false);
  });
});

describe("ValheimCharacterSummarySchema", () => {
  it("parses a claimed and an unclaimed summary", () => {
    expect(ValheimCharacterSummarySchema.parse(summary)).toEqual(summary);
    const unclaimed = { ...summary, claimedBy: null, claimSource: null };
    expect(ValheimCharacterSummarySchema.safeParse(unclaimed).success).toBe(
      true,
    );
  });

  it("rejects a leaked steamId (strict)", () => {
    const leaked = { ...summary, steamId: "76561198000000000" };
    expect(ValheimCharacterSummarySchema.safeParse(leaked).success).toBe(false);
  });

  it("rejects a non-positive id", () => {
    const bad = { ...summary, id: 0 };
    expect(ValheimCharacterSummarySchema.safeParse(bad).success).toBe(false);
  });
});

describe("ValheimCharacterListResponseSchema", () => {
  it("wraps summaries in data", () => {
    const ok = ValheimCharacterListResponseSchema.safeParse({
      data: [summary],
    });
    expect(ok.success).toBe(true);
    expect(
      ValheimCharacterListResponseSchema.safeParse([summary]).success,
    ).toBe(false);
  });
});

describe("ValheimCharacterDetailSchema", () => {
  it("parses the sheet plus its map list", () => {
    expect(ValheimCharacterDetailSchema.safeParse(detail).success).toBe(true);
  });

  it("rejects known items (not returned) and a bad skill level", () => {
    const extra = { ...detail, knownItems: [] };
    expect(ValheimCharacterDetailSchema.safeParse(extra).success).toBe(false);
    const bad = {
      ...detail,
      skills: [{ id: "Swords", level: 101, accumulator: 0 }],
    };
    expect(ValheimCharacterDetailSchema.safeParse(bad).success).toBe(false);
  });
});

describe("ValheimMapMetaSchema", () => {
  it("parses metadata with and without a base map", () => {
    expect(ValheimMapMetaSchema.safeParse(mapMeta).success).toBe(true);
    const none = { ...mapMeta, baseMap: null };
    expect(ValheimMapMetaSchema.safeParse(none).success).toBe(true);
  });

  it("rejects fog bitmaps (not returned) and a bad base-map hash", () => {
    const fog = { ...mapMeta, explored: {} };
    expect(ValheimMapMetaSchema.safeParse(fog).success).toBe(false);
    const badHash = {
      ...mapMeta,
      baseMap: { ...mapMeta.baseMap, sha256: "x" },
    };
    expect(ValheimMapMetaSchema.safeParse(badHash).success).toBe(false);
  });
});

describe("ValheimAssignOwnerBodySchema", () => {
  it("accepts a user id or null", () => {
    expect(ValheimAssignOwnerBodySchema.parse({ userId: 5 })).toEqual({
      userId: 5,
    });
    expect(ValheimAssignOwnerBodySchema.parse({ userId: null })).toEqual({
      userId: null,
    });
  });

  it("rejects a missing, non-int or extra key", () => {
    for (const body of [{}, { userId: 1.5 }, { userId: 1, steamId: "x" }]) {
      expect(ValheimAssignOwnerBodySchema.safeParse(body).success).toBe(false);
    }
  });
});

describe("ValheimClaimEventSchema", () => {
  it("parses an event, including a system actor", () => {
    expect(ValheimClaimEventSchema.parse(event)).toEqual(event);
    const system = { ...event, action: "auto_attach", actorUserId: null };
    expect(ValheimClaimEventSchema.safeParse(system).success).toBe(true);
  });

  it("rejects an unknown action", () => {
    const bad = { ...event, action: "steal" };
    expect(ValheimClaimEventSchema.safeParse(bad).success).toBe(false);
  });

  it("wraps events in data", () => {
    const list = { data: [event] };
    expect(ValheimClaimEventListResponseSchema.safeParse(list).success).toBe(
      true,
    );
  });
});
