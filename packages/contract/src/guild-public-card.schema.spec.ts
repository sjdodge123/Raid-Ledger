import { describe, expect, it } from "vitest";
import {
  GuildPublicCardSettingsSchema,
  PublicGuildCardParamsSchema,
  PublicGuildCardSchema,
  PublicGuildWantedSchema,
  UpdateGuildPublicCardSchema,
} from "./index.js";

/** ROK-1813 — public guild card: strict shape, slug regex, https-only apply URL. */
const CARD = {
  name: "Dawnbreakers",
  region: "us",
  realmName: null,
  gameName: "World of Warcraft: Forever",
  approxMemberCount: 140,
  recruitment: {
    state: "open",
    wanted: [{ className: "Priest", role: "healer", state: "open" }],
    applyUrl: "https://example.com/apply",
  },
};

describe("PublicGuildCardSchema", () => {
  it("accepts the D5 fields", () => {
    expect(PublicGuildCardSchema.parse(CARD)).toEqual(CARD);
  });

  it("accepts null count and null recruitment", () => {
    const card = { ...CARD, approxMemberCount: null, recruitment: null };
    expect(PublicGuildCardSchema.safeParse(card).success).toBe(true);
  });

  it("rejects an extra top-level key (strict)", () => {
    const card = { ...CARD, id: 7 };
    expect(PublicGuildCardSchema.safeParse(card).success).toBe(false);
  });

  it("rejects an extra recruitment key (strict)", () => {
    const card = { ...CARD, recruitment: { ...CARD.recruitment, recruiting: true } };
    expect(PublicGuildCardSchema.safeParse(card).success).toBe(false);
  });

  it("rejects an http apply URL", () => {
    const recruitment = { ...CARD.recruitment, applyUrl: "http://example.com" };
    expect(PublicGuildCardSchema.safeParse({ ...CARD, recruitment }).success).toBe(false);
  });

  it("rejects a javascript: apply URL", () => {
    const recruitment = { ...CARD.recruitment, applyUrl: "javascript:alert(1)" };
    expect(PublicGuildCardSchema.safeParse({ ...CARD, recruitment }).success).toBe(false);
  });
});

describe("PublicGuildWantedSchema", () => {
  it("rejects a note (excluded from the public card)", () => {
    const row = { className: "Mage", role: "dps", state: "open", note: "x" };
    expect(PublicGuildWantedSchema.safeParse(row).success).toBe(false);
  });
});

describe("PublicGuildCardParamsSchema", () => {
  it("accepts 16 base62 characters", () => {
    expect(PublicGuildCardParamsSchema.safeParse({ slug: "aB3dE5gH7jK9mN1p" }).success).toBe(true);
  });

  it.each(["aB3dE5gH7jK9mN1", "aB3dE5gH7jK9mN1pq", "aB3dE5gH7jK9mN1_", "aB3dE5gH7jK9mN1-", "42"])(
    "rejects %s",
    (slug) => {
      expect(PublicGuildCardParamsSchema.safeParse({ slug }).success).toBe(false);
    },
  );
});

describe("settings schemas", () => {
  it("settings accept a null slug before first enable", () => {
    expect(GuildPublicCardSettingsSchema.safeParse({ enabled: false, slug: null }).success).toBe(true);
  });

  it("update body is strict", () => {
    expect(UpdateGuildPublicCardSchema.safeParse({ enabled: true }).success).toBe(true);
    expect(UpdateGuildPublicCardSchema.safeParse({ enabled: true, slug: "x" }).success).toBe(false);
  });
});
