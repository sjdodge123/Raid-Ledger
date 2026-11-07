import { describe, expect, it } from "vitest";
import { ImportWowCharacterSchema } from "../characters.schema.js";

/** Messages of every issue on `path` for a failed parse (empty when it passed). */
function issueMessages(body: unknown, path: string): string[] {
  const result = ImportWowCharacterSchema.safeParse(body);
  if (result.success) return [];
  return result.error.issues
    .filter((i) => i.path.join(".") === path)
    .map((i) => i.message);
}

const forever = {
  name: "Ana Forever",
  region: "us",
  gameVariant: "wow_forever",
  ruleset: "pvp",
};

describe("ImportWowCharacterSchema — WoW: Forever (ROK-1722)", () => {
  it("parses a realmless Forever body with a ruleset", () => {
    const result = ImportWowCharacterSchema.safeParse(forever);
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      name: "Ana Forever",
      realm: null,
      region: "us",
      gameVariant: "wow_forever",
      isMain: false,
      ruleset: "pvp",
    });
  });

  it("rejects a Forever body that carries a realm", () => {
    expect(issueMessages({ ...forever, realm: "Stormrage" }, "realm")).toEqual([
      "WoW: Forever characters have no realm",
    ]);
  });

  it("rejects a Forever body without a ruleset", () => {
    const { ruleset: _omit, ...noRuleset } = forever;
    expect(issueMessages(noRuleset, "ruleset")).toEqual(["Pick a ruleset"]);
  });

  it("rejects the Hardcore ruleset like manual create does", () => {
    expect(
      ImportWowCharacterSchema.safeParse({ ...forever, ruleset: "hardcore" })
        .success,
    ).toBe(false);
  });

  it("rejects a one-word Forever name", () => {
    expect(issueMessages({ ...forever, name: "Ana" }, "name")).toEqual([
      "Enter a first and second name",
    ]);
  });
});

describe("ImportWowCharacterSchema — realm-based variants", () => {
  it("rejects a retail body without a realm", () => {
    expect(issueMessages({ name: "Thrall", region: "us" }, "realm")).toEqual([
      "Realm is required",
    ]);
  });

  it("still parses a legacy body (realm string, no ruleset) with ruleset null", () => {
    const result = ImportWowCharacterSchema.safeParse({
      name: "Thrall",
      realm: "Area 52",
      region: "us",
      gameVariant: "classic_era",
    });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      name: "Thrall",
      realm: "Area 52",
      gameVariant: "classic_era",
      ruleset: null,
    });
  });

  it("does not apply the two-part name rule outside Forever", () => {
    expect(
      issueMessages({ name: "Thrall", realm: "Area 52", region: "us" }, "name"),
    ).toEqual([]);
    expect(
      ImportWowCharacterSchema.safeParse({
        name: "Thrall",
        realm: "Area 52",
        region: "us",
      }).success,
    ).toBe(true);
  });
});
