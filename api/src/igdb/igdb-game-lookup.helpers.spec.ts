/**
 * ROK-1680: a by-steam-id lookup that falls through to ITAD discovery tags
 * the Steam app id it writes as ITAD-sourced — the id came from ITAD's
 * resolution of a user-supplied number, not from a Steam API response.
 */
import * as discovery from '../steam/steam-itad-discovery.helpers';
import { resolveGameBySteamAppId } from './igdb-game-lookup.helpers';
import { createDrizzleMock } from '../common/testing/drizzle-mock';

describe('resolveGameBySteamAppId — steamAppIdSource (ROK-1680)', () => {
  let spy: jest.SpyInstance;

  beforeEach(() => {
    spy = jest.spyOn(discovery, 'discoverGameViaItad').mockResolvedValue(null);
  });

  afterEach(() => spy.mockRestore());

  it("passes 'itad' when the game is not in the DB yet", async () => {
    const db = createDrizzleMock();
    db.limit.mockResolvedValue([]); // no local row → discovery runs

    const result = await resolveGameBySteamAppId(570, {
      db: db as never,
      lookupBySteamAppId: jest.fn(),
      adultFilterEnabled: false,
    });

    expect(result).toBeNull();
    expect(spy).toHaveBeenCalledWith(
      570,
      expect.objectContaining({ queryIgdb: undefined }),
      'itad',
    );
  });
});
