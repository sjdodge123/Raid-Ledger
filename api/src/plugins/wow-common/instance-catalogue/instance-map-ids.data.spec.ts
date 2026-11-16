/**
 * ROK-2218: the Classic dungeon map-id table resolves every in-game map id
 * to a top-level catalogue dungeon (never a wing), once each.
 */
import { DUNGEON_MAP_TO_JOURNAL } from './instance-map-ids.data';
import {
  dungeonByInstanceMapId,
  getAnyVariant,
  isMappedDungeonId,
} from './instance-catalogue';

describe('DUNGEON_MAP_TO_JOURNAL', () => {
  it('covers the 19 Classic 5-man dungeons, each journal id once', () => {
    const journals = [...DUNGEON_MAP_TO_JOURNAL.values()];
    expect(journals).toHaveLength(19);
    expect(new Set(journals).size).toBe(19);
  });

  it.each([...DUNGEON_MAP_TO_JOURNAL])(
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
    expect(dungeonByInstanceMapId(3065)).toBeNull();
    expect(dungeonByInstanceMapId(409)).toBeNull();
    expect(isMappedDungeonId(741)).toBe(false);
  });
});
