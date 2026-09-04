/**
 * ROK-1446 D4 — room truth for the channel-level presence embed.
 *
 * Every case here pins a rule that a plausible implementation gets wrong:
 * bots leaking in through a direct `channel.members` read (AC3), a truthiness
 * guard stripping the null-game group of its event (`IS NOT DISTINCT FROM`),
 * a roster rebuilt from the DB alone (losing whoever is in voice but not yet a
 * participant row), and an override that short-circuits more than the Discord
 * read it is supposed to stand in for (D12).
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { ResolvedBinding } from '../listeners/voice-state.helpers';
import type { EmbedEventData } from './discord-embed.factory';
import { buildEmbedEventData } from './ad-hoc-notification.helpers';
import {
  findLinkedEvents,
  matchLinkedEvent,
  recapEvents,
  resolveRoom,
  type RoomResolveDeps,
  type RoomSnapshot,
} from './channel-presence-room.helpers';

jest.mock('./ad-hoc-notification.helpers', () => ({
  buildEmbedEventData: jest.fn(),
}));

const mockBuildEmbedEventData = buildEmbedEventData as jest.MockedFunction<
  typeof buildEmbedEventData
>;

/** Marker returned by the mocked embed builder — identity is the assertion. */
const EVENT_DATA = { id: 999, title: 'marker' } as unknown as EmbedEventData;

type TableRef = object;

/**
 * Chain mock whose queries all terminate at `.where()`, keyed by the table the
 * preceding `.from()` named — so one mock serves the events, participants and
 * games reads without depending on call order.
 */
function buildMockDb() {
  const queues = new Map<TableRef, unknown[][]>();
  const whereCalls: Array<{ table: TableRef | null; where: unknown }> = [];
  let current: TableRef | null = null;

  interface ChainMock {
    select: jest.Mock;
    from: jest.Mock;
    where: jest.Mock;
  }

  const chain: ChainMock = {
    select: jest.fn((): ChainMock => chain),
    from: jest.fn((table: TableRef): ChainMock => {
      current = table;
      return chain;
    }),
    where: jest.fn((clause: unknown): Promise<unknown[]> => {
      whereCalls.push({ table: current, where: clause });
      return Promise.resolve(queues.get(current as TableRef)?.shift() ?? []);
    }),
  };

  return {
    db: chain as unknown as PostgresJsDatabase<typeof schema>,
    chain,
    queue(table: TableRef, rows: unknown[]): void {
      const queue = queues.get(table) ?? [];
      queue.push(rows);
      queues.set(table, queue);
    },
    whereFor(table: TableRef): SQL {
      const hit = whereCalls.find((c) => c.table === table);
      if (!hit) throw new Error('no where() clause recorded for that table');
      return hit.where as SQL;
    },
    readsOf(table: TableRef): number {
      return whereCalls.filter((c) => c.table === table).length;
    },
  };
}

function member(id: string, displayName: string, bot = false) {
  return { id, displayName, user: { bot } };
}

function fakeChannel(name: string, members: ReturnType<typeof member>[]) {
  return {
    name,
    isVoiceBased: () => true,
    members: new Map(members.map((m) => [m.id, m])),
  };
}

function fakeClientService(channelId: string, channel: unknown) {
  return {
    getGuildId: () => 'guild-1',
    getClient: () => ({
      guilds: {
        cache: new Map([
          ['guild-1', { channels: { cache: new Map([[channelId, channel]]) } }],
        ]),
      },
    }),
  };
}

function lobbyBinding(config: ResolvedBinding['config']): ResolvedBinding {
  return {
    bindingId: 'bind-1',
    gameId: null,
    gameName: null,
    bindingPurpose: 'general-lobby',
    recurrenceGroupId: null,
    config,
  };
}

interface Harness {
  deps: RoomResolveDeps;
  db: ReturnType<typeof buildMockDb>;
  detectGames: jest.Mock;
}

function harness(members: ReturnType<typeof member>[]): Harness {
  const db = buildMockDb();
  const detectGames = jest.fn().mockResolvedValue([]);
  const channel = fakeChannel('general', members);
  return {
    db,
    detectGames,
    deps: {
      db: db.db,
      channelBindingsService: {} as RoomResolveDeps['channelBindingsService'],
      channelResolver: {} as RoomResolveDeps['channelResolver'],
      settingsService: {} as RoomResolveDeps['settingsService'],
      clientService: fakeClientService(
        'vc-1',
        channel,
      ) as unknown as RoomResolveDeps['clientService'],
      presenceDetector: {
        detectGames,
      } as unknown as RoomResolveDeps['presenceDetector'],
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockBuildEmbedEventData.mockResolvedValue(EVENT_DATA);
});

describe('resolveRoom — membership (AC3)', () => {
  it('never lets a bot reach detection, a roster or the occupancy count', async () => {
    const h = harness([
      member('u1', 'Ana'),
      member('u2', 'Ben'),
      member('bot-1', 'RaidLedger', true),
    ]);
    h.detectGames.mockResolvedValue([
      { gameId: 5, gameName: 'Valheim', memberIds: ['u1', 'u2'] },
    ]);
    h.db.queue(schema.events, []);

    const room = await resolveRoom(
      h.deps,
      'vc-1',
      lobbyBinding({ minPlayers: 2 }),
    );

    expect(room.memberCount).toBe(2);
    const detected = h.detectGames.mock.calls[0][0] as Array<{ id: string }>;
    expect(detected.map((m) => m.id)).toEqual(['u1', 'u2']);
    expect(room.groups.flatMap((g) => g.memberIds)).toEqual(['u1', 'u2']);
    expect(room.groups.flatMap((g) => g.memberNames)).toEqual(['Ana', 'Ben']);
    expect(room.channelName).toBe('general');
  });
});

describe('resolveRoom — threshold partition', () => {
  it('qualifies a group AT minPlayers and drops one below it', async () => {
    const h = harness([
      member('u1', 'Ana'),
      member('u2', 'Ben'),
      member('u3', 'Cara'),
    ]);
    h.detectGames.mockResolvedValue([
      { gameId: 5, gameName: 'Valheim', memberIds: ['u1', 'u2'] },
      { gameId: 9, gameName: 'CoD4', memberIds: ['u3'] },
    ]);
    h.db.queue(schema.events, []);

    const room = await resolveRoom(
      h.deps,
      'vc-1',
      lobbyBinding({ minPlayers: 2 }),
    );

    expect(room.groups.map((g) => [g.gameName, g.qualifying])).toEqual([
      ['Valheim', true],
      ['CoD4', false],
    ]);
    expect(room.minPlayers).toBe(2);
  });
});

describe('resolveRoom — linked events (IS NOT DISTINCT FROM)', () => {
  it('matches a null-game group to the null game_id row and never cross-links', async () => {
    const h = harness([
      member('u1', 'Ana'),
      member('u2', 'Ben'),
      member('u3', 'Cara'),
      member('u4', 'Dev'),
    ]);
    h.detectGames.mockResolvedValue([
      { gameId: 5, gameName: 'Valheim', memberIds: ['u1', 'u2'] },
      {
        gameId: null,
        gameName: 'Untitled Gaming Session',
        memberIds: ['u3', 'u4'],
      },
    ]);
    h.db.queue(schema.events, [
      { id: 77, gameId: null, adHocStatus: 'grace_period' },
      { id: 88, gameId: 5, adHocStatus: 'live' },
    ]);
    h.db.queue(schema.adHocParticipants, []);
    h.db.queue(schema.adHocParticipants, []);

    const room = await resolveRoom(
      h.deps,
      'vc-1',
      lobbyBinding({ minPlayers: 2, allowJustChatting: true }),
    );

    expect(
      Object.fromEntries(room.groups.map((g) => [g.gameName, g.eventId])),
    ).toEqual({ Valheim: 88, 'Just Chatting': 77 });
    expect(room.undetectedNames).toEqual([]);
  });

  it('leaves a group with no matching event unevented', async () => {
    const h = harness([member('u1', 'Ana'), member('u2', 'Ben')]);
    h.detectGames.mockResolvedValue([
      { gameId: 5, gameName: 'Valheim', memberIds: ['u1', 'u2'] },
    ]);
    h.db.queue(schema.events, [{ id: 77, gameId: 9, adHocStatus: 'live' }]);

    const room = await resolveRoom(
      h.deps,
      'vc-1',
      lobbyBinding({ minPlayers: 2 }),
    );

    expect(
      room.groups.map((g) => [g.gameName, g.eventId, g.eventData]),
    ).toEqual([['Valheim', null, null]]);
  });
});

describe('resolveRoom — vanished event row', () => {
  it('drops the event id when the event row no longer builds', async () => {
    const h = harness([member('u1', 'Ana'), member('u2', 'Ben')]);
    h.detectGames.mockResolvedValue([
      { gameId: 5, gameName: 'Valheim', memberIds: ['u1', 'u2'] },
    ]);
    h.db.queue(schema.events, [{ id: 88, gameId: 5, adHocStatus: 'live' }]);
    h.db.queue(schema.adHocParticipants, []);
    mockBuildEmbedEventData.mockResolvedValue(null);

    const room = await resolveRoom(
      h.deps,
      'vc-1',
      lobbyBinding({ minPlayers: 2 }),
    );

    expect(room.groups.map((g) => [g.eventId, g.eventData])).toEqual([
      [null, null],
    ]);
  });
});

describe('matchLinkedEvent', () => {
  const events = [
    { id: 1, gameId: null, adHocStatus: 'live' },
    { id: 2, gameId: 7, adHocStatus: 'live' },
  ];

  it('matches null to null, id to id, and returns null with no match', () => {
    expect(matchLinkedEvent(events, null)?.id ?? 'none').toBe(1);
    expect(matchLinkedEvent(events, 7)?.id ?? 'none').toBe(2);
    expect(matchLinkedEvent(events, 42)).toBeNull();
  });
});

describe('resolveRoom — participant union', () => {
  it('unions the stored roster (leavers inactive) with live members not on it', async () => {
    const h = harness([
      member('u1', 'Ana'),
      member('u2', 'Ben'),
      member('u3', 'Cara'),
    ]);
    h.detectGames.mockResolvedValue([
      { gameId: 5, gameName: 'Valheim', memberIds: ['u1', 'u2', 'u3'] },
    ]);
    h.db.queue(schema.events, [{ id: 88, gameId: 5, adHocStatus: 'live' }]);
    h.db.queue(schema.adHocParticipants, [
      { discordUserId: 'u1', discordUsername: 'Ana', leftAt: null },
      {
        discordUserId: 'u9',
        discordUsername: 'Zoe',
        leftAt: new Date('2026-09-04T10:00:00Z'),
      },
    ]);

    const room = await resolveRoom(
      h.deps,
      'vc-1',
      lobbyBinding({ minPlayers: 2 }),
    );

    expect(mockBuildEmbedEventData.mock.calls[0][1]).toBe(88);
    expect(mockBuildEmbedEventData.mock.calls[0][2]).toEqual([
      { discordUserId: 'u1', discordUsername: 'Ana', isActive: true },
      { discordUserId: 'u9', discordUsername: 'Zoe', isActive: false },
      { discordUserId: 'u2', discordUsername: 'Ben', isActive: true },
      { discordUserId: 'u3', discordUsername: 'Cara', isActive: true },
    ]);
    expect(room.groups[0].eventData).toBe(EVENT_DATA);
  });
});

describe('resolveRoom — group order (D2)', () => {
  it('puts evented groups first, then unevented by size desc then name asc', async () => {
    const big = harness([
      member('a1', 'A1'),
      member('a2', 'A2'),
      member('a3', 'A3'),
      member('b1', 'B1'),
      member('b2', 'B2'),
      member('b3', 'B3'),
      member('c1', 'C1'),
      member('c2', 'C2'),
      member('z1', 'Z1'),
    ]);
    big.detectGames.mockResolvedValue([
      { gameId: 1, gameName: 'Zelda', memberIds: ['z1'] },
      { gameId: 2, gameName: 'Alpha', memberIds: ['a1', 'a2', 'a3'] },
      { gameId: 3, gameName: 'Bravo', memberIds: ['b1', 'b2', 'b3'] },
      { gameId: 4, gameName: 'Charlie', memberIds: ['c1', 'c2'] },
    ]);
    big.db.queue(schema.events, [{ id: 9, gameId: 1, adHocStatus: 'live' }]);
    big.db.queue(schema.adHocParticipants, []);

    const room = await resolveRoom(
      big.deps,
      'vc-1',
      lobbyBinding({ minPlayers: 2 }),
    );

    expect(room.groups.map((g) => g.gameName)).toEqual([
      'Zelda',
      'Alpha',
      'Bravo',
      'Charlie',
    ]);
  });
});

describe('resolveRoom — DEMO_MODE override (D12)', () => {
  const snapshot: RoomSnapshot = {
    members: [
      { discordUserId: 'u1', displayName: 'Ana', gameId: 5 },
      { discordUserId: 'u2', displayName: 'Ben', gameId: 5 },
      { discordUserId: 'u3', displayName: 'Cara', gameId: null },
    ],
  };

  it('replaces only the Discord read — partition and event lookup still run', async () => {
    const h = harness([member('u9', 'Zed')]);
    h.db.queue(schema.games, [{ id: 5, name: 'Valheim' }]);
    h.db.queue(schema.events, [{ id: 88, gameId: 5, adHocStatus: 'live' }]);
    h.db.queue(schema.adHocParticipants, []);

    const room = await resolveRoom(
      h.deps,
      'vc-1',
      lobbyBinding({ minPlayers: 2 }),
      snapshot,
    );

    expect(h.detectGames).not.toHaveBeenCalled();
    expect(room.memberCount).toBe(3);
    expect(
      room.groups.map((g) => [g.gameName, g.qualifying, g.eventId]),
    ).toEqual([['Valheim', true, 88]]);
    expect(room.undetectedNames).toEqual(['Cara']);
    expect(h.db.readsOf(schema.events)).toBe(1);
  });

  it('applies the threshold to an override group like any other', async () => {
    const h = harness([]);
    h.db.queue(schema.games, [{ id: 5, name: 'Valheim' }]);
    h.db.queue(schema.events, []);

    const room = await resolveRoom(
      h.deps,
      'vc-1',
      lobbyBinding({ minPlayers: 3 }),
      snapshot,
    );

    expect(room.groups.map((g) => [g.gameName, g.qualifying])).toEqual([
      ['Valheim', false],
    ]);
  });
});

describe('resolveRoom — DEMO_MODE override event hints (D12)', () => {
  it('falls back to a member-declared eventId when no real event matches', async () => {
    const h = harness([]);
    h.db.queue(schema.games, [{ id: 5, name: 'Valheim' }]);
    h.db.queue(schema.events, []);
    h.db.queue(schema.adHocParticipants, []);

    const room = await resolveRoom(
      h.deps,
      'vc-1',
      lobbyBinding({ minPlayers: 2 }),
      {
        members: [
          { discordUserId: 'u1', displayName: 'Ana', gameId: 5, eventId: 42 },
          { discordUserId: 'u2', displayName: 'Ben', gameId: 5, eventId: 42 },
        ],
      },
    );

    expect(room.groups.map((g) => g.eventId)).toEqual([42]);
    expect(mockBuildEmbedEventData.mock.calls[0][1]).toBe(42);
  });

  it('prefers the real linked event over a member-declared eventId', async () => {
    const h = harness([]);
    h.db.queue(schema.games, [{ id: 5, name: 'Valheim' }]);
    h.db.queue(schema.events, [{ id: 88, gameId: 5, adHocStatus: 'live' }]);
    h.db.queue(schema.adHocParticipants, []);

    const room = await resolveRoom(
      h.deps,
      'vc-1',
      lobbyBinding({ minPlayers: 2 }),
      {
        members: [
          { discordUserId: 'u1', displayName: 'Ana', gameId: 5, eventId: 42 },
          { discordUserId: 'u2', displayName: 'Ben', gameId: 5, eventId: 42 },
        ],
      },
    );

    expect(room.groups.map((g) => g.eventId)).toEqual([88]);
  });
});

describe('findLinkedEvents / recapEvents predicates', () => {
  it('scopes linked events to live+grace, uncancelled ad-hoc rows for the binding', async () => {
    const m = buildMockDb();
    m.queue(schema.events, []);

    await findLinkedEvents(m.db, 'bind-1');
    const { sql: text, params } = new PgDialect().sqlToQuery(
      m.whereFor(schema.events),
    );

    expect(text).toContain('"events"."is_ad_hoc" =');
    expect(text).toContain('"events"."channel_binding_id" =');
    expect(text).toContain('"events"."ad_hoc_status" in (');
    expect(text).toContain('"events"."cancelled_at" is null');
    expect(params).toEqual(
      expect.arrayContaining(['bind-1', 'live', 'grace_period']),
    );
  });

  it('keeps a session that started BEFORE opened_at but was still running (P2-3)', async () => {
    const m = buildMockDb();
    m.queue(schema.events, []);
    const openedAt = new Date('2026-09-04T10:00:00.000Z');

    await recapEvents(m.db, 'bind-1', openedAt);
    const { sql: text, params } = new PgDialect().sqlToQuery(
      m.whereFor(schema.events),
    );

    // The ad-hoc row is written by the voice handler, which runs BEFORE the
    // presence drain stamps `opened_at`. A `lower(duration) >= opened_at`
    // predicate drops that session on a few seconds of skew and the recap
    // then claims none started. Membership is an OVERLAP with the window the
    // message was open for, so the session's START must not be tested at all.
    expect(text).not.toContain('lower("events"."duration")');
    expect(text).toContain('upper("events"."duration") is null');
    // `>=`, not `>`: a session ending exactly at `opened_at` stays in, which
    // is the inclusive boundary the old predicate carried.
    expect(text).toContain('upper("events"."duration") >=');
    expect(params).toEqual(
      expect.arrayContaining(['bind-1', '2026-09-04T10:00:00.000Z']),
    );
  });
});

/** A games row as `QUICK_PLAY_GAME_COLUMNS` selects it. */
function gameRow(id: number, name: string, coverUrl: string | null) {
  return { id, name, coverUrl, ...BADGES };
}

/** Badge columns with every family populated, so a dropped column is visible. */
const BADGES = {
  isFreeToPlay: true,
  itadCurrentPrice: '4.99',
  itadCurrentCut: 75,
  itadCurrentShop: 'Steam',
  itadCurrentUrl: 'https://store.example/x',
  itadLowestPrice: '3.99',
  itadPriceUpdatedAt: new Date('2026-09-04T09:00:00Z'),
  cooptimusOnlineMax: 4,
  cooptimusCouchMax: 2,
  cooptimusComboCoop: 4,
};

describe('resolveRoom — group cover art and badges (Lead ruling 1)', () => {
  it('attaches art to a SHORT group too, in one games read for the whole flush', async () => {
    const h = harness([
      member('u1', 'Ana'),
      member('u2', 'Ben'),
      member('u3', 'Cara'),
      member('u4', 'Dev'),
    ]);
    h.detectGames.mockResolvedValue([
      { gameId: 5, gameName: 'Valheim', memberIds: ['u1', 'u2'] },
      { gameId: 9, gameName: 'CoD4', memberIds: ['u3'] },
      { gameId: null, gameName: 'Untitled Gaming Session', memberIds: ['u4'] },
    ]);
    h.db.queue(schema.games, [
      gameRow(5, 'Valheim', '//img.example/vh.png'),
      gameRow(9, 'CoD4', null),
    ]);
    h.db.queue(schema.events, []);

    const room = await resolveRoom(
      h.deps,
      'vc-1',
      lobbyBinding({ minPlayers: 2, allowJustChatting: true }),
    );

    const art = Object.fromEntries(
      room.groups.map((g) => [g.gameName, g.game]),
    );
    // The SHORT group (CoD4, 1 < minPlayers 2) is the whole point: it has no
    // event to inherit `EmbedEventData.game` from, so without this it renders
    // thinner than the approved design.
    expect(art['CoD4']).toEqual({
      id: 9,
      name: 'CoD4',
      coverUrl: null,
      badges: BADGES,
    });
    expect(art['Valheim']).toEqual({
      id: 5,
      name: 'Valheim',
      coverUrl: '//img.example/vh.png',
      badges: BADGES,
    });
    expect(art['Just Chatting']).toBeNull();
    expect(h.db.readsOf(schema.games)).toBe(1);
  });

  it('reads only the games the room is actually on', async () => {
    const h = harness([member('u1', 'Ana'), member('u2', 'Ben')]);
    h.detectGames.mockResolvedValue([
      { gameId: 5, gameName: 'Valheim', memberIds: ['u1', 'u2'] },
    ]);
    h.db.queue(schema.games, [gameRow(5, 'Valheim', null)]);
    h.db.queue(schema.events, []);

    await resolveRoom(h.deps, 'vc-1', lobbyBinding({ minPlayers: 2 }));
    const { params } = new PgDialect().sqlToQuery(h.db.whereFor(schema.games));

    expect(params).toEqual([5]);
  });
});

describe('resolveRoom — art on the DEMO_MODE seam path', () => {
  it('serves the override path from the SAME games read that names the games', async () => {
    const h = harness([]);
    h.db.queue(schema.games, [gameRow(5, 'Valheim', '//img.example/vh.png')]);
    h.db.queue(schema.events, []);

    const room = await resolveRoom(
      h.deps,
      'vc-1',
      lobbyBinding({ minPlayers: 2 }),
      {
        members: [
          { discordUserId: 'u1', displayName: 'Ana', gameId: 5 },
          { discordUserId: 'u2', displayName: 'Ben', gameId: 5 },
        ],
      },
    );

    expect(room.groups[0].gameName).toBe('Valheim');
    expect(room.groups[0].game).toEqual({
      id: 5,
      name: 'Valheim',
      coverUrl: '//img.example/vh.png',
      badges: BADGES,
    });
    expect(h.db.readsOf(schema.games)).toBe(1);
  });

  it('gives a group whose games row vanished no art at all', async () => {
    const h = harness([member('u1', 'Ana'), member('u2', 'Ben')]);
    h.detectGames.mockResolvedValue([
      { gameId: 5, gameName: 'Valheim', memberIds: ['u1', 'u2'] },
    ]);
    h.db.queue(schema.games, []);
    h.db.queue(schema.events, []);

    const room = await resolveRoom(
      h.deps,
      'vc-1',
      lobbyBinding({ minPlayers: 2 }),
    );

    expect(room.groups[0].game).toBeNull();
  });
});
