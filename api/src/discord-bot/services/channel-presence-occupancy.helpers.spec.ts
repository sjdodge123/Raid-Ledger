/**
 * ROK-1499 — the occupancy ledger behind the room recap.
 *
 * Two things are worth pinning here and nothing else is:
 *
 * 1. **The diff.** A flush sees the room's CURRENT members; the table holds
 *    the OPEN stays. Everything downstream depends on that subtraction being
 *    right, and the case that actually bites is a rename — the same id with a
 *    new display name must NOT close one stay and open another, or a recap
 *    double-counts the person who changed their nickname mid-session.
 * 2. **The statement shapes.** Each helper must be one insert and/or one
 *    update, never a per-row loop: this runs once per bound channel per
 *    five-second tick. Predicates are asserted through `PgDialect().sqlToQuery`
 *    (the repo idiom) so a dropped `left_at IS NULL` fails by rendered SQL.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import {
  closeAllOccupancy,
  diffOccupancy,
  listOccupancy,
  reconcileOccupancy,
  type OpenStay,
  type RoomMember,
} from './channel-presence-occupancy.helpers';

/**
 * Room members for the ledger. Names only — the `gameId` / `activityName`
 * columns are exercised explicitly by the tests that care about them.
 */
/** An open stay with no detected game. */
function stay(discordUserId: string, game?: Partial<OpenStay>): OpenStay {
  return { discordUserId, gameId: null, activityName: null, ...game };
}

function present(names: Record<string, string>): Map<string, RoomMember> {
  return new Map(
    Object.entries(names).map(([id, displayName]) => [
      id,
      { displayName, gameId: null, activityName: null },
    ]),
  );
}
const table = schema.discordChannelPresenceOccupancy;

interface Op {
  kind: 'select' | 'insert' | 'update';
  table?: unknown;
  values?: unknown;
  set?: unknown;
  where?: SQL;
  orderBy?: unknown[];
}

interface MockState {
  ops: Op[];
  results: unknown[][];
  cur: Op | null;
}

/** Chain mock recording one op per statement; every builder returns `chain`. */
function buildChain(st: MockState): Record<string, unknown> {
  const start = (kind: Op['kind'], t?: unknown): unknown => {
    st.cur = { kind, table: t };
    st.ops.push(st.cur);
    return chain;
  };
  const on = <T>(apply: (op: Op, arg: T) => void) =>
    jest.fn((arg: T) => {
      apply(st.cur!, arg);
      return chain;
    });
  const chain: Record<string, unknown> = {
    select: jest.fn(() => start('select')),
    insert: jest.fn((t: unknown) => start('insert', t)),
    update: jest.fn((t: unknown) => start('update', t)),
    from: on<unknown>((op, t) => (op.table = t)),
    values: on<unknown>((op, v) => (op.values = v)),
    set: on<unknown>((op, v) => (op.set = v)),
    where: on<SQL>((op, w) => (op.where = w)),
    orderBy: jest.fn((...o: unknown[]) => {
      st.cur!.orderBy = o;
      return chain;
    }),
    then: (resolve: (rows: unknown[]) => void): void => {
      resolve(st.results.shift() ?? []);
    },
  };
  return chain;
}

function buildMockDb() {
  const st: MockState = { ops: [], results: [], cur: null };
  const chain = buildChain(st);
  return {
    db: chain as unknown as PostgresJsDatabase<typeof schema>,
    ops: st.ops,
    queue(rows: unknown[]): void {
      st.results.push(rows);
    },
    only(kind: Op['kind']): Op[] {
      return st.ops.filter((o) => o.kind === kind);
    },
  };
}

function render(clause: SQL | undefined): string {
  if (!clause) throw new Error('statement recorded no where() clause');
  return new PgDialect().sqlToQuery(clause).sql;
}

const NOW = new Date('2026-09-13T20:00:00Z');
const ROW = 'presence-row-1';

describe('diffOccupancy', () => {
  it('opens a stay for a member with no open row', () => {
    const diff = diffOccupancy([stay('u1')], present({ u1: 'Ada', u2: 'Bo' }));

    expect(diff.joins).toEqual([
      {
        discordUserId: 'u2',
        displayName: 'Bo',
        gameId: null,
        activityName: null,
      },
    ]);
    expect(diff.leaves).toEqual([]);
  });

  it('closes the stay of a member who is no longer in the room', () => {
    const diff = diffOccupancy(
      [stay('u1'), stay('u2')],
      present({ u1: 'Ada' }),
    );

    expect(diff.joins).toEqual([]);
    expect(diff.leaves).toEqual(['u2']);
  });

  it('does nothing when the room is unchanged', () => {
    const diff = diffOccupancy([stay('u1')], present({ u1: 'Ada' }));

    expect(diff).toEqual({ joins: [], leaves: [], changes: [] });
  });

  it('keeps one stay when a member renames mid-session', () => {
    // The trap: keying on the NAME would close Ada's stay and open "Ada (AFK)",
    // splitting one three-hour sit into two and re-ranking the recap.
    const diff = diffOccupancy([stay('u1')], present({ u1: 'Ada (AFK)' }));

    expect(diff).toEqual({ joins: [], leaves: [], changes: [] });
  });

  it('treats an empty room as everyone leaving', () => {
    const diff = diffOccupancy([stay('u1'), stay('u2')], new Map());

    expect(diff.leaves).toEqual(['u1', 'u2']);
  });
});

describe('reconcileOccupancy', () => {
  it('reads only the OPEN stays of this presence row', async () => {
    const m = buildMockDb();
    m.queue([]);

    await reconcileOccupancy(m.db, ROW, new Map(), NOW);

    const sql = render(m.only('select')[0].where);
    expect(sql).toContain('"presence_message_id" = $1');
    expect(sql).toContain('"left_at" is null');
  });

  it('inserts every join in ONE statement, stamped with the flush instant', async () => {
    const m = buildMockDb();
    m.queue([]);

    await reconcileOccupancy(m.db, ROW, present({ u1: 'Ada', u2: 'Bo' }), NOW);

    const inserts = m.only('insert');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe(table);
    expect(inserts[0].values).toEqual([
      {
        presenceMessageId: ROW,
        discordUserId: 'u1',
        displayName: 'Ada',
        gameId: null,
        activityName: null,
        joinedAt: NOW,
      },
      {
        presenceMessageId: ROW,
        discordUserId: 'u2',
        displayName: 'Bo',
        gameId: null,
        activityName: null,
        joinedAt: NOW,
      },
    ]);
  });

  it('stamps every leaver in ONE update, scoped to their open rows', async () => {
    const m = buildMockDb();
    m.queue([stay('u1'), stay('u2')]);

    await reconcileOccupancy(m.db, ROW, present({ u1: 'Ada' }), NOW);

    const updates = m.only('update');
    expect(updates).toHaveLength(1);
    expect(updates[0].set).toEqual({ leftAt: NOW });
    const sql = render(updates[0].where);
    expect(sql).toContain('"left_at" is null');
    expect(sql).toContain('in ($2)');
  });

  it('issues no write at all when the room is unchanged', async () => {
    const m = buildMockDb();
    m.queue([stay('u1')]);

    await reconcileOccupancy(m.db, ROW, present({ u1: 'Ada' }), NOW);

    expect(m.only('insert')).toHaveLength(0);
    expect(m.only('update')).toHaveLength(0);
  });
});

describe('the stay carries what the room reads them as playing (P2-2)', () => {
  it('stores the detected game on the stay it opens', async () => {
    const m = buildMockDb();
    m.queue([]);

    await reconcileOccupancy(
      m.db,
      ROW,
      new Map([
        [
          'u1',
          { displayName: 'Ada', gameId: 7, activityName: 'Deep Rock Galactic' },
        ],
      ]),
      NOW,
    );

    expect(m.only('insert')[0].values).toEqual([
      {
        presenceMessageId: ROW,
        discordUserId: 'u1',
        displayName: 'Ada',
        gameId: 7,
        activityName: 'Deep Rock Galactic',
        joinedAt: NOW,
      },
    ]);
  });

  it('retitles the OPEN stay when the detected game moves', async () => {
    // Closing and reopening would be the other option; the stay is updated
    // because the segment it feeds is only ever used for someone with no
    // session rows at all, and for them the room's latest reading is the only
    // reading there is.
    const m = buildMockDb();
    m.queue([stay('u1', { gameId: 7, activityName: 'Deep Rock Galactic' })]);

    await reconcileOccupancy(
      m.db,
      ROW,
      new Map([
        ['u1', { displayName: 'Ada', gameId: 9, activityName: 'Valheim' }],
      ]),
      NOW,
    );

    const updates = m.only('update');
    expect(updates).toHaveLength(1);
    expect(updates[0].set).toEqual({ gameId: 9, activityName: 'Valheim' });
    expect(render(updates[0].where)).toContain('"left_at" is null');
  });

  it('collapses a whole group switching game into ONE update', async () => {
    const m = buildMockDb();
    m.queue([stay('u1'), stay('u2')]);

    await reconcileOccupancy(
      m.db,
      ROW,
      new Map([
        ['u1', { displayName: 'Ada', gameId: 9, activityName: 'Valheim' }],
        ['u2', { displayName: 'Bo', gameId: 9, activityName: 'Valheim' }],
      ]),
      NOW,
    );

    expect(m.only('update')).toHaveLength(1);
  });

  it('writes nothing when the game is unchanged', async () => {
    const m = buildMockDb();
    m.queue([stay('u1', { gameId: 7, activityName: 'Deep Rock Galactic' })]);

    await reconcileOccupancy(
      m.db,
      ROW,
      new Map([
        [
          'u1',
          { displayName: 'Ada', gameId: 7, activityName: 'Deep Rock Galactic' },
        ],
      ]),
      NOW,
    );

    expect(m.only('update')).toHaveLength(0);
  });
});

describe('closeAllOccupancy', () => {
  it('stamps every open stay of the row and leaves closed ones alone', async () => {
    const m = buildMockDb();

    await closeAllOccupancy(m.db, ROW, NOW);

    const updates = m.only('update');
    expect(updates).toHaveLength(1);
    expect(updates[0].set).toEqual({ leftAt: NOW });
    const sql = render(updates[0].where);
    expect(sql).toContain('"presence_message_id" = $1');
    // Without this clause a second empty flush would rewrite `left_at` on
    // stays that already closed, and every member's stay would collapse to 0.
    expect(sql).toContain('"left_at" is null');
  });
});

describe('listOccupancy', () => {
  it('returns the row’s stays oldest first, as recap segments', async () => {
    const m = buildMockDb();
    const joinedAt = new Date('2026-09-13T17:00:00Z');
    const row = {
      discordUserId: 'u1',
      displayName: 'Ada',
      gameId: null,
      activityName: null,
      joinedAt,
      leftAt: null,
    };
    m.queue([row]);

    const segments = await listOccupancy(m.db, ROW);

    expect(segments).toEqual([row]);
    const select = m.only('select')[0];
    expect(render(select.where)).toContain('"presence_message_id" = $1');
    expect(select.orderBy).toHaveLength(1);
  });
});
