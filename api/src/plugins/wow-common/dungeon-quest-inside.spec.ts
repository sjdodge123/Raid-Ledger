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

interface QuestRow {
  questId: number;
  dungeonInstanceId: number | null;
  name: string;
  startsInsideDungeon: boolean;
}

const readData = (file: string): QuestRow[] =>
  JSON.parse(
    readFileSync(join(__dirname, 'data', file), 'utf-8'),
  ) as QuestRow[];
const classicData = readData('dungeon-quest-data.json');
const foreverData = readData('forever-dungeon-quest-data.json');
const STOCKADE = 238;

describe('dungeon quests acquired inside the instance (ROK-2142)', () => {
  it('marks none of the Stockade quests as inside', () => {
    const stockade = classicData.filter(
      (row) => row.dungeonInstanceId === STOCKADE,
    );
    expect(stockade).toHaveLength(6);
    const inside = stockade.filter((row) => row.startsInsideDungeon);
    expect(inside.map((row) => row.name)).toEqual([]);
  });

  it('curates exactly 65 inside quests with no duplicates', () => {
    expect(INSIDE_DUNGEON_QUESTS).toHaveLength(65);
    expect(INSIDE_DUNGEON_QUEST_IDS.size).toBe(65);
  });

  it('bundled Classic data flags exactly the allowlist as inside', () => {
    const flagged = classicData
      .filter((row) => row.startsInsideDungeon)
      .map((row) => row.questId)
      .sort((a, b) => a - b);
    expect(flagged).toEqual(
      [...INSIDE_DUNGEON_QUEST_IDS].sort((a, b) => a - b),
    );
  });

  it('every allowlist entry names a bundled Classic quest', () => {
    const byId = new Map(classicData.map((row) => [row.questId, row.name]));
    const mismatched = INSIDE_DUNGEON_QUESTS.filter(
      (entry) => byId.get(entry.questId) !== entry.name,
    ).map((entry) => entry.questId);
    expect(mismatched).toEqual([]);
  });

  it('keeps every Forever row outside (none verified yet)', () => {
    expect(foreverData.filter((row) => row.startsInsideDungeon)).toEqual([]);
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
