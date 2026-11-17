/**
 * ROK-2143 — bundled classic quest data integrity.
 * R7: no synthetic XP/money pattern remains (the old generator wrote
 * 45 at lvl 1 / 10×lvl+45 to lvl 28 / 15×lvl XP, and 25/50/100×lvl copper
 * tiered at lvl 20/40). Every `prevQuestId` resolves to a bundled row or is a
 * reviewed outside prerequisite in `EXTERNAL_PREREQS` (ROK-2221).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { instanceName } from './instance-catalogue/instance-catalogue';
import { INSIDE_DUNGEON_QUEST_IDS } from './data/dungeon-quest-inside-allowlist';
import { ESCORT_QUESTS, ESCORT_QUEST_IDS } from './data/dungeon-quest-escorts';
import { EXTERNAL_PREREQS } from './data/dungeon-quest-external-prereqs';

interface Row {
  questId: number;
  name: string;
  objectives: string | null;
  sharable: boolean;
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

  // ROK-2221: the old KNOWN_PREREQ_GAPS id list became a reviewed,
  // categorised map. A dangling prevQuestId must be named there (same
  // prerequisite id), and every entry must still be a real gap.
  it('every prevQuestId resolves to a bundled row or an EXTERNAL_PREREQS entry', () => {
    const ids = new Set(rows.map((r) => r.questId));
    const dangling = rows
      .filter((r) => r.prevQuestId !== null && !ids.has(Number(r.prevQuestId)))
      .map((r) => `${r.questId} -> ${Number(r.prevQuestId)}`)
      .sort();
    const named = [...EXTERNAL_PREREQS]
      .map(([dependent, ext]) => `${dependent} -> ${ext.prereqId}`)
      .sort();
    expect(dangling).toEqual(named);
  });

  it('EXTERNAL_PREREQS holds the 25 reviewed prerequisites (ROK-2221)', () => {
    const prereqs = new Set(
      [...EXTERNAL_PREREQS.values()].map((e) => e.prereqId),
    );
    expect(prereqs.size).toBe(25);
    expect(EXTERNAL_PREREQS.size).toBe(56);
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
  // Alliance halves of faction-split pairs: the Horde copies are 7478-7480
  // (librams) and 7487 (Attunement to the Core), so these stay Alliance-only.
  [7483, 'alliance'],
  [7484, 'alliance'],
  [7485, 'alliance'],
  [7848, 'alliance'],
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

/** ROK-2223: givers the cross-check and Blizzard quest text place inside. */
const REVIEWED_INSIDE: readonly number[] = [2201, 2318, 5160, 7483, 7484, 7485];

describe('reviewed inside pickups (ROK-2223)', () => {
  it.each(REVIEWED_INSIDE)('quest %i is picked up inside', (questId) => {
    expect({
      questId,
      allowlisted: INSIDE_DUNGEON_QUEST_IDS.has(questId),
      flagged: must(questId).startsInsideDungeon,
    }).toEqual({ questId, allowlisted: true, flagged: true });
  });
});

/** Objectives that open with an escort/defend verb (generalised guard). */
const ESCORT_OBJECTIVE = /^\s*(Escort|Defend|Protect)\b/;

describe('escort quests (ROK-2223)', () => {
  it('every listed escort names a bundled quest', () => {
    const mismatched = ESCORT_QUESTS.filter(
      (entry) => byId.get(entry.questId)?.name !== entry.name,
    ).map((entry) => entry.questId);
    expect(mismatched).toEqual([]);
  });

  it('no escort quest is shareable', () => {
    const shareable = [...ESCORT_QUEST_IDS].filter((id) => must(id).sharable);
    expect(shareable).toEqual([]);
  });

  it('every quest whose objectives open with Escort/Defend/Protect is listed', () => {
    const unlisted = allRows
      .filter((r) => ESCORT_OBJECTIVE.test(r.objectives ?? ''))
      .filter((r) => !ESCORT_QUEST_IDS.has(r.questId))
      .map((r) => r.questId);
    expect(unlisted).toEqual([]);
  });
});

describe('reviewed prerequisites (ROK-2223)', () => {
  it("5125 Aurius' Reckoning follows 5122 The Medallion of Faith", () => {
    expect({
      prevOf5125: Number(must(5125).prevQuestId),
      nextOf5122: Number(must(5122).nextQuestId),
    }).toEqual({ prevOf5125: 5122, nextOf5122: 5125 });
  });

  it('each Dire Maul libram follows its own side of Elven Legends', () => {
    const prereqs = [7483, 7484, 7485, 7478, 7479, 7480].map((id) =>
      Number(must(id).prevQuestId),
    );
    expect(prereqs).toEqual([7482, 7482, 7482, 7481, 7481, 7481]);
  });
});

/**
 * A shared chain start may be neutral while its next steps split by faction
 * (2278 The Platinum Discs -> 2279 Alliance / 2280 Horde). Any other neutral
 * row with a same-name, same-dungeon faction copy shows twice for that side.
 */
const SHARED_NEUTRAL_CHAIN_STARTS: readonly number[] = [2278];

describe('faction-split quest pairs (ROK-2223)', () => {
  it('no neutral quest shares its name and dungeon with a faction copy', () => {
    const key = (r: Row) => `${r.name}|${r.dungeonInstanceId}`;
    const restricted = new Set(
      allRows.filter((r) => sideOf(r) !== 'neutral').map(key),
    );
    const doubled = allRows
      .filter((r) => sideOf(r) === 'neutral' && restricted.has(key(r)))
      .filter((r) => !SHARED_NEUTRAL_CHAIN_STARTS.includes(r.questId))
      .map((r) => `${r.questId} ${r.name}`);
    expect(doubled).toEqual([]);
  });
});

describe('ROK-2221 bundled gap rows', () => {
  it('1490 Nara Wildmane bridges 1489 to 914 in Wailing Caverns', () => {
    expect(must(914).prevQuestId).toBe('1490');
    expect(must(1490)).toMatchObject({
      dungeonInstanceId: 240,
      prevQuestId: '1489',
      questGiverZone: 'Thunder Bluff',
    });
    expect(sideOf(must(1490))).toBe('horde');
  });

  it('155 The Defias Brotherhood is an outside step and an escort', () => {
    expect(must(155)).toMatchObject({
      dungeonInstanceId: null,
      sharable: false,
    });
    expect(ESCORT_QUEST_IDS.has(155)).toBe(true);
    expect(must(214).prevQuestId).toBe('155');
    expect(must(166).prevQuestId).toBe('155');
  });

  it('the Coldbringer split pair is one quest per side', () => {
    expect(sideOf(must(96773))).toBe('alliance');
    expect(sideOf(must(97196))).toBe('horde');
  });
});
