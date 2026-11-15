/**
 * ROK-2210 §f 10 / 12: every instance id the bundled quest and boss datasets
 * carry is an instance-catalogue id, and every Forever seed instance has a
 * Wowhead zone for the quest importer.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { INSIDE_DUNGEON_QUESTS } from '../data/dungeon-quest-inside-allowlist';
import {
  FOREVER_SEED_ID_BASE,
  getInstance,
  isCatalogueId,
} from './instance-catalogue';

const DATA_DIR = join(__dirname, '../data');

function readRows<T>(file: string): T[] {
  return JSON.parse(readFileSync(join(DATA_DIR, file), 'utf-8')) as T[];
}

interface QuestRow {
  questId: number;
  dungeonInstanceId: number | null;
}

interface BossRow {
  name: string;
  instanceId: number;
  expansion: string;
}

const QUEST_FILES = [
  'dungeon-quest-data.json',
  'forever-dungeon-quest-data.json',
] as const;

/** Distinct non-null ids a quest file keys on that the catalogue lacks. */
function unknownQuestInstanceIds(rows: QuestRow[]): number[] {
  const ids = rows.flatMap((r) =>
    r.dungeonInstanceId === null ? [] : [r.dungeonInstanceId],
  );
  return [...new Set(ids)].filter((id) => !isCatalogueId(id));
}

describe('instance catalogue integrity — quest datasets (ROK-2210 §f 10)', () => {
  it.each(QUEST_FILES)('%s keys only catalogue instance ids', (file) => {
    const rows = readRows<QuestRow>(file);
    expect(rows.length).toBeGreaterThan(0);
    expect(unknownQuestInstanceIds(rows)).toEqual([]);
  });

  it('INSIDE_DUNGEON_QUESTS name only quests filed under a catalogue id', () => {
    const owner = new Map<number, number | null>();
    for (const file of QUEST_FILES) {
      for (const r of readRows<QuestRow>(file)) {
        owner.set(r.questId, r.dungeonInstanceId);
      }
    }
    const offenders = INSIDE_DUNGEON_QUESTS.filter((q) => {
      const id = owner.get(q.questId);
      return id === undefined || id === null || !isCatalogueId(id);
    }).map((q) => `${q.questId} ${q.name} (${q.dungeon})`);
    expect(offenders).toEqual([]);
  });
});

describe('instance catalogue integrity — boss dataset (ROK-2210 §f 12)', () => {
  const bosses = readRows<BossRow>('boss-encounter-data.json');

  it.each(['classic', 'forever', 'sod'])(
    'every %s boss sits on a catalogue instance id',
    (expansion) => {
      const offenders = bosses
        .filter((b) => b.expansion === expansion)
        .filter((b) => !isCatalogueId(b.instanceId))
        .map((b) => `${b.name} @ ${b.instanceId}`);
      expect(offenders).toEqual([]);
    },
  );

  it('carries Classic bosses at all (the filter is not vacuous)', () => {
    expect(bosses.some((b) => b.expansion === 'classic')).toBe(true);
  });
});

describe('Forever seed Wowhead zones (replaces FOREVER_WOWHEAD_ZONES)', () => {
  const zoneOf = (n: number): number | null =>
    getInstance(FOREVER_SEED_ID_BASE + n, 'wow_forever')?.wowheadZoneId ?? null;

  it('keeps the four zone ids verified on 2026-10-09', () => {
    expect([1, 2, 3, 4].map(zoneOf)).toEqual([16919, 16611, 16732, 16544]);
  });

  it('maps every seed 1–11 (operator ruling Q5 shipped the candidates)', () => {
    const unmapped = Array.from({ length: 11 }, (_, i) => i + 1).filter(
      (n) => zoneOf(n) === null,
    );
    expect(unmapped).toEqual([]);
  });
});
