/**
 * ROK-1742 — `character_addon_snapshots.data` schema 2 is a superset of
 * schema 1: a schema-1 row still parses, and the new keys are accepted.
 */
import { describe, it, expect } from "vitest";
import {
  ADDON_CHAR_SNAPSHOT_SCHEMA,
  AddonCharSnapshotDataSchema,
  AddonCharSnapshotSchemaNumberSchema,
} from "../index.js";

const schema1Row = {
  gear: [{ slot: 16, itemId: 19019, ilvl: 80, bonusIds: [6646, 7890] }],
  talents: { configId: 7, nodes: [{ nodeId: 101, rank: 2 }] },
  lockouts: [],
};

describe("AddonCharSnapshotDataSchema — schema 2", () => {
  it("writes 2 and accepts reads of 1 and 2 only", () => {
    expect(ADDON_CHAR_SNAPSHOT_SCHEMA).toBe(2);
    expect(AddonCharSnapshotSchemaNumberSchema.safeParse(1).success).toBe(true);
    expect(AddonCharSnapshotSchemaNumberSchema.safeParse(2).success).toBe(true);
    expect(AddonCharSnapshotSchemaNumberSchema.safeParse(3).success).toBe(
      false,
    );
  });

  it("parses a schema-1 row unchanged", () => {
    expect(AddonCharSnapshotDataSchema.parse(schema1Row)).toEqual(schema1Row);
  });

  it("accepts quests, enchantId and gemIds", () => {
    const row = {
      ...schema1Row,
      gear: [{ ...schema1Row.gear[0], enchantId: 1900, gemIds: [2000] }],
      quests: {
        completed: [456],
        inProgress: [{ questId: 488, title: "Zenn" }],
      },
    };
    expect(AddonCharSnapshotDataSchema.safeParse(row).success).toBe(true);
  });

  it("rejects five gems and an unknown gear key", () => {
    const gear = (extra: object) => ({
      ...schema1Row,
      gear: [{ ...schema1Row.gear[0], ...extra }],
    });
    expect(
      AddonCharSnapshotDataSchema.safeParse(gear({ gemIds: [1, 2, 3, 4, 5] }))
        .success,
    ).toBe(false);
    expect(
      AddonCharSnapshotDataSchema.safeParse(gear({ link: "x" })).success,
    ).toBe(false);
  });
});
