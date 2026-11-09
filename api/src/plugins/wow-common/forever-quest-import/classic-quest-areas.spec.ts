import { readFileSync } from 'fs';
import { join } from 'path';
import {
  CLASSIC_QUEST_AREAS,
  areaNameMatches,
  classicQuestAreaInstanceIds,
  normaliseAreaName,
  type ClassicQuestArea,
} from './classic-quest-areas';

function must(entry: ClassicQuestArea | undefined, label: string) {
  if (!entry) throw new Error(`missing area entry: ${label}`);
  return entry;
}

const EXPECTED_INSTANCE_IDS = [
  63, 64, 226, 227, 228, 229, 230, 231, 232, 233, 234, 236, 237, 238, 239, 240,
  241, 246, 316,
];

describe('CLASSIC_QUEST_AREAS', () => {
  it('maps exactly the 19 classic dungeons, ascending', () => {
    expect(classicQuestAreaInstanceIds()).toEqual(EXPECTED_INSTANCE_IDS);
  });

  it('gives every dungeon a distinct positive area id', () => {
    const areaIds = Object.values(CLASSIC_QUEST_AREAS).map((a) => a.areaId);
    expect(new Set(areaIds).size).toBe(19);
    expect(areaIds.every((id) => Number.isInteger(id) && id > 0)).toBe(true);
  });

  it('pins the three areas verified against the live API (probe 2026-11-08)', () => {
    const verified = Object.entries(CLASSIC_QUEST_AREAS)
      .filter(([, a]) => a.verified)
      .map(([id, a]) => [Number(id), a.areaId]);
    expect(verified).toEqual([
      [63, 1581],
      [238, 717],
      [240, 718],
    ]);
  });

  it('lists the dungeon name first among the accepted area names', () => {
    for (const entry of Object.values(CLASSIC_QUEST_AREAS)) {
      expect(entry.areaNames[0]).toBe(entry.dungeon);
    }
  });

  it('covers every classic dungeon instance id in the bundled quest data', () => {
    const raw: unknown = JSON.parse(
      readFileSync(join(__dirname, '../data/dungeon-quest-data.json'), 'utf-8'),
    );
    if (!Array.isArray(raw)) throw new Error('quest data is not an array');
    const ids = new Set<number>();
    for (const q of raw) {
      const id: unknown = q?.dungeonInstanceId;
      if (q?.expansion === 'classic' && typeof id === 'number') ids.add(id);
    }
    const unmapped = [...ids].filter((id) => !(id in CLASSIC_QUEST_AREAS));
    expect(unmapped).toEqual([]);
  });
});

describe('normaliseAreaName', () => {
  it('drops case, a leading "the" and punctuation', () => {
    expect(normaliseAreaName('The Stockade')).toBe('stockade');
    expect(normaliseAreaName("Zul'Farrak")).toBe('zulfarrak');
    expect(normaliseAreaName('  ')).toBe('');
  });
});

describe('areaNameMatches', () => {
  const stockade = must(CLASSIC_QUEST_AREAS[238], '238');
  const sunkenTemple = must(CLASSIC_QUEST_AREAS[237], '237');
  const deadmines = must(CLASSIC_QUEST_AREAS[63], '63');

  it('accepts the quest/index name of a verified area', () => {
    expect(areaNameMatches(stockade, 'The Stockade')).toBe(true);
    expect(areaNameMatches(deadmines, 'The Deadmines')).toBe(true);
    expect(areaNameMatches(deadmines, 'Deadmines')).toBe(true);
  });

  it('accepts an alias', () => {
    expect(areaNameMatches(sunkenTemple, "The Temple of Atal'Hakkar")).toBe(
      true,
    );
  });

  it('rejects a different zone and an empty name', () => {
    expect(areaNameMatches(stockade, 'Elwynn Forest')).toBe(false);
    expect(areaNameMatches(stockade, 'Wetlands')).toBe(false);
    expect(areaNameMatches(stockade, '')).toBe(false);
  });
});
