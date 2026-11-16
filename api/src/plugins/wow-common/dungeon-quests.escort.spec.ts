/**
 * ROK-2224: every quest DTO path flags an escort quest with `isEscort: true`
 * (from ESCORT_QUEST_IDS) and leaves the key off a non-escort quest, so the
 * Dungeon planner and event Quest Prep can call escorts out.
 */
import type {
  WowDungeonQuestBlizzardRow,
  wowClassicDungeonQuests,
} from '../../drizzle/schema';
import { escortFields } from './data/dungeon-quest-escorts';
import { toDto } from './dungeon-quests.helpers';
import { overlayOnlyDto } from './dungeon-quests.overlay';

/** Willix the Importer (Razorfen Kraul) — an escort. */
const WILLIX = 1144;
/** A plain Razorfen Kraul kill quest — not an escort. */
const PLAIN = 1101;

type CuratedRow = typeof wowClassicDungeonQuests.$inferSelect;

function curatedRow(questId: number): CuratedRow {
  return {
    id: 1,
    questId,
    dungeonInstanceId: 491,
    name: `Quest ${questId}`,
    questLevel: 30,
    requiredLevel: 22,
    expansion: 'classic',
    questGiverNpc: null,
    questGiverZone: null,
    prevQuestId: null,
    nextQuestId: null,
    rewardsJson: null,
    objectives: null,
    classRestriction: null,
    raceRestriction: null,
    startsInsideDungeon: false,
    sharable: true,
    rewardXp: null,
    rewardGold: null,
    rewardType: 'none',
    createdAt: new Date('2026-11-16T00:00:00Z'),
  };
}

function overlayRow(questId: number): WowDungeonQuestBlizzardRow {
  return {
    questId,
    areaId: 491,
    dungeonInstanceId: 491,
    title: `Blizzard ${questId}`,
    typeId: 81,
    rewardXp: null,
    rewardMoneyCopper: null,
    rewardItems: [],
    reputations: [],
    requirementsRaw: null,
    raw: {},
    fetchedAt: new Date('2026-11-16T00:00:00Z'),
    runId: 'run-1',
  };
}

describe('escortFields (ROK-2224)', () => {
  it('returns isEscort: true for an escort quest', () => {
    expect(escortFields(WILLIX)).toEqual({ isEscort: true });
  });

  it('returns no key for a non-escort quest', () => {
    expect(escortFields(PLAIN)).toEqual({});
  });
});

describe('toDto escort flag (ROK-2224)', () => {
  it('flags Willix the Importer as an escort', () => {
    expect(toDto(curatedRow(WILLIX)).isEscort).toBe(true);
  });

  it('leaves isEscort off a non-escort quest', () => {
    expect(toDto(curatedRow(PLAIN))).not.toHaveProperty('isEscort');
  });
});

describe('overlayOnlyDto escort flag (ROK-2224)', () => {
  it('flags an overlay-only escort quest', () => {
    expect(overlayOnlyDto(overlayRow(WILLIX)).isEscort).toBe(true);
  });

  it('leaves isEscort off a non-escort overlay quest', () => {
    expect(overlayOnlyDto(overlayRow(PLAIN))).not.toHaveProperty('isEscort');
  });
});
