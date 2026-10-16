/**
 * ROK-1801 layer C — the evented roster union's game-server markers and the
 * render order on `groupSize`.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import {
  ON_SERVER_MARK,
  SERVER_ONLY_MARK,
  eventedRoster,
  sortGroups,
  unionParticipants,
  withServerAnonymous,
} from './channel-presence-room.roster.helpers';
import type { RoomGroup } from './channel-presence-room.helpers';
import type { RoomSource } from './channel-presence-room.snapshot';
import type { ServerRosterEntry } from './server-presence-roster.helpers';

function dbReturning(rows: unknown[]): PostgresJsDatabase<typeof schema> {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => Promise.resolve(rows),
  };
  return chain as unknown as PostgresJsDatabase<typeof schema>;
}

function entry(
  name: string | null,
  steamId: string,
  discordUserId: string | null = null,
): ServerRosterEntry {
  return {
    key: discordUserId ? `user:${discordUserId}` : `steam:${steamId}`,
    steamId,
    userId: null,
    discordUserId,
    name,
  };
}

const SOURCE: RoomSource = {
  memberCount: 2,
  names: new Map([
    ['u1', 'Ana'],
    ['u2', 'Pariah'],
  ]),
  detected: [],
  art: new Map(),
  eventHints: new Map(),
};

function row(over: Record<string, unknown>) {
  return {
    discordUserId: null,
    discordUsername: 'x',
    steamId: null,
    leftAt: null,
    onServer: false,
    ...over,
  };
}

describe('unionParticipants — game-server markers (ROK-1801)', () => {
  it('marks rows and live members by server + voice state, and appends unrowed named server players', async () => {
    const db = dbReturning([
      row({ discordUserId: 'u1', discordUsername: 'Ana' }),
      row({ steamId: 'S-K', discordUsername: 'Kveldulf', onServer: true }),
      row({
        steamId: 'S-G',
        discordUsername: 'Gone',
        onServer: true,
        leftAt: new Date('2026-10-16T17:00:00Z'),
      }),
    ]);
    const participants = await unionParticipants(
      db,
      77,
      {
        memberIds: ['u1', 'u2'],
        onServerIds: ['u2'],
        serverOnly: [
          entry('Kveldulf', 'S-K'),
          entry('Bjorn', 'S-B', 'd-bjorn'),
          entry(null, 'S-ANON'),
        ],
      },
      SOURCE,
    );
    expect(participants).toEqual([
      { discordUserId: 'u1', discordUsername: 'Ana', isActive: true },
      {
        discordUserId: null,
        discordUsername: 'Kveldulf',
        isActive: true,
        rosterSuffix: SERVER_ONLY_MARK,
      },
      { discordUserId: null, discordUsername: 'Gone', isActive: false },
      {
        discordUserId: 'u2',
        discordUsername: 'Pariah',
        isActive: true,
        rosterSuffix: ON_SERVER_MARK,
      },
      {
        discordUserId: 'd-bjorn',
        discordUsername: 'Bjorn',
        isActive: true,
        rosterSuffix: SERVER_ONLY_MARK,
      },
    ]);
  });

  it('marks a stored voice row on the server with 🖥, not "on server"', async () => {
    const db = dbReturning([
      row({ discordUserId: 'u1', discordUsername: 'Ana', onServer: true }),
    ]);
    const [ana] = await unionParticipants(
      db,
      77,
      { memberIds: ['u1'] },
      SOURCE,
    );
    expect(ana?.rosterSuffix).toBe(' \u{1F5A5}');
  });
});

describe('eventedRoster — anonymous server players (ROK-1801 Q4)', () => {
  it('counts unnamed server-only players no row covers, never listing them', async () => {
    const db = dbReturning([
      row({ steamId: 'S-ROWED', discordUsername: 'Kveldulf', onServer: true }),
    ]);
    const roster = await eventedRoster(
      db,
      77,
      {
        memberIds: [],
        serverOnly: [
          entry(null, 'S-ANON-1'),
          entry(null, 'S-ANON-2'),
          entry(null, 'S-ROWED'),
          entry('Bjorn', 'S-B'),
        ],
      },
      SOURCE,
    );
    expect(roster.anonymousOnServer).toBe(2);
    expect(roster.participants.map((p) => p.discordUsername)).toEqual([
      'Kveldulf',
      'Bjorn',
    ]);
  });

  it('withServerAnonymous stamps the count only when there is one', () => {
    const data = { id: 1 } as unknown as Parameters<
      typeof withServerAnonymous
    >[0];
    expect(withServerAnonymous(data, 2)).toEqual({
      id: 1,
      serverAnonymousCount: 2,
    });
    expect(withServerAnonymous(data, 0)).toBe(data);
    expect(withServerAnonymous(null, 3)).toBeNull();
  });
});

describe('sortGroups — size is voice ∪ server (ROK-1801)', () => {
  function group(gameName: string, voice: number, server: number): RoomGroup {
    return {
      gameId: gameName.length,
      gameName,
      memberIds: Array.from(
        { length: voice },
        (_, i) => `${gameName}-${String(i)}`,
      ),
      memberNames: [],
      qualifying: false,
      eventId: null,
      eventData: null,
      game: null,
      serverOnly: Array.from({ length: server }, (_, i) =>
        entry(null, `${gameName}-s${String(i)}`),
      ),
    };
  }

  it('puts a 1-voice + 2-server group ahead of a 2-voice group', () => {
    const sorted = sortGroups([group('Alpha', 2, 0), group('Valheim', 1, 2)]);
    expect(sorted.map((g) => g.gameName)).toEqual(['Valheim', 'Alpha']);
  });
});
