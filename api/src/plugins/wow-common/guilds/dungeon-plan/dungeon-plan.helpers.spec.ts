/**
 * ROK-2214 U1–U6 — the dungeon plan's pure steps.
 */
import type { DungeonQuestDto } from '../../dungeon-quests.types';
import { WOW_FOREVER_GAME_SLUG } from '../../wow-forever-identity.helpers';
import {
  filterQuestSetBySide,
  isPlannerHub,
  levelFit,
  pickRosterCharacters,
  resolvePlanSide,
  type PlanQuestSet,
} from './dungeon-plan.helpers';

const quest = (
  questId: number,
  raceRestriction: string[] | null,
  dungeonInstanceId: number | null = 43,
): DungeonQuestDto => ({
  questId,
  dungeonInstanceId,
  name: `Quest ${questId}`,
  questLevel: null,
  requiredLevel: null,
  expansion: 'classic',
  questGiverNpc: null,
  questGiverZone: null,
  prevQuestId: null,
  nextQuestId: null,
  rewardsJson: null,
  objectives: null,
  classRestriction: null,
  raceRestriction,
  startsInsideDungeon: false,
  sharable: true,
  rewardXp: null,
  rewardGold: null,
  rewardType: null,
});

const questSet = (eventQuests: DungeonQuestDto[]): PlanQuestSet => ({
  eventQuests,
  lookup: new Map(eventQuests.map((q) => [q.questId, q])),
  knownIds: new Set(eventQuests.map((q) => q.questId)),
});

const ids = (set: PlanQuestSet) => set.eventQuests.map((q) => q.questId);

const char = (charRace: string | null, charFaction: string | null = null) => ({
  charRace,
  charFaction,
});

describe('levelFit (U1)', () => {
  it('places a level against an inclusive range', () => {
    const fits = [27, 28, 33, 34, null].map((l) => levelFit(l, 28, 33));
    expect(fits).toEqual(['below', 'in', 'in', 'above', 'unknown']);
  });
});

describe('resolvePlanSide (U2, U3)', () => {
  it('U2: the guild faction wins over the characters', () => {
    const side = resolvePlanSide('Alliance', [char('Orc'), char('Troll')]);
    expect(side).toEqual({ side: 'alliance', sideSource: 'guild' });
  });

  it('U3: no guild faction → the characters’ shared side', () => {
    expect(resolvePlanSide(null, [char('Orc'), char('Tauren')])).toEqual({
      side: 'horde',
      sideSource: 'characters',
    });
  });

  it('U3: an unknown character does not break the shared side', () => {
    expect(resolvePlanSide(null, [char(null), char('Undead')])).toEqual({
      side: 'horde',
      sideSource: 'characters',
    });
  });

  it('U3: a stored faction column stands in for an unknown race', () => {
    expect(resolvePlanSide('', [char(null, 'HORDE')])).toEqual({
      side: 'horde',
      sideSource: 'characters',
    });
  });

  it('U3: mixed sides or no characters → no side', () => {
    const none = { side: null, sideSource: null };
    expect(resolvePlanSide(null, [char('Orc'), char('Human')])).toEqual(none);
    expect(resolvePlanSide(null, [])).toEqual(none);
    expect(resolvePlanSide('Neutral', [])).toEqual(none);
  });
});

describe('filterQuestSetBySide (U4)', () => {
  const HORDE_ONLY = quest(500, ['Orc', 'Troll']);
  const ALLIANCE_ONLY = quest(600, ['Human']);
  const set = questSet([
    HORDE_ONLY,
    ALLIANCE_ONLY,
    quest(300, null),
    quest(200, []),
    quest(900, ['Pandaren']),
  ]);

  it('drops the other side’s quests, keeps neutral ones, counts them', () => {
    const r = filterQuestSetBySide(set, 'alliance');
    expect(ids(r.questSet)).toEqual([600, 300, 200, 900]);
    expect(r.hidden).toBe(1);
  });

  it('keeps lookup and knownIds whole for chain walks', () => {
    const r = filterQuestSetBySide(set, 'alliance');
    expect(r.questSet.lookup).toBe(set.lookup);
    expect(r.questSet.knownIds).toBe(set.knownIds);
    expect(set.eventQuests).toHaveLength(5);
  });

  it('removes nothing without a side', () => {
    const r = filterQuestSetBySide(set, null);
    expect(ids(r.questSet)).toEqual([500, 600, 300, 200, 900]);
    expect(r.hidden).toBe(0);
  });

  it('counts a removed quest once, and never one without an instance', () => {
    const dupes = questSet([HORDE_ONLY, HORDE_ONLY, quest(501, ['Orc'], null)]);
    const r = filterQuestSetBySide(dupes, 'alliance');
    expect(ids(r.questSet)).toEqual([]);
    expect(r.hidden).toBe(1);
  });
});

describe('pickRosterCharacters (U5)', () => {
  const A = 'aaaaaaaa-1111-4111-8111-111111111111';
  const B = 'bbbbbbbb-1111-4111-8111-111111111111';
  const C = 'cccccccc-1111-4111-8111-111111111111';
  const X = 'dddddddd-1111-4111-8111-111111111111';
  const rows = [
    { key: 'm1', memberId: 1, characterId: A, userId: 10 },
    { key: 'm2', memberId: 2, characterId: B, userId: 11 },
    { key: 'm3', memberId: 3, characterId: null, userId: null },
    { key: 'm4', memberId: 4, characterId: C, userId: null },
  ];

  it('keeps claimed rows in request order, deduped; drops the rest', () => {
    const r = pickRosterCharacters(rows, [B, X, A, B]);
    expect(r.kept.map((k) => k.key)).toEqual(['m2', 'm1']);
    expect(r.dropped).toEqual([X]);
  });

  it('drops a linked but unclaimed character', () => {
    const r = pickRosterCharacters(rows, [C, X, X]);
    expect(r.kept).toEqual([]);
    expect(r.dropped).toEqual([C, X]);
  });
});

describe('isPlannerHub (U6)', () => {
  it('accepts only a Forever wow_guild hub', () => {
    const forever = WOW_FOREVER_GAME_SLUG;
    expect(isPlannerHub({ kind: 'wow_guild', gameSlug: forever })).toBe(true);
    expect(isPlannerHub({ kind: 'game_community', gameSlug: forever })).toBe(
      false,
    );
    expect(
      isPlannerHub({
        kind: 'wow_guild',
        gameSlug: 'world-of-warcraft-classic',
      }),
    ).toBe(false);
    expect(isPlannerHub({ kind: 'wow_guild', gameSlug: null })).toBe(false);
    expect(isPlannerHub(null)).toBe(false);
  });
});
