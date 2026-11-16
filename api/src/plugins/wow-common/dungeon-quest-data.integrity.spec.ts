/**
 * ROK-2143 — bundled classic quest data integrity.
 * R7: no synthetic XP/money pattern remains (the old generator wrote
 * 45 at lvl 1 / 10×lvl+45 to lvl 28 / 15×lvl XP, and 25/50/100×lvl copper
 * tiered at lvl 20/40). Every `prevQuestId` resolves to a bundled row or is a
 * known gap — the list must shrink, never grow.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { instanceName } from './instance-catalogue/instance-catalogue';
import { INSIDE_DUNGEON_QUEST_IDS } from './data/dungeon-quest-inside-allowlist';

interface Row {
  questId: number;
  dungeonInstanceId: number | null;
  questLevel: number | null;
  questGiverZone: string | null;
  prevQuestId: number | string | null;
  rewardXp: number | null;
  rewardGold: number | null;
  nextQuestId: number | string | null;
  raceRestriction: string[] | null;
  startsInsideDungeon: boolean;
}

const readRows = (file: string): Row[] =>
  JSON.parse(readFileSync(join(__dirname, 'data', file), 'utf-8')) as Row[];

const rows = readRows('dungeon-quest-data.json');

const synthXp = (l: number) => (l === 1 ? 45 : l <= 28 ? 10 * l + 45 : 15 * l);
const synthGold = (l: number) => (l <= 20 ? 25 : l <= 40 ? 50 : 100) * l;

/** Quests whose prerequisite is not in the bundled data (ROK-2143 audit). */
const KNOWN_PREREQ_GAPS: readonly number[] = [
  5728, 214, 1491, 1653, 166, 914, 1275, 378, 391, 721, 1951, 1956, 1139, 2936,
  2991, 3527, 1445, 1475, 3446, 4143, 8232, 8236, 8253, 8257, 8413, 8418, 8422,
  8425, 9053, 3528, 4148, 4241, 4024, 4063, 4788, 4341, 5127, 5463, 5466, 5522,
  5526, 5848, 6163, 7642, 7647, 7737, 8258, 8926, 8927, 8931, 8932, 8933, 8934,
  8935, 8936, 8937, 8938, 8939, 8940, 8941, 8942, 8943, 8944, 8948, 8966, 8967,
  8968, 8969, 8989, 8990, 8991, 8992, 8999, 9000, 9001, 9002, 9003, 9004, 9005,
  9006, 9007, 9008, 9009, 9010, 9011, 9012, 9013, 9014, 9257, 9269, 9270, 9271,
  1160, 1053,
];

describe('bundled classic dungeon quest data (ROK-2143)', () => {
  it('carries no synthetic XP value (R7)', () => {
    const synthetic = rows
      .filter(
        (r) =>
          r.rewardXp !== null &&
          r.questLevel !== null &&
          r.rewardXp === synthXp(r.questLevel),
      )
      .map((r) => r.questId);
    expect(synthetic).toEqual([]);
  });

  it('carries no synthetic money value (R7)', () => {
    const synthetic = rows
      .filter(
        (r) =>
          r.rewardGold !== null &&
          r.questLevel !== null &&
          r.rewardGold === synthGold(r.questLevel),
      )
      .map((r) => r.questId);
    expect(synthetic).toEqual([]);
  });

  // R5=B, Lead ruling: an inside-start quest (ROK-2142 allowlist) really is
  // given inside its dungeon, so only the others may not name it.
  it("names the quest's own dungeon as giver zone only for inside starts (R5=B)", () => {
    const own = rows
      .filter(
        (r) =>
          r.dungeonInstanceId !== null &&
          !INSIDE_DUNGEON_QUEST_IDS.has(r.questId) &&
          r.questGiverZone === instanceName(r.dungeonInstanceId),
      )
      .map((r) => r.questId);
    expect(own).toEqual([]);
  });

  it('every prevQuestId resolves to a bundled row or is a listed known gap', () => {
    const ids = new Set(rows.map((r) => r.questId));
    const dangling = rows
      .filter((r) => r.prevQuestId !== null && !ids.has(Number(r.prevQuestId)))
      .map((r) => r.questId)
      .sort((a, b) => a - b);
    expect(dangling).toEqual([...KNOWN_PREREQ_GAPS].sort((a, b) => a - b));
  });

  it('no quest is its own prerequisite', () => {
    expect(rows.filter((r) => Number(r.prevQuestId) === r.questId)).toEqual([]);
  });
});

/** Classic + Forever rows: every row the planner can show. */
const allRows: Row[] = [
  ...rows,
  ...readRows('forever-dungeon-quest-data.json'),
];
const byId = new Map(allRows.map((r) => [r.questId, r]));

type Side = 'alliance' | 'horde' | 'neutral' | 'mixed';
const HORDE = new Set(['Troll', 'Tauren', 'Undead', 'Orc']);
const ALLIANCE = new Set(['Gnome', 'Night Elf', 'Dwarf', 'Human']);

/** The side a row's `raceRestriction` implies (null/[] = neutral). */
function sideOf(r: Row): Side {
  const races = r.raceRestriction ?? [];
  if (races.length === 0) return 'neutral';
  if (races.every((race) => HORDE.has(race))) return 'horde';
  if (races.every((race) => ALLIANCE.has(race))) return 'alliance';
  return 'mixed';
}

function must(questId: number): Row {
  const row = byId.get(questId);
  if (!row) throw new Error(`quest ${questId} is not in the bundled data`);
  return row;
}

interface FactionSnapshot {
  alliance: number[];
  horde: number[];
}

const snapshot = JSON.parse(
  readFileSync(
    join(__dirname, '__fixtures__', 'blizzard-quest-faction.snapshot.json'),
    'utf-8',
  ),
) as FactionSnapshot;

/**
 * AQ-war "Just Compensation" rows: neutral in the bundle, Blizzard has the
 * faction, and the ROK-2143 overlay applies it at request time. This list
 * must shrink, never grow — fix the data instead of adding to it.
 */
const OVERLAY_CORRECTED_FACTIONS: readonly number[] = [
  8926, 8927, 8931, 8932, 8933, 8934, 8935, 8936, 8937, 8938, 8939, 8940, 8941,
  8942, 8943, 8944,
];

/** Zones whose quest givers only serve one faction (AreaTable FactionGroupMask). */
const CAPITAL_SIDE: ReadonlyMap<string, Side> = new Map<string, Side>([
  ['Orgrimmar', 'horde'],
  ['Thunder Bluff', 'horde'],
  ['Undercity', 'horde'],
  ['Stormwind', 'alliance'],
  ['Stormwind City', 'alliance'],
  ['Ironforge', 'alliance'],
  ['Darnassus', 'alliance'],
]);

describe('bundled dungeon quest factions (ROK-2220)', () => {
  it('1102 A Vengeful Fate is a Horde quest', () => {
    expect({ questId: 1102, side: sideOf(must(1102)) }).toEqual({
      questId: 1102,
      side: 'horde',
    });
  });

  it('1142 Mortality Wanes is Alliance and picked up inside the Kraul', () => {
    const row = must(1142);
    expect({
      side: sideOf(row),
      allowlisted: INSIDE_DUNGEON_QUEST_IDS.has(1142),
      flagged: row.startsInsideDungeon,
    }).toEqual({ side: 'alliance', allowlisted: true, flagged: true });
  });

  it("1101 The Crone of the Kraul chains from 1100 Lonebrow's Journal", () => {
    const prereq = must(1100);
    expect({
      prevOf1101: Number(must(1101).prevQuestId),
      next: Number(prereq.nextQuestId),
      dungeon: prereq.dungeonInstanceId,
      side: sideOf(prereq),
    }).toEqual({
      prevOf1101: 1100,
      next: 1101,
      dungeon: null,
      side: 'alliance',
    });
  });

  it('every Blizzard-provided faction matches the bundle or the overlay list', () => {
    const differs = (side: Side, ids: number[]): number[] =>
      ids.filter((id) => sideOf(must(id)) !== side);
    const mismatched = [
      ...differs('alliance', snapshot.alliance),
      ...differs('horde', snapshot.horde),
    ].sort((a, b) => a - b);
    expect(mismatched).toEqual([...OVERLAY_CORRECTED_FACTIONS]);
  });

  it('no chained quest in the same dungeon is the opposite faction of its prerequisite', () => {
    const opposite = allRows
      .map((r) => ({ r, prev: byId.get(Number(r.prevQuestId)) }))
      .filter(({ r, prev }) => prev?.dungeonInstanceId === r.dungeonInstanceId)
      .filter(({ r, prev }) => {
        const pair = new Set([sideOf(r), prev ? sideOf(prev) : 'neutral']);
        return pair.has('horde') && pair.has('alliance');
      })
      .map(({ r }) => r.questId);
    expect(opposite).toEqual([]);
  });

  it('a quest given in a faction capital carries that faction', () => {
    const wrong = allRows
      .filter((r) => r.questGiverZone !== null)
      .filter((r) => {
        const side = CAPITAL_SIDE.get(r.questGiverZone ?? '');
        return side !== undefined && sideOf(r) !== side;
      })
      .map((r) => `${r.questId} ${r.questGiverZone} ${sideOf(r)}`);
    expect(wrong).toEqual([]);
  });
});

/**
 * ROK-2223 second pass: rows changed one by one where an offline cross-check
 * disagreed AND an independent signal agreed (Blizzard quest text naming a
 * faction town or leader, or the giver/hand-in named in our own row).
 */
const REVIEWED_SIDES: ReadonlyArray<readonly [number, Side]> = [
  // Neutral givers: Lorekeeper Lydros inside Dire Maul, Lothos Riftwaker in
  // Blackrock Mountain. Restricting them hid real quests from Horde rosters.
  [7483, 'neutral'],
  [7484, 'neutral'],
  [7485, 'neutral'],
  [7848, 'neutral'],
  // Horde: Sepulcher/"the Dark Lady", Stonard, Orgrimmar, Kargath, Forsaken.
  [1014, 'horde'],
  [1098, 'horde'],
  [1445, 'horde'],
  [2283, 'horde'],
  [2284, 'horde'],
  [2318, 'horde'],
  [2338, 'horde'],
  [2841, 'horde'],
  [2842, 'horde'],
  [2843, 'horde'],
  [4082, 'horde'],
  [4122, 'horde'],
  [4133, 'horde'],
  [4134, 'horde'],
  [4903, 'horde'],
  [4983, 'horde'],
  [7068, 'horde'],
  // Alliance: hand-in to Master Mechanic Castpipe in Ironforge.
  [2930, 'alliance'],
];

describe('reviewed dungeon quest rows (ROK-2223)', () => {
  it.each(REVIEWED_SIDES)('quest %i is %s', (questId, side) => {
    expect({ questId, side: sideOf(must(questId)) }).toEqual({ questId, side });
  });
});
