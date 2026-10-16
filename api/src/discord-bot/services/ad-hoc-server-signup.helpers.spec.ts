/**
 * ROK-1802 item 3 — a linked game-server player is signed up to the Quick
 * Play (at spawn and on attach); an unlinked one is not.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import { autoSignupParticipant } from './ad-hoc-event.signup-helpers';
import { createAdHocEventRow } from './ad-hoc-event.helpers';
import { findLiveGameAdHocEvent } from './ad-hoc-server-presence.helpers';
import { signupLinkedServerPlayer } from './ad-hoc-server-signup.helpers';
import { spawnOrFindServerQuickPlay } from './ad-hoc-server-spawn.helpers';
import { upsertSteamParticipant } from './ad-hoc-steam-participant.helpers';

type Db = PostgresJsDatabase<typeof schema>;

jest.mock('./ad-hoc-event.signup-helpers', () => ({
  autoSignupParticipant: jest.fn(),
}));
jest.mock('./ad-hoc-event.helpers', () => ({
  createAdHocEventRow: jest.fn(),
  findAdminFallback: jest.fn(),
}));
/** The handle the spawn lock hands its callback — distinct from `db`. */
const mockLock: { tx: unknown } = { tx: null };
jest.mock('./ad-hoc-game-spawn-lock', () => ({
  withGameSpawnLock: (_db: unknown, _g: number, fn: (tx: unknown) => unknown) =>
    fn(mockLock.tx),
}));
jest.mock('./ad-hoc-server-presence.helpers', () => ({
  findLiveGameAdHocEvent: jest.fn(),
  resolveSteamIdentity: jest.fn(),
}));
jest.mock('./ad-hoc-steam-participant.helpers', () => ({
  upsertSteamParticipant: jest.fn(),
}));

/** A db whose one `select…limit` resolves to `rows`. */
function dbReturning(rows: object[]): Db {
  const limit = () => Promise.resolve(rows);
  const where = () => ({ limit });
  const from = () => ({ where });
  return { select: () => ({ from }) } as unknown as Db;
}

afterEach(() => jest.resetAllMocks());

describe('signupLinkedServerPlayer', () => {
  it('signs a linked user up under their Discord identity', async () => {
    const db = dbReturning([
      { discordId: 'd-1', username: 'Bjorn', avatar: 'h1' },
    ]);
    await signupLinkedServerPlayer(db, 5, 42);
    expect(autoSignupParticipant).toHaveBeenCalledWith(db, 5, {
      discordUserId: 'd-1',
      discordUsername: 'Bjorn',
      discordAvatarHash: 'h1',
      userId: 42,
    });
  });

  it('an unlinked player (no user) gets no signup', async () => {
    await signupLinkedServerPlayer(dbReturning([]), 5, null);
    expect(autoSignupParticipant).not.toHaveBeenCalled();
  });

  it('a user with no Discord id, or a deactivated one (no row), gets no signup', async () => {
    const noDiscord = { discordId: null, username: 'x', avatar: null };
    await signupLinkedServerPlayer(dbReturning([noDiscord]), 5, 42);
    await signupLinkedServerPlayer(dbReturning([]), 5, 43);
    expect(autoSignupParticipant).not.toHaveBeenCalled();
  });
});

describe('spawnOrFindServerQuickPlay — signups at spawn', () => {
  it('signs up each linked player on the spawn transaction, skipping the unlinked', async () => {
    jest.mocked(findLiveGameAdHocEvent).mockResolvedValue(null);
    jest.mocked(createAdHocEventRow).mockResolvedValue(77);
    jest.mocked(upsertSteamParticipant).mockResolvedValue('inserted');
    const tx = dbReturning([
      { discordId: 'd-42', username: 'Linked', avatar: null },
    ]);
    mockLock.tx = tx;
    await spawnOrFindServerQuickPlay(dbReturning([]), {
      gameId: 1,
      pelicanServerId: 2,
      bindingId: null,
      creatorId: 42,
      players: [
        { steamId: 's-linked', displayName: 'Linked' },
        { steamId: 's-unlinked', displayName: 'Stranger' },
      ],
      ids: [{ userId: 42, discordId: 'd-42', displayName: 'Roknua' }, null],
    });
    expect(autoSignupParticipant).toHaveBeenCalledTimes(1);
    expect(autoSignupParticipant).toHaveBeenCalledWith(
      tx,
      77,
      expect.objectContaining({ userId: 42, discordUserId: 'd-42' }),
    );
  });
});
