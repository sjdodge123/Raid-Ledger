/**
 * ROK-2216 — the seed-guild `withDungeonPlan` fixture: the flag parses, the
 * dungeon picker finds a listed Forever dungeon with a Horde-only quest, and
 * the half writes the guild's Alliance faction plus Armory quests on the
 * three claimed characters (fixture for Playwright P5 + plan step S4).
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import type * as schema from '../drizzle/schema';
import {
  pickPlanDungeon,
  planCompletions,
  seedDungeonPlanHalf,
  type PlanQuestRow,
} from './demo-test-guild-dungeon-plan.helpers';
import { parseSeedGuildBody } from './demo-test-guild.helpers';
import type { SeededRoster } from './demo-test-guild.response';

const FOREVER = 'world-of-warcraft-forever';
const NOW = new Date('2026-11-16T12:00:00.000Z');
const NO_HORDE = { id: 10, name: 'No Horde Keep' };
const MIXED = { id: 20, name: 'Mixed Halls' };
const identity = (id: number): number[] => [id];

const QUESTS: PlanQuestRow[] = [
  { questId: 101, dungeonInstanceId: 10, raceRestriction: null },
  { questId: 203, dungeonInstanceId: 20, raceRestriction: ['Human'] },
  { questId: 201, dungeonInstanceId: 20, raceRestriction: null },
  { questId: 202, dungeonInstanceId: 20, raceRestriction: ['Orc', 'Troll'] },
  { questId: 204, dungeonInstanceId: 20, raceRestriction: [] },
];

const ROSTER: SeededRoster = {
  users: {
    gm: seedUser(1, 'c-gm', 11),
    officer: seedUser(2, 'c-officer', 12),
    member: seedUser(3, 'c-member', 14),
    outsider: { ...seedUser(4, null, null), rankIndex: null },
  },
  unlinked: [13, 15],
};

function seedUser(
  userId: number,
  characterId: string | null,
  memberId: number | null,
) {
  return {
    userId,
    username: `u${userId}`,
    discordId: `d${userId}`,
    characterId,
    memberId,
    rankIndex: memberId,
  };
}

function asDb(mock: MockDb): PostgresJsDatabase<typeof schema> {
  return mock as unknown as PostgresJsDatabase<typeof schema>;
}

describe('parseSeedGuildBody withDungeonPlan', () => {
  it('defaults to false, accepts true, rejects a non-boolean', () => {
    expect(parseSeedGuildBody({ name: 'Plan Guild' }).withDungeonPlan).toBe(
      false,
    );
    expect(
      parseSeedGuildBody({ name: 'Plan Guild', withDungeonPlan: true })
        .withDungeonPlan,
    ).toBe(true);
    expect(() =>
      parseSeedGuildBody({ name: 'Plan Guild', withDungeonPlan: 'yes' }),
    ).toThrow(BadRequestException);
  });
});

describe('pickPlanDungeon', () => {
  it('skips a dungeon with no Horde-only quest and picks the next one', () => {
    expect(pickPlanDungeon([NO_HORDE, MIXED], QUESTS, identity)).toEqual({
      instance: MIXED,
      hordeQuestId: 202,
      shownQuestIds: [201, 203, 204],
    });
  });

  it('follows the quest-instance aliases of the catalogue id', () => {
    const alias = (id: number): number[] => (id === 99 ? [20] : [id]);
    const aliased = { id: 99, name: 'Aliased Wing' };
    expect(pickPlanDungeon([aliased], QUESTS, alias)?.hordeQuestId).toBe(202);
  });

  it('returns null when no dungeon has a Horde-only and a shown quest', () => {
    const hordeOnly = QUESTS.filter((q) => q.questId === 202);
    expect(pickPlanDungeon([NO_HORDE, MIXED], hordeOnly, identity)).toBeNull();
  });
});

describe('planCompletions', () => {
  it('gives the gm all but the last quest, the officer the first, the member none', () => {
    expect(planCompletions([201, 203, 204])).toEqual({
      gm: [201, 203],
      officer: [201],
      member: [],
    });
  });
});

describe('seedDungeonPlanHalf', () => {
  let mock: MockDb;
  const ctx = { guildId: 7, now: NOW };
  const input = { withDungeonPlan: true, gameSlug: FOREVER };
  const catalogue = [NO_HORDE, MIXED];

  beforeEach(() => {
    mock = createDrizzleMock();
  });

  it('does nothing without the flag', async () => {
    const off = { ...input, withDungeonPlan: false };
    await expect(
      seedDungeonPlanHalf(asDb(mock), off, ctx, ROSTER, catalogue, identity),
    ).resolves.toEqual({});
    expect(mock.select).not.toHaveBeenCalled();
    expect(mock.update).not.toHaveBeenCalled();
  });

  it('rejects a non-Forever guild (the planner is Forever-only)', async () => {
    const classic = { ...input, gameSlug: 'world-of-warcraft-classic' };
    await expect(
      seedDungeonPlanHalf(asDb(mock), classic, ctx, ROSTER, catalogue, identity),
    ).rejects.toThrow(BadRequestException);
  });

  it('404s when the dungeon quest data has no usable dungeon', async () => {
    mock.where.mockResolvedValueOnce([]);
    await expect(
      seedDungeonPlanHalf(asDb(mock), input, ctx, ROSTER, catalogue, identity),
    ).rejects.toThrow(NotFoundException);
  });

  it('writes the Alliance faction and the Armory quests, and reports the plan', async () => {
    mock.where.mockResolvedValueOnce(QUESTS);
    const { dungeonPlan } = await seedDungeonPlanHalf(
      asDb(mock),
      input,
      ctx,
      ROSTER,
      catalogue,
      identity,
    );
    expect(mock.set).toHaveBeenCalledWith({ faction: 'Alliance' });
    const fetchedAt = NOW.toISOString();
    expect(mock.set).toHaveBeenCalledWith({
      armoryQuests: { fetchedAt, completed: [201, 203] },
    });
    expect(mock.set).toHaveBeenCalledWith({
      armoryQuests: { fetchedAt, completed: [201] },
    });
    expect(mock.set).toHaveBeenCalledWith({
      armoryQuests: { fetchedAt, completed: [] },
    });
    expect(dungeonPlan).toEqual({
      instanceId: 20,
      instanceName: 'Mixed Halls',
      guildFaction: 'Alliance',
      hiddenQuestId: 202,
      shownQuestIds: [201, 203, 204],
      characters: {
        gm: { characterId: 'c-gm', memberId: 11, completedQuestIds: [201, 203] },
        officer: { characterId: 'c-officer', memberId: 12, completedQuestIds: [201] },
        member: { characterId: 'c-member', memberId: 14, completedQuestIds: [] },
      },
      unlinkedMemberIds: [13, 15],
      planPath: '/hubs/7?d=20&c=c-gm,c-officer,m13#dungeon-planner',
    });
  });
});
