/**
 * ROK-1906 (epic ROK-1905) — additive contract for plugin hub widgets and the
 * WoW: Forever guild widgets: gameSlug on hubs, contentInstances on guild event
 * cards, fact freshness, roster insights and event quest readiness.
 */
import { describe, it, expect } from "vitest";
import { GuildSummarySchema } from "../guilds.schema.js";
import { GuildEventCardSchema } from "../guild-raids.schema.js";
import { HubFactFreshnessSchema } from "../hub-facts.schema.js";
import { WowRosterInsightsSchema } from "../wow-roster-insights.schema.js";
import { EventQuestReadinessSchema } from "../wow-event-quest-readiness.schema.js";

const summary = {
  id: 1,
  gameId: 2,
  kind: "wow_guild",
  name: "Gamer Saloon",
  region: "us",
  realmSlug: null,
  realmName: "Forever",
  faction: "Horde",
  memberCount: 12,
  lastSnapshotAt: null,
};
const card = {
  id: 283,
  title: "Bonemass",
  startTime: "2026-10-25T01:15:00.000Z",
  endTime: "2026-10-25T04:15:00.000Z",
  signupCount: 1,
  needed: 10,
  viewerStatus: null,
};
const roles = { tank: 1, healer: 1, dps: 3, unknown: 0 };
const insights = {
  classes: [
    {
      class: "Warrior",
      count: 2,
      members: [
        { name: "Wren", characterId: 5, level: 23 },
        { name: "Pariah", characterId: null, level: null },
      ],
    },
  ],
  levels: {
    buckets: [{ from: 20, to: 29, count: 2 }],
    max: 23,
    median: 21.5,
    atCap: 0,
  },
  roles: { dungeon: roles, raid: { tank: 0, healer: 0, dps: 0, unknown: 0 } },
  freshness: {
    roster: { source: "roster", asOf: "2026-10-22T20:00:00.000Z" },
    characters: { addon: 3, blizzard: 0, none: 9 },
  },
};

describe("additive hub fields (old shapes still parse)", () => {
  it("GuildSummary parses without and with gameSlug", () => {
    expect(GuildSummarySchema.safeParse(summary).success).toBe(true);
    const r = GuildSummarySchema.safeParse({
      ...summary,
      gameSlug: "world-of-warcraft-forever",
    });
    expect(r.success).toBe(true);
    expect(r.data?.gameSlug).toBe("world-of-warcraft-forever");
  });
  it("GuildEventCard parses without and with contentInstances", () => {
    expect(GuildEventCardSchema.safeParse(card).success).toBe(true);
    expect(
      GuildEventCardSchema.safeParse({
        ...card,
        contentInstances: [{ id: 9, name: "Deadmines" }],
      }).success,
    ).toBe(true);
    expect(
      GuildEventCardSchema.safeParse({
        ...card,
        contentInstances: Array.from({ length: 21 }, (_, i) => ({
          id: i,
          name: "x",
        })),
      }).success,
    ).toBe(false);
  });
});

describe("HubFactFreshness", () => {
  it("accepts every source and a null asOf; rejects an unknown source", () => {
    for (const source of ["blizzard", "addon", "roster", "manual"]) {
      expect(
        HubFactFreshnessSchema.safeParse({ source, asOf: null }).success,
      ).toBe(true);
    }
    expect(
      HubFactFreshnessSchema.safeParse({ source: "wowhead", asOf: null })
        .success,
    ).toBe(false);
  });
});

describe("WowRosterInsights", () => {
  it("parses the visitor shape (no professions) and the member shape", () => {
    expect(WowRosterInsightsSchema.safeParse(insights).success).toBe(true);
    const member = {
      ...insights,
      professions: [
        {
          name: "Alchemy",
          members: [
            {
              characterId: 5,
              name: "Wren",
              skill: 75,
              maxSkill: 150,
              source: "manual",
            },
          ],
        },
      ],
    };
    expect(WowRosterInsightsSchema.safeParse(member).success).toBe(true);
  });
  it("rejects unknown keys and out-of-range levels (strict, bounded)", () => {
    expect(
      WowRosterInsightsSchema.safeParse({ ...insights, extra: 1 }).success,
    ).toBe(false);
    const badLevel = { ...insights, levels: { ...insights.levels, max: 101 } };
    expect(WowRosterInsightsSchema.safeParse(badLevel).success).toBe(false);
  });
  it("caps a class member list at the 2000-row roster bound", () => {
    const many = Array.from({ length: 2001 }, (_, i) => ({
      name: `m${i}`,
      characterId: null,
      level: 1,
    }));
    const r = WowRosterInsightsSchema.safeParse({
      ...insights,
      classes: [{ class: "Mage", count: 2001, members: many }],
    });
    expect(r.success).toBe(false);
  });
});

describe("EventQuestReadiness", () => {
  it("parses quests × signups with every state", () => {
    const r = EventQuestReadinessSchema.safeParse({
      quests: [
        { questId: 166, title: "The Defias Brotherhood", instanceId: 9 },
      ],
      signups: [
        {
          userId: 1,
          characterId: 5,
          name: "Wren",
          perQuest: [
            { questId: 166, state: "done", prereqsMet: true, source: "addon" },
            { questId: 167, state: "unknown", prereqsMet: null, source: null },
          ],
        },
      ],
    });
    expect(r.success).toBe(true);
  });
  it("rejects an unknown state", () => {
    const r = EventQuestReadinessSchema.safeParse({
      quests: [],
      signups: [
        {
          userId: 1,
          characterId: null,
          name: "x",
          perQuest: [
            { questId: 1, state: "started", prereqsMet: null, source: null },
          ],
        },
      ],
    });
    expect(r.success).toBe(false);
  });
});
