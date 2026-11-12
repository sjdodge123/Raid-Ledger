import { describe, expect, it } from "vitest";
import { WowRosterAttunementsSchema } from "../wow-roster-attunements.schema.js";
import { WowRosterInsightsSchema } from "../wow-roster-insights.schema.js";

/** ROK-1927 — the attunement section is strict, additive and id-free. */
const section = {
  attunements: [
    {
      key: "ony-horde",
      groupKey: "onyxia",
      instance: "Onyxia's Lair",
      faction: "horde",
      trackable: true,
      untrackedReason: null,
      steps: ["Warlord's Command", "Blood of the Black Dragon Champion"],
      counts: { done: 1, inProgress: 0, notStarted: 0, noData: 1 },
    },
  ],
  members: [
    {
      rowKey: "m42",
      name: "Grukk",
      characterId: null,
      cls: "Warrior",
      level: 60,
      asOf: null,
      source: null,
      results: [
        {
          key: "ony-horde",
          state: "no_data",
          noDataReason: "not_claimed",
          stepsDone: 0,
          nextStep: null,
          belowLevel: false,
        },
      ],
    },
  ],
  oldestAsOf: "2026-11-10T12:00:00.000Z",
};

const insights = {
  classes: [],
  levels: { buckets: [], max: null, median: null, atCap: 0 },
  roles: {
    dungeon: { tank: 0, healer: 0, dps: 0, unknown: 0 },
    raid: { tank: 0, healer: 0, dps: 0, unknown: 0 },
  },
  freshness: { roster: null, characters: { addon: 0, blizzard: 0, none: 0 } },
};

describe("WowRosterAttunementsSchema", () => {
  it("parses a section with an unclaimed no-data member", () => {
    expect(WowRosterAttunementsSchema.parse(section)).toEqual(section);
  });

  it("rejects a quest id on a result (verdicts only, AC10)", () => {
    const first = section.members[0];
    if (!first) throw new Error("fixture has no member");
    const leaky = {
      ...section,
      members: [
        {
          ...first,
          results: first.results.map((r) => ({ ...r, questId: 4903 })),
        },
      ],
    };
    expect(WowRosterAttunementsSchema.safeParse(leaky).success).toBe(false);
  });

  it("rejects an unknown state", () => {
    const first = section.members[0];
    if (!first) throw new Error("fixture has no member");
    const bad = {
      ...section,
      members: [
        { ...first, results: [{ ...first.results[0], state: "attuned" }] },
      ],
    };
    expect(WowRosterAttunementsSchema.safeParse(bad).success).toBe(false);
  });
});

describe("WowRosterInsightsSchema — attunements is optional (additive)", () => {
  it("parses without attunements (visitor payload)", () => {
    expect(WowRosterInsightsSchema.safeParse(insights).success).toBe(true);
  });

  it("parses with attunements", () => {
    const parsed = WowRosterInsightsSchema.parse({
      ...insights,
      attunements: section,
    });
    expect(parsed.attunements).toEqual(section);
  });
});
