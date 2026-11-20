/**
 * ROK-2142: `startsInsideDungeon` means "only acquired inside the instance",
 * not "assigned to this dungeon". Pins the curated allowlist and the bundled
 * data that the seeder writes.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  INSIDE_DUNGEON_QUESTS,
  INSIDE_DUNGEON_QUEST_IDS,
} from './data/dungeon-quest-inside-allowlist';
import { applyInsideAllowlist } from './dungeon-quest-seeder';
import { toDungeonQuestRow } from './forever-quest-import/forever-quest.row';
import type { ParsedQuest } from './forever-quest-import/forever-quest.parse';

interface QuestRow {
  questId: number;
  dungeonInstanceId: number | null;
  name: string;
  startsInsideDungeon: boolean;
  questGiverNpc: string | null;
}

const readData = (file: string): QuestRow[] =>
  JSON.parse(
    readFileSync(join(__dirname, 'data', file), 'utf-8'),
  ) as QuestRow[];
const classicData = readData('dungeon-quest-data.json');
const foreverData = readData('forever-dungeon-quest-data.json');
const STOCKADE = 238;
const RUINS_OF_LORDAERON = 90000002;
const byQuestId = (rows: QuestRow[]): number[] =>
  rows.map((row) => row.questId).sort((a, b) => a - b);
const foreverIds = new Set(foreverData.map((row) => row.questId));

describe('dungeon quests acquired inside the instance (ROK-2142)', () => {
  it('marks none of the Stockade quests as inside', () => {
    const stockade = classicData.filter(
      (row) => row.dungeonInstanceId === STOCKADE,
    );
    expect(stockade).toHaveLength(6);
    const inside = stockade.filter((row) => row.startsInsideDungeon);
    expect(inside.map((row) => row.name)).toEqual([]);
  });

  it('curates exactly 89 inside quests with no duplicates', () => {
    expect(INSIDE_DUNGEON_QUESTS).toHaveLength(89);
    expect(INSIDE_DUNGEON_QUEST_IDS.size).toBe(89);
  });

  it('bundled Classic data flags exactly the Classic allowlist as inside', () => {
    const flagged = byQuestId(
      classicData.filter((row) => row.startsInsideDungeon),
    );
    const classicListed = [...INSIDE_DUNGEON_QUEST_IDS]
      .filter((id) => !foreverIds.has(id))
      .sort((a, b) => a - b);
    expect(flagged).toEqual(classicListed);
  });

  it('every allowlist entry names a bundled Classic or Forever quest', () => {
    const byId = new Map(
      [...classicData, ...foreverData].map((row) => [row.questId, row.name]),
    );
    const mismatched = INSIDE_DUNGEON_QUESTS.filter(
      (entry) => byId.get(entry.questId) !== entry.name,
    ).map((entry) => entry.questId);
    expect(mismatched).toEqual([]);
  });

  it('bundled Forever data flags exactly the Forever allowlist as inside', () => {
    const flagged = byQuestId(
      foreverData.filter((row) => row.startsInsideDungeon),
    );
    const foreverListed = [...INSIDE_DUNGEON_QUEST_IDS]
      .filter((id) => foreverIds.has(id))
      .sort((a, b) => a - b);
    expect(flagged).toEqual(foreverListed);
  });

  // ROK-2269 guard: a Forever dungeon quest with no start NPC starts from an
  // item or object inside, so it must be allowlisted (or it shows under
  // "Get before you go in").
  it('lists every bundled no-start-NPC Forever dungeon quest (ROK-2269)', () => {
    const unlisted = foreverData
      .filter(
        (row) =>
          row.dungeonInstanceId !== null &&
          row.questGiverNpc === null &&
          !INSIDE_DUNGEON_QUEST_IDS.has(row.questId),
      )
      .map((row) => `${row.questId} ${row.name}`);
    expect(unlisted).toEqual([]);
  });

  it('resolves the four reported Ruins of Lordaeron quests to inside', () => {
    const reported = [
      'Abominable Creatures',
      'Bloodied Insignia',
      'Crest of Lordaeron',
      'Remember That I Love You',
    ];
    const rows = applyInsideAllowlist(
      foreverData.filter(
        (row) =>
          row.dungeonInstanceId === RUINS_OF_LORDAERON &&
          reported.includes(row.name),
      ),
    );
    expect(rows.map((row) => row.questId).sort((a, b) => a - b)).toEqual([
      92415, 95189, 95195, 95204, 95250,
    ]);
    expect(rows.filter((row) => !row.startsInsideDungeon)).toEqual([]);
  });

  it('Forever importer reads the allowlist (ROK-2269)', () => {
    const parsed: ParsedQuest = {
      questLevel: 18,
      requiredLevel: 15,
      startNpcId: null,
      startNpcName: null,
      side: null,
      prevQuestId: null,
      nextQuestId: null,
      sharable: false,
      series: [],
      seriesIssue: null,
    };
    const row = (id: number) =>
      toDungeonQuestRow({ id, name: 'Quest' }, parsed, 2);
    const inside = row(95195);
    const outside = row(386);
    expect(inside.ok && inside.row.startsInsideDungeon).toBe(true);
    expect(outside.ok && outside.row.startsInsideDungeon).toBe(false);
  });

  it('seeder forces the flag from the allowlist, not the JSON', () => {
    const rows = [
      { questId: 386, startsInsideDungeon: true },
      { questId: 4295, startsInsideDungeon: false },
    ];
    expect(applyInsideAllowlist(rows)).toEqual([
      { questId: 386, startsInsideDungeon: false },
      { questId: 4295, startsInsideDungeon: true },
    ]);
  });
});
