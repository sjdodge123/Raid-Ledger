import { describe, expect, it } from "vitest";
import {
  GuildBlizzardRosterUpdateSchema,
  GuildSummarySchema,
} from "./index.js";

/** ROK-1928 A3 — the Blizzard roster slug + status, additive on GuildSummary. */
const OLD_SUMMARY = {
  id: 1,
  gameId: 2,
  kind: "wow_guild",
  name: "Ye Olde Guild",
  region: "us",
  realmSlug: null,
  realmName: "Doomhowl",
  faction: "alliance",
  memberCount: 5,
  lastSnapshotAt: "2026-11-01T10:00:00.000Z",
};

describe("GuildSummarySchema.blizzardRoster (ROK-1928)", () => {
  it("parses an older summary without blizzardRoster", () => {
    const parsed = GuildSummarySchema.parse(OLD_SUMMARY);
    expect(parsed.blizzardRoster).toBeUndefined();
  });

  it("parses a summary carrying blizzardRoster", () => {
    const blizzardRoster = {
      guildSlug: "ye-olde-guild",
      status: "ok",
      syncedAt: "2026-11-06T10:00:00.000Z",
    };
    const parsed = GuildSummarySchema.parse({ ...OLD_SUMMARY, blizzardRoster });
    expect(parsed.blizzardRoster).toEqual(blizzardRoster);
  });

  it("rejects an unknown roster status", () => {
    const blizzardRoster = { guildSlug: null, status: "bad", syncedAt: null };
    const result = GuildSummarySchema.safeParse({ ...OLD_SUMMARY, blizzardRoster });
    expect(result.success).toBe(false);
  });
});

describe("GuildBlizzardRosterUpdateSchema (ROK-1928)", () => {
  it.each(["ye-olde-guild", "über-gilde", "ab"])("accepts %s", (guildSlug) => {
    expect(GuildBlizzardRosterUpdateSchema.safeParse({ guildSlug }).success).toBe(true);
  });

  it("accepts null (stop syncing)", () => {
    expect(GuildBlizzardRosterUpdateSchema.safeParse({ guildSlug: null }).success).toBe(true);
  });

  it.each(["a", "has space", "semi;colon", "x".repeat(65)])("rejects %s", (guildSlug) => {
    expect(GuildBlizzardRosterUpdateSchema.safeParse({ guildSlug }).success).toBe(false);
  });

  it("rejects extra keys", () => {
    const body = { guildSlug: "ok-slug", region: "us" };
    expect(GuildBlizzardRosterUpdateSchema.safeParse(body).success).toBe(false);
  });
});
