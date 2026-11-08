import { describe, expect, it } from "vitest";
import {
  GuildIngameGameActionSchema,
  GuildIngameGameReportSchema,
  hasIngameControlChars,
  stripIngameControlChars,
  GuildIngameTextSchema,
  INGAME_TEXT_FIELD_KEYS,
} from "./index.js";

/** ROK-2137 — the editor-only "Changed in game" block on the hub text DTO. */
const AT = "2026-11-08T12:00:00.000000Z";

const report = (over: Record<string, unknown> = {}) => ({
  gameText: "Raid at 9",
  gameReportedAt: AT,
  changedInGame: true,
  ...over,
});

const dto = (over: Record<string, unknown> = {}) => ({
  guildId: 7,
  motd: null,
  info: null,
  viewer: { canEdit: true },
  ...over,
});

describe("GuildIngameTextSchema.game (optional, additive)", () => {
  it("still parses a P0 body with no game key (non-editors)", () => {
    expect(GuildIngameTextSchema.safeParse(dto()).success).toBe(true);
  });

  it("parses per-field reports, null = never reported", () => {
    const body = dto({ game: { motd: report(), info: null } });
    expect(GuildIngameTextSchema.parse(body).game?.motd?.changedInGame).toBe(true);
  });

  it("accepts '' as a reported-empty in-game box", () => {
    expect(GuildIngameGameReportSchema.safeParse(report({ gameText: "" })).success).toBe(true);
  });

  it("enforces the in-game caps on the reported text", () => {
    const motd = report({ gameText: "a".repeat(256) });
    const info = report({ gameText: "b".repeat(500) });
    expect(GuildIngameTextSchema.safeParse(dto({ game: { motd, info: null } })).success).toBe(false);
    expect(GuildIngameTextSchema.safeParse(dto({ game: { motd: null, info } })).success).toBe(false);
    const okInfo = report({ gameText: "b".repeat(499) });
    expect(GuildIngameTextSchema.safeParse(dto({ game: { motd: null, info: okInfo } })).success).toBe(true);
  });

  it("stays strict (unknown keys rejected at every level)", () => {
    expect(GuildIngameGameReportSchema.safeParse(report({ via: "x" })).success).toBe(false);
    const game = { motd: null, info: null, extra: 1 };
    expect(GuildIngameTextSchema.safeParse(dto({ game })).success).toBe(false);
  });

  it("requires both field keys inside game", () => {
    expect(GuildIngameTextSchema.safeParse(dto({ game: { motd: null } })).success).toBe(false);
  });

  it("lists the route field keys for /:field/adopt|push", () => {
    expect(INGAME_TEXT_FIELD_KEYS).toEqual(["motd", "info"]);
  });
});

describe("ROK-2137 review r1 — reporter, action body, control-char strip", () => {
  it("accepts an optional gameReportedBy and rejects an empty one", () => {
    expect(
      GuildIngameGameReportSchema.safeParse(report({ gameReportedBy: "Thrall" }))
        .success,
    ).toBe(true);
    expect(
      GuildIngameGameReportSchema.safeParse(report({ gameReportedBy: "" }))
        .success,
    ).toBe(false);
  });

  it("action body needs gameReportedAt; baseUpdatedAt may be null", () => {
    expect(
      GuildIngameGameActionSchema.safeParse({
        baseUpdatedAt: null,
        gameReportedAt: AT,
      }).success,
    ).toBe(true);
    expect(
      GuildIngameGameActionSchema.safeParse({ baseUpdatedAt: null }).success,
    ).toBe(false);
    expect(
      GuildIngameGameActionSchema.safeParse({
        baseUpdatedAt: null,
        gameReportedAt: AT,
        extra: 1,
      }).success,
    ).toBe(false);
  });

  it("strips exactly what the save rejects, keeping newlines", () => {
    const raw = "Raid\tat\u0007 9\nbring\u009b FR\r\n";
    const stripped = stripIngameControlChars(raw);
    expect(stripped).toBe("Raidat 9\nbring FR\r\n");
    expect(hasIngameControlChars(stripped)).toBe(false);
  });
});
