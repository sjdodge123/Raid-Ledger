/**
 * ROK-1822 r4 — a server-born spawn enrols each player with the owner id of
 * the character line that named them, so a restart rehydrates it.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import { spawnOrFindServerQuickPlay } from './ad-hoc-server-spawn.helpers';
import { upsertSteamParticipant } from './ad-hoc-steam-participant.helpers';

jest.mock('./ad-hoc-game-spawn-lock', () => ({
  withGameSpawnLock: jest.fn(
    (db: unknown, _gameId: number, fn: (tx: unknown) => unknown) => fn(db),
  ),
}));
jest.mock('./ad-hoc-event.helpers', () => ({
  createAdHocEventRow: jest.fn(() => Promise.resolve(55)),
  findAdminFallback: jest.fn(),
}));
jest.mock('./ad-hoc-server-presence.helpers', () => ({
  findLiveGameAdHocEvent: jest.fn(() => Promise.resolve(null)),
  resolveSteamIdentity: jest.fn(),
}));
jest.mock('./ad-hoc-steam-participant.helpers', () => ({
  upsertSteamParticipant: jest.fn(() => Promise.resolve('inserted')),
}));
jest.mock('./ad-hoc-server-signup.helpers', () => ({
  signupLinkedServerPlayer: jest.fn(() => Promise.resolve()),
}));

const db = {} as PostgresJsDatabase<typeof schema>;

describe('spawnOrFindServerQuickPlay — character owner (ROK-1822 r4)', () => {
  it('persists each enrolled player with their character owner id', async () => {
    const result = await spawnOrFindServerQuickPlay(db, {
      gameId: 42,
      pelicanServerId: 7,
      bindingId: null,
      creatorId: 1,
      players: [
        { steamId: 'S1', displayName: 'Bjorn', characterOwnerId: '222' },
        { steamId: 'S2', displayName: 'S2' },
      ],
      ids: [{ userId: 9, discordId: 'd-9', displayName: 'Roknua' }, null],
    });
    expect(result).toEqual({ kind: 'created', eventId: 55, joined: [9, null] });
    expect(jest.mocked(upsertSteamParticipant).mock.calls).toEqual([
      [db, 55, { steamId: 'S1', displayName: 'Bjorn', userId: 9, pelicanServerId: 7, characterOwnerId: '222' }],
      [db, 55, { steamId: 'S2', displayName: 'S2', userId: null, pelicanServerId: 7 }],
    ]);
  });
});
