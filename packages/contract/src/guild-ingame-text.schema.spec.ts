import { describe, expect, it } from "vitest";
import {
  GuildIngameTextSchema,
  PutGuildIngameTextSchema,
  WOW_GUILD_INFO_MAX,
  WOW_GUILD_MOTD_MAX,
  findIngameTextWarnings,
  hasIngameControlChars,
  normaliseIngameText,
} from "./index.js";

/** ROK-2136 — guild MOTD + Guild Information (P0 of guild text sync). */
const AT = "2026-11-08T12:00:00.000Z";

const put = (over: Record<string, unknown> = {}) => ({
  motd: "Raid tonight 8pm",
  info: "Be nice.",
  baseMotdUpdatedAt: null,
  baseInfoUpdatedAt: AT,
  ...over,
});

const stored = (over: Record<string, unknown> = {}) => ({
  guildId: 7,
  motd: { text: "Raid tonight", updatedAt: AT, updatedBy: "Thrall" },
  info: null,
  viewer: { canEdit: false },
  ...over,
});

describe("caps", () => {
  it("match the in-game edit boxes (255 / 499)", () => {
    expect(WOW_GUILD_MOTD_MAX).toBe(255);
    expect(WOW_GUILD_INFO_MAX).toBe(499);
  });
});

describe("PutGuildIngameTextSchema", () => {
  it("accepts exactly 255 / 499 and empty strings (clear)", () => {
    expect(PutGuildIngameTextSchema.safeParse(put({ motd: "a".repeat(255), info: "b".repeat(499) })).success).toBe(true);
    expect(PutGuildIngameTextSchema.safeParse(put({ motd: "", info: "" })).success).toBe(true);
  });

  it("rejects 256 / 500", () => {
    expect(PutGuildIngameTextSchema.safeParse(put({ motd: "a".repeat(256) })).success).toBe(false);
    expect(PutGuildIngameTextSchema.safeParse(put({ info: "b".repeat(500) })).success).toBe(false);
  });

  it("rejects unknown keys and a missing base timestamp", () => {
    expect(PutGuildIngameTextSchema.safeParse(put({ extra: 1 })).success).toBe(false);
    const { baseMotdUpdatedAt: _omit, ...missing } = put();
    expect(PutGuildIngameTextSchema.safeParse(missing).success).toBe(false);
  });

  it("rejects control characters but accepts newlines, CRLF, pipes and emoji", () => {
    expect(PutGuildIngameTextSchema.safeParse(put({ motd: "tab\there" })).success).toBe(false);
    expect(PutGuildIngameTextSchema.safeParse(put({ info: "bell\u0007" })).success).toBe(false);
    expect(PutGuildIngameTextSchema.safeParse(put({ info: "c1\u0085" })).success).toBe(false);
    expect(PutGuildIngameTextSchema.safeParse(put({ info: "a\r\nb\nc |cffff0000red|r 🐉" })).success).toBe(true);
  });
});

describe("GuildIngameTextSchema", () => {
  it("accepts null fields and a stored field", () => {
    expect(GuildIngameTextSchema.safeParse(stored()).success).toBe(true);
    expect(GuildIngameTextSchema.safeParse(stored({ motd: null })).success).toBe(true);
    expect(
      GuildIngameTextSchema.safeParse(stored({ info: { text: "x", updatedAt: AT, updatedBy: null } })).success,
    ).toBe(true);
  });

  it("rejects an empty or over-cap stored text", () => {
    const field = (text: string) => ({ text, updatedAt: AT, updatedBy: null });
    expect(GuildIngameTextSchema.safeParse(stored({ motd: field("") })).success).toBe(false);
    expect(GuildIngameTextSchema.safeParse(stored({ motd: field("a".repeat(256)) })).success).toBe(false);
    expect(GuildIngameTextSchema.safeParse(stored({ info: field("b".repeat(500)) })).success).toBe(false);
  });

  it("is strict at every level", () => {
    expect(GuildIngameTextSchema.safeParse(stored({ extra: 1 })).success).toBe(false);
    expect(GuildIngameTextSchema.safeParse(stored({ viewer: { canEdit: true, canTick: true } })).success).toBe(false);
    expect(
      GuildIngameTextSchema.safeParse(
        stored({ motd: { text: "x", updatedAt: AT, updatedBy: null, extra: 1 } }),
      ).success,
    ).toBe(false);
  });
});

describe("normaliseIngameText", () => {
  it("converts CRLF and CR to LF", () => {
    expect(normaliseIngameText("a\r\nb\rc")).toBe("a\nb\nc");
  });

  it("strips trailing whitespace per line and at the end, keeps leading", () => {
    expect(normaliseIngameText("  a  \n  b \n\n  ")).toBe("  a\n  b");
  });

  it("keeps interior blank lines", () => {
    expect(normaliseIngameText("a\n\nb")).toBe("a\n\nb");
  });

  it("returns '' for empty or whitespace-only text", () => {
    expect(normaliseIngameText("")).toBe("");
    expect(normaliseIngameText(" \r\n \n")).toBe("");
  });
});

describe("hasIngameControlChars", () => {
  it("flags tabs, NUL, DEL and C1 but not newline or CR", () => {
    expect(hasIngameControlChars("a\tb")).toBe(true);
    expect(hasIngameControlChars("a\u0000")).toBe(true);
    expect(hasIngameControlChars("a\u007f")).toBe(true);
    expect(hasIngameControlChars("a\u009f")).toBe(true);
    expect(hasIngameControlChars("a\r\nb")).toBe(false);
    expect(hasIngameControlChars("Ünïcødé 漢字")).toBe(false);
  });
});

describe("findIngameTextWarnings", () => {
  it("returns nothing for plain text", () => {
    expect(findIngameTextWarnings("Raid at 8, bring flasks!", "motd")).toEqual([]);
  });

  it("warns on a pipe and on astral characters", () => {
    expect(findIngameTextWarnings("|cffff0000red|r", "info")).toEqual(["pipe"]);
    expect(findIngameTextWarnings("gg 🐉", "info")).toEqual(["astral"]);
  });

  it("warns on a newline in the MOTD only", () => {
    expect(findIngameTextWarnings("a\nb", "motd")).toEqual(["newline-in-motd"]);
    expect(findIngameTextWarnings("a\nb", "info")).toEqual([]);
  });

  it("reports every warning that applies, in a stable order", () => {
    expect(findIngameTextWarnings("a | b\n🐉", "motd")).toEqual(["pipe", "astral", "newline-in-motd"]);
  });
});
