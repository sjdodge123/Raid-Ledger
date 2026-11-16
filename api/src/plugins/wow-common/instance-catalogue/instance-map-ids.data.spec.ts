/**
 * ROK-2218: the Classic dungeon map-id table resolves every in-game map id
 * to a top-level catalogue dungeon (never a wing), once each.
 * ROK-2219: the Forever-only dungeon map ids resolve to their Forever seed
 * rows, and every one of them carries `forever` boss rows for its total.
 */
import bossData from '../data/boss-encounter-data.json';
import {
  CLASSIC_DUNGEON_MAP_TO_JOURNAL,
  DUNGEON_MAP_TO_JOURNAL,
  FOREVER_DUNGEON_MAP_TO_SEED,
} from './instance-map-ids.data';
import {
  dungeonByInstanceMapId,
  getAnyVariant,
  getInstance,
  isMappedDungeonId,
} from './instance-catalogue';
import { FOREVER_SEED_ID_BASE } from './forever-new.data';

describe('DUNGEON_MAP_TO_JOURNAL', () => {
  it('covers the 19 Classic 5-man dungeons, each journal id once', () => {
    const journals = [...CLASSIC_DUNGEON_MAP_TO_JOURNAL.values()];
    expect(journals).toHaveLength(19);
    expect(new Set(journals).size).toBe(19);
  });

  it('is the Classic table plus the Forever table, no map id shared', () => {
    expect(DUNGEON_MAP_TO_JOURNAL.size).toBe(
      CLASSIC_DUNGEON_MAP_TO_JOURNAL.size + FOREVER_DUNGEON_MAP_TO_SEED.size,
    );
  });

  it.each([...CLASSIC_DUNGEON_MAP_TO_JOURNAL])(
    'map %i resolves to a top-level catalogue dungeon (journal %i)',
    (mapId, journalId) => {
      const row = getAnyVariant(journalId);
      expect(row?.category).toBe('dungeon');
      expect(row?.parentId).toBeNull();
      expect(dungeonByInstanceMapId(mapId)?.id).toBe(journalId);
      expect(isMappedDungeonId(journalId)).toBe(true);
    },
  );

  it('resolves Gnomeregan (map 90) and nothing for an unknown map', () => {
    expect(dungeonByInstanceMapId(90)?.name).toBe('Gnomeregan');
    expect(dungeonByInstanceMapId(99999)).toBeNull();
    expect(dungeonByInstanceMapId(409)).toBeNull();
    expect(isMappedDungeonId(741)).toBe(false);
  });
});

describe('FOREVER_DUNGEON_MAP_TO_SEED (ROK-2219)', () => {
  type BossRow = { instanceId: number; name: string; order: number; expansion: string };
  const bosses: readonly BossRow[] = bossData;
  const foreverBosses = (seedId: number): BossRow[] =>
    bosses.filter((b) => b.instanceId === seedId && b.expansion === 'forever');

  it('covers the nine Forever-new dungeons, seed ids 1–9 once each', () => {
    const seeds = [...FOREVER_DUNGEON_MAP_TO_SEED.values()].sort(
      (a, b) => a - b,
    );
    expect(seeds).toEqual(
      Array.from({ length: 9 }, (_, i) => FOREVER_SEED_ID_BASE + i + 1),
    );
  });

  it.each([...FOREVER_DUNGEON_MAP_TO_SEED])(
    'map %i resolves to the Forever seed dungeon %i with boss rows 1..n',
    (mapId, seedId) => {
      const row = getInstance(seedId, 'wow_forever');
      expect(row?.category).toBe('dungeon');
      expect(row?.parentId).toBeNull();
      expect(dungeonByInstanceMapId(mapId)?.id).toBe(seedId);
      expect(isMappedDungeonId(seedId)).toBe(true);
      const orders = foreverBosses(seedId).map((b) => b.order);
      expect(orders.length).toBeGreaterThan(0);
      expect(orders).toEqual(orders.map((_, i) => i + 1));
    },
  );

  it('map 3065 is The Hall of Thanes with its four bosses in encounter order', () => {
    expect(dungeonByInstanceMapId(3065)?.name).toBe('The Hall of Thanes');
    expect(foreverBosses(FOREVER_SEED_ID_BASE + 1).map((b) => b.name)).toEqual(
      ['Faldrim Anvilmar', 'Infurnus', 'Plunder', 'Durgen Dirgehammer'],
    );
  });
});
