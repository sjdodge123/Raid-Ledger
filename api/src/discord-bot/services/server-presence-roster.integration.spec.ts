/**
 * ROK-1801 layer B — `ServerPresenceRosterService` against a real database.
 *
 * What only Postgres proves: the ONE batch `users.steam_id IN (...)` lookup
 * maps server SteamIDs to linked users (id, Discord id, username), unlinked
 * SteamIDs stay anonymous-capable, and the games-row join names the group.
 */
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import type {
  ServerPresenceReader,
  ServerRosterPlayer,
} from '../../plugins/pelican/presence/server-presence.reader';
import { ServerPresenceRosterService } from './server-presence-roster.service';

const STEAM_LINKED = '76561198000000101';
const STEAM_UNLINKED = '76561198000000102';
const STEAM_UNNAMED = '76561198000000103';

let testApp: TestApp;

function readerOf(players: ServerRosterPlayer[]): ServerPresenceReader {
  return {
    playersOnGames: () => players,
    playersForGame: (gameId) => players.filter((p) => p.gameId === gameId),
  };
}

async function insertLinkedUser(): Promise<number> {
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: 'rok1801-discord-linked',
        steamId: STEAM_LINKED,
        username: 'Pariah',
        role: 'member',
      })
      .returning(),
    'linked user',
  );
  return user.id;
}

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('ServerPresenceRosterService.snapshot (real DB)', () => {
  it('maps linked, unlinked and unnamed players and dedupes one person across two servers', async () => {
    const userId = await insertLinkedUser();
    const gameId = testApp.seed.game.id;
    const on = (
      pelicanServerId: number,
      steamId: string,
      name: string | null,
    ) => ({
      pelicanServerId,
      gameId,
      steamId,
      name,
    });
    const service = new ServerPresenceRosterService(
      testApp.db,
      readerOf([
        on(1, STEAM_LINKED, 'PariahChar'),
        on(2, STEAM_LINKED, 'PariahChar'),
        on(1, STEAM_UNLINKED, 'Kveldulf'),
        on(1, STEAM_UNNAMED, null),
      ]),
    );

    const roster = await service.snapshot();

    expect(roster.gameNames.get(gameId)).toBe(testApp.seed.game.name);
    expect(roster.byGame.get(gameId)).toEqual([
      {
        key: `user:${userId}`,
        steamId: STEAM_LINKED,
        userId,
        discordUserId: 'rok1801-discord-linked',
        name: 'Pariah',
      },
      {
        key: `steam:${STEAM_UNLINKED}`,
        steamId: STEAM_UNLINKED,
        userId: null,
        discordUserId: null,
        name: 'Kveldulf',
      },
      {
        key: `steam:${STEAM_UNNAMED}`,
        steamId: STEAM_UNNAMED,
        userId: null,
        discordUserId: null,
        name: null,
      },
    ]);
  });

  it('drops players whose game has no games row', async () => {
    const service = new ServerPresenceRosterService(
      testApp.db,
      readerOf([
        {
          pelicanServerId: 1,
          gameId: 987_654,
          steamId: STEAM_UNLINKED,
          name: 'X',
        },
      ]),
    );
    expect((await service.snapshot()).byGame.size).toBe(0);
  });

  it('returns an empty roster when no reader is bound (plugin off)', async () => {
    const roster = await new ServerPresenceRosterService(
      testApp.db,
      null,
    ).snapshot();
    expect(roster.byGame.size).toBe(0);
    expect(roster.gameNames.size).toBe(0);
  });
});
