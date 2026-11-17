/**
 * ROK-2232 — a server player is keyed by any platform id, not only a SteamID.
 * A non-Steam player (XUID) is stored as an anonymous row under its own id
 * kind, never dropped and never written into `steam_id`; only a Steam player
 * resolves an RL user through `users.steam_id`.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import { createDrizzleMock } from '../../common/testing/drizzle-mock';
import {
  steamPlayer,
  type PlayerRef,
} from '../../plugins/pelican/presence/presence-events';
import { resolvePlayerIdentity } from './ad-hoc-server-presence.helpers';
import { upsertSteamParticipant } from './ad-hoc-steam-participant.helpers';

const DIGITS = '2535400000000001';
const XUID: PlayerRef = { playerId: DIGITS, idKind: 'xuid' };

function mockDb() {
  const mock = createDrizzleMock();
  return { mock, db: mock as unknown as PostgresJsDatabase<typeof schema> };
}

describe('upsertSteamParticipant — a non-Steam player (ROK-2232)', () => {
  it('stores an XUID player as an anonymous row under its own kind', async () => {
    const { mock, db } = mockDb();
    mock.returning.mockResolvedValue([{ sessionCount: 1 }]);
    const outcome = await upsertSteamParticipant(db, 278, {
      ...XUID,
      displayName: 'Freya',
      userId: null,
      pelicanServerId: 7,
    });
    expect(outcome).toBe('inserted');
    expect(mock.values).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 278,
        userId: null,
        steamId: null,
        playerId: DIGITS,
        idKind: 'xuid',
        onServer: true,
        pelicanServerId: 7,
      }),
    );
  });

  it('still writes steam_id for a Steam player', async () => {
    const { mock, db } = mockDb();
    mock.returning.mockResolvedValue([{ sessionCount: 1 }]);
    await upsertSteamParticipant(db, 278, {
      ...steamPlayer(DIGITS),
      displayName: 'Bjorn',
      userId: null,
      pelicanServerId: 7,
    });
    expect(mock.values).toHaveBeenCalledWith(
      expect.objectContaining({
        steamId: DIGITS,
        playerId: DIGITS,
        idKind: 'steam',
      }),
    );
  });
});

describe('resolvePlayerIdentity (ROK-2232)', () => {
  it('resolves a Steam player through users.steam_id', async () => {
    const { mock, db } = mockDb();
    const user = { userId: 9, discordId: 'd-9', displayName: 'Roknua' };
    mock.limit.mockResolvedValue([user]);
    await expect(
      resolvePlayerIdentity(db, steamPlayer(DIGITS)),
    ).resolves.toEqual(user);
    expect(mock.select).toHaveBeenCalledTimes(1);
  });

  it('leaves a same-digit XUID anonymous without reading users', async () => {
    const { mock, db } = mockDb();
    mock.limit.mockResolvedValue([{ userId: 9 }]);
    await expect(resolvePlayerIdentity(db, XUID)).resolves.toBeNull();
    expect(mock.select).not.toHaveBeenCalled();
  });
});
