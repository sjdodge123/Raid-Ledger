/**
 * ROK-1499 — hydrating the room recap from the DB.
 *
 * The arithmetic is layer 1's and already pinned. What can only break HERE is
 * the reading: an activity predicate that drops the game somebody launched
 * before they joined voice, or a name mapping that loses an unmapped title.
 * Both produce a recap that is confidently wrong rather than obviously broken,
 * so the predicate is asserted as rendered SQL.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import {
  hydrateRoomRecap,
  loadRoomActivities,
} from './channel-presence-room-recap.hydrate';
import type { PresenceRow } from './channel-presence-store.helpers';

interface Op {
  kind: 'select';
  table?: unknown;
  joins: unknown[];
  where?: SQL;
}

function buildMockDb() {
  const ops: Op[] = [];
  const results: unknown[][] = [];
  let cur: Op | null = null;
  const chain: Record<string, unknown> = {
    select: jest.fn(() => {
      cur = { kind: 'select', joins: [] };
      ops.push(cur);
      return chain;
    }),
    from: jest.fn((t: unknown) => {
      cur!.table = t;
      return chain;
    }),
    innerJoin: jest.fn((t: unknown) => {
      cur!.joins.push(t);
      return chain;
    }),
    leftJoin: jest.fn((t: unknown) => {
      cur!.joins.push(t);
      return chain;
    }),
    where: jest.fn((w: SQL) => {
      cur!.where = w;
      return chain;
    }),
    orderBy: jest.fn(() => chain),
    then: (resolve: (rows: unknown[]) => void): void => {
      resolve(results.shift() ?? []);
    },
  };
  return {
    db: chain as unknown as PostgresJsDatabase<typeof schema>,
    ops,
    queue: (rows: unknown[]): void => {
      results.push(rows);
    },
  };
}

function render(clause: SQL | undefined): string {
  if (!clause) throw new Error('statement recorded no where() clause');
  return new PgDialect().sqlToQuery(clause).sql;
}

const OPENED = new Date('2026-09-13T17:00:00Z');
const ENDED = new Date('2026-09-13T20:00:00Z');

const row = { id: 'row-1', openedAt: OPENED } as PresenceRow;

const stay = (over: Record<string, unknown> = {}) => ({
  discordUserId: 'u1',
  displayName: 'Ada',
  gameId: null,
  activityName: null,
  joinedAt: OPENED,
  leftAt: null,
  ...over,
});

describe('loadRoomActivities', () => {
  it('asks only for the sessions of the people who were in the room', async () => {
    const m = buildMockDb();
    m.queue([]);

    await loadRoomActivities(m.db, ['u1', 'u2'], {
      openedAt: OPENED,
      endedAt: ENDED,
    });

    expect(render(m.ops[0].where)).toContain('"discord_id" in ($1, $2)');
  });

  it('matches sessions that OVERLAP the span, not ones that start inside it', async () => {
    const m = buildMockDb();
    m.queue([]);

    await loadRoomActivities(m.db, ['u1'], {
      openedAt: OPENED,
      endedAt: ENDED,
    });

    const sql = render(m.ops[0].where);
    // The normal case is "launch the game, THEN join voice": a
    // `started_at >= opened_at` predicate drops exactly that session.
    expect(sql).toContain('"started_at" < $3');
    expect(sql).toContain('"ended_at" is null or');
    expect(sql).toContain('"ended_at" > $4');
  });

  it('will not count a session that started more than a day before the span', async () => {
    const m = buildMockDb();
    m.queue([]);

    await loadRoomActivities(m.db, ['u1'], {
      openedAt: OPENED,
      endedAt: ENDED,
    });

    // An orphaned `ended_at IS NULL` row is "still running" forever; without a
    // floor it inflates its game across the whole span on every recap.
    const q = new PgDialect().sqlToQuery(m.ops[0].where!);
    expect(q.sql).toContain('"started_at" >= $2');
    expect(q.params[1]).toEqual(
      new Date(OPENED.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    );
  });
});

describe('loadRoomActivities — naming', () => {
  it('prefers the mapped game name and falls back to the raw activity name', async () => {
    const m = buildMockDb();
    m.queue([
      {
        discordUserId: 'u1',
        gameName: 'Path of Exile 2',
        activityName: 'PathOfExileSteam',
        startedAt: OPENED,
        endedAt: null,
      },
      {
        discordUserId: 'u2',
        gameName: null,
        activityName: 'Slay the Spire II',
        startedAt: OPENED,
        endedAt: ENDED,
      },
    ]);

    const segments = await loadRoomActivities(m.db, ['u1', 'u2'], {
      openedAt: OPENED,
      endedAt: ENDED,
    });

    expect(segments.map((s) => s.name)).toEqual([
      'Path of Exile 2',
      // No games row, so the title survives only via the Discord name.
      'Slay the Spire II',
    ]);
  });

  it('reads nothing when nobody was in the room', async () => {
    const m = buildMockDb();

    expect(
      await loadRoomActivities(m.db, [], { openedAt: OPENED, endedAt: ENDED }),
    ).toEqual([]);
    expect(m.ops).toHaveLength(0);
  });
});

describe('an occupant the session table never saw still gets their game (P2-2)', () => {
  const playing = (over: Record<string, unknown> = {}) =>
    stay({ gameId: 7, activityName: 'Deep Rock Galactic', ...over });

  it('falls back to the stay when the user has no session row', async () => {
    // Unlinked users and `/playing` overrides produce no
    // `game_activity_sessions` row at all, so their game showed on the live
    // embed all evening and then vanished from the recap.
    const m = buildMockDb();
    m.queue([playing({ leftAt: ENDED })]);
    m.queue([]);
    m.queue([{ id: 7, name: 'Deep Rock Galactic' }]);

    const recap = await hydrateRoomRecap(m.db, row, ENDED);

    expect(recap.activities).toEqual([
      { name: 'Deep Rock Galactic', seconds: 3 * 60 * 60 },
    ]);
  });

  it('prefers the tracked session when the user has one', async () => {
    // The session has real start/stop instants; the stay can only say "for as
    // long as they were in the room".
    const m = buildMockDb();
    m.queue([playing()]);
    m.queue([
      {
        discordUserId: 'u1',
        gameName: 'Deep Rock Galactic',
        activityName: 'drg',
        startedAt: new Date('2026-09-13T19:00:00Z'),
        endedAt: ENDED,
      },
    ]);

    const recap = await hydrateRoomRecap(m.db, row, ENDED);

    expect(recap.activities).toEqual([
      { name: 'Deep Rock Galactic', seconds: 60 * 60 },
    ]);
    // No games read: nothing needed a fallback name.
    expect(m.ops).toHaveLength(2);
  });

  // ROK-1608: the prod member's only session row was a Baldur's Gate 3 one the
  // bot never closed, left open since that afternoon. Layer 1 refuses to count
  // it, so layer 2 must not treat them as "covered" by it either — otherwise
  // the game the room actually read off them disappears too.
  it('falls back to the stay when the only session row is a leaked open one', async () => {
    const m = buildMockDb();
    m.queue([playing({ leftAt: ENDED })]);
    m.queue([
      {
        discordUserId: 'u1',
        gameName: "Baldur's Gate 3",
        activityName: 'bg3',
        startedAt: new Date(OPENED.getTime() - 20 * 3_600_000),
        endedAt: null,
      },
    ]);
    m.queue([{ id: 7, name: 'Deep Rock Galactic' }]);

    const recap = await hydrateRoomRecap(m.db, row, ENDED);

    expect(recap.activities).toEqual([
      { name: 'Deep Rock Galactic', seconds: 3 * 60 * 60 },
    ]);
  });

  it('uses the stored name when the games row has since been deleted', async () => {
    const m = buildMockDb();
    m.queue([playing({ gameId: null, activityName: 'Slay the Spire II' })]);
    m.queue([]);

    const recap = await hydrateRoomRecap(m.db, row, ENDED);

    expect(recap.activities).toEqual([
      { name: 'Slay the Spire II', seconds: 3 * 60 * 60 },
    ]);
  });

  it('invents nothing for a stay with no detected game', async () => {
    const m = buildMockDb();
    m.queue([stay()]);
    m.queue([]);

    const recap = await hydrateRoomRecap(m.db, row, ENDED);

    expect(recap.activities).toEqual([]);
  });
});

describe('hydrateRoomRecap', () => {
  it('summarises the stays and the sessions it read', async () => {
    const m = buildMockDb();
    m.queue([stay()]);
    m.queue([
      {
        discordUserId: 'u1',
        gameName: 'Path of Exile 2',
        activityName: 'poe2',
        // Launched an hour BEFORE the room opened and never closed.
        startedAt: new Date('2026-09-13T16:00:00Z'),
        endedAt: null,
      },
    ]);

    const recap = await hydrateRoomRecap(m.db, row, ENDED);

    expect(recap.spanMs).toBe(3 * 60 * 60 * 1000);
    expect(recap.members).toEqual([{ displayName: 'Ada', seconds: 10800 }]);
    expect(recap.activities).toEqual([
      { name: 'Path of Exile 2', seconds: 10800 },
    ]);
  });

  it('de-duplicates re-joins before asking for their sessions', async () => {
    const m = buildMockDb();
    m.queue([
      stay({ leftAt: new Date('2026-09-13T18:00:00Z') }),
      stay({ joinedAt: new Date('2026-09-13T19:00:00Z') }),
    ]);
    m.queue([]);

    const recap = await hydrateRoomRecap(m.db, row, ENDED);

    // One id in the IN list even though two stays came back...
    expect(render(m.ops[1].where)).toContain('"discord_id" in ($1)');
    // ...and one member entry, with the gap excluded (1h + 1h, not 3h).
    expect(recap.members).toEqual([{ displayName: 'Ada', seconds: 7200 }]);
  });

  it('spans opened_at → the instant passed in, never "now"', async () => {
    const m = buildMockDb();
    m.queue([stay()]);
    m.queue([]);

    const recap = await hydrateRoomRecap(m.db, row, ENDED);

    // S-5: a span measured against `now` would grow every tick and re-edit the
    // recap for the whole grace window.
    expect(recap.spanMs).toBe(ENDED.getTime() - OPENED.getTime());
  });
});
