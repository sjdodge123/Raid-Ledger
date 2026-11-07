import { describe, expect, it } from "vitest";
import { CharacterSchema } from "../characters.schema.js";

/** A minimal valid CharacterDto; only the ROK-2107 provenance fields vary. */
const base = {
  id: "11111111-1111-4111-8111-111111111111",
  userId: 1,
  gameId: 1,
  name: "Ana",
  realm: null,
  class: null,
  spec: null,
  role: null,
  roleOverride: null,
  effectiveRole: null,
  isMain: false,
  itemLevel: null,
  externalId: null,
  avatarUrl: null,
  renderUrl: null,
  level: null,
  race: null,
  faction: null,
  lastSyncedAt: null,
  profileUrl: null,
  region: null,
  ruleset: null,
  gameVariant: null,
  equipment: null,
  talents: null,
  professions: null,
  displayOrder: 0,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

describe("CharacterSchema — professions provenance (ROK-2107)", () => {
  it("parses a DTO without professionsSource / hasManualProfessions (optional)", () => {
    const result = CharacterSchema.safeParse(base);
    expect(result.error?.issues, "base DTO parses").toBeUndefined();
    expect(result.data).not.toHaveProperty("professionsSource");
  });

  it.each([null, "manual", "blizzard"] as const)(
    "accepts professionsSource %s with hasManualProfessions",
    (professionsSource) => {
      const result = CharacterSchema.safeParse({
        ...base,
        professionsSource,
        hasManualProfessions: professionsSource === "manual",
      });
      expect(result.success, `professionsSource ${professionsSource}`).toBe(true);
      expect(result.data?.professionsSource).toBe(professionsSource);
    },
  );

  it("rejects an unknown professionsSource ('armory')", () => {
    const result = CharacterSchema.safeParse({ ...base, professionsSource: "armory" });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path.join("."))).toEqual(["professionsSource"]);
  });

  it("rejects a non-boolean hasManualProfessions", () => {
    const result = CharacterSchema.safeParse({ ...base, hasManualProfessions: "yes" });
    expect(result.error?.issues.map((i) => i.path.join("."))).toEqual(["hasManualProfessions"]);
  });
});
