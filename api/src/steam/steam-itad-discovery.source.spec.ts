/**
 * ROK-1680: discoverGameViaItad writes the steamAppIdSource its caller
 * supplies — on the insert, on the suffixed-slug retry, and on the merge.
 * (Kept out of steam-itad-discovery.helpers.spec.ts, which sits at the
 * 750-line test-file limit.)
 */
import {
  discoverGameViaItad,
  type DiscoveryDeps,
} from './steam-itad-discovery.helpers';
import type { ItadGame } from '../itad/itad.constants';
import { withMockTransaction } from '../common/testing/drizzle-mock';

jest.mock('./steam-igdb-enrichment.helpers', () => ({
  enrichFromIgdb: jest.fn().mockResolvedValue(null),
}));

jest.mock('./steam-content-filter.helpers', () => ({
  checkAdultContent: jest.fn().mockReturnValue({ isAdult: false }),
}));

const STEAM_APP_ID = 1245620;

const ITAD_GAME: ItadGame = {
  id: 'uuid-elden',
  slug: 'elden-ring',
  title: 'Elden Ring',
  type: 'game',
  mature: false,
};

function buildMockDb() {
  const insertReturning = jest.fn();
  const insertValues = jest.fn().mockReturnValue({
    onConflictDoNothing: jest.fn().mockReturnValue({
      returning: insertReturning,
    }),
  });
  const updateWhere = jest.fn().mockResolvedValue(undefined);
  const updateSet = jest.fn().mockReturnValue({ where: updateWhere });
  const findFirst = jest.fn().mockResolvedValue(undefined);
  const selectWhere = jest.fn().mockResolvedValue([]);
  const db = withMockTransaction({
    insert: jest.fn().mockReturnValue({ values: insertValues }),
    update: jest.fn().mockReturnValue({ set: updateSet }),
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({ where: selectWhere }),
    }),
    query: { games: { findFirst } },
  }) as unknown as DiscoveryDeps['db'];
  const deps: DiscoveryDeps = {
    db,
    lookupBySteamAppId: jest.fn().mockResolvedValue(ITAD_GAME),
    adultFilterEnabled: false,
  };
  return { deps, insertReturning, insertValues, updateSet, findFirst };
}

describe('discoverGameViaItad — steamAppIdSource tagging (ROK-1680)', () => {
  it.each(['steam', 'itad'] as const)(
    'inserts the new row tagged %s',
    async (tag) => {
      const m = buildMockDb();
      m.insertReturning.mockResolvedValueOnce([{ id: 42 }]);

      await discoverGameViaItad(STEAM_APP_ID, m.deps, tag);

      expect(m.insertValues).toHaveBeenCalledTimes(1);
      expect(m.insertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          steamAppId: STEAM_APP_ID,
          steamAppIdSource: tag,
        }),
      );
    },
  );

  it('keeps the tag on the suffixed-slug retry row', async () => {
    const m = buildMockDb();
    m.insertReturning
      .mockResolvedValueOnce([]) // first insert conflicts
      .mockResolvedValueOnce([{ id: 43 }]); // suffixed row lands

    await discoverGameViaItad(STEAM_APP_ID, m.deps, 'itad');

    expect(m.insertValues).toHaveBeenCalledTimes(2);
    expect(m.insertValues).toHaveBeenLastCalledWith(
      expect.objectContaining({
        slug: `elden-ring-${STEAM_APP_ID}`,
        steamAppIdSource: 'itad',
      }),
    );
  });

  it.each(['steam', 'itad'] as const)(
    'writes the tag with steamAppId when merging into an existing row (%s)',
    async (tag) => {
      const m = buildMockDb();
      m.findFirst
        .mockResolvedValueOnce(undefined) // isBannedBySlug
        .mockResolvedValueOnce({ id: 99, steamAppId: null }); // slug match

      const result = await discoverGameViaItad(STEAM_APP_ID, m.deps, tag);

      expect(result?.gameId).toBe(99);
      expect(m.updateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          steamAppId: STEAM_APP_ID,
          steamAppIdSource: tag,
        }),
      );
    },
  );
});
