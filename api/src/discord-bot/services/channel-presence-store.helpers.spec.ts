/**
 * ROK-1446 D7 — `discord_channel_presence_messages` accessors.
 *
 * The store is thin by design, so what is worth pinning is not "does drizzle
 * work" but the four facts the service depends on and cannot re-derive:
 *
 * 1. **At most one OPEN row per room.** The partial unique index is the
 *    guarantee; `openRow` must aim its `ON CONFLICT` at exactly that index
 *    (target columns AND the `status = 'open'` predicate — a partial index is
 *    not matched without it) so a losing writer is a no-op instead of a 23505.
 * 2. **No catch-and-retry.** Under postgres.js a failed statement poisons the
 *    whole transaction, savepoints included, so a violation must be PREVENTED,
 *    never caught. A rejecting insert therefore propagates untouched.
 * 3. **`empty_since` records the FIRST empty flush**, so the grace window in
 *    D8 actually elapses — a later empty flush must not push it forward.
 * 4. **Closed rows are immutable history.** Writes that only make sense on a
 *    live row carry `status = 'open'` in their predicate.
 *
 * Query predicates are asserted through `PgDialect().sqlToQuery` (the repo
 * idiom — `search.util.spec.ts:116`, `channel-presence-room.helpers.spec.ts:474`)
 * so a dropped clause fails by rendered SQL, not by a mock call count.
 */
import { PgDialect, getTableConfig } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import {
  findOpenRow,
  openRow,
  markEmpty,
  clearEmpty,
  closeRow,
  savePayloadHash,
  listOpenRows,
  type PresenceRow,
} from './channel-presence-store.helpers';

const table = schema.discordChannelPresenceMessages;

interface Op {
  kind: 'select' | 'insert' | 'update';
  table?: unknown;
  values?: unknown;
  set?: unknown;
  where?: SQL;
  conflict?: { target?: unknown; where?: SQL };
  limit?: number;
  orderBy?: unknown[];
}

interface MockState {
  ops: Op[];
  results: unknown[][];
  rejectWith: unknown;
  cur: Op | null;
}

/**
 * Chain mock that RECORDS one op per statement. Every builder method returns
 * the same thenable chain, so `.limit()`, `.orderBy()` and `.returning()` are
 * all valid terminals and the awaited value is the next queued result set.
 */
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
    onConflictDoNothing: on<Op['conflict']>((op, c) => (op.conflict = c)),
    set: on<unknown>((op, v) => (op.set = v)),
    where: on<SQL>((op, w) => (op.where = w)),
    limit: on<number>((op, n) => (op.limit = n)),
    returning: jest.fn(() => chain),
    orderBy: jest.fn((...o: unknown[]) => {
      st.cur!.orderBy = o;
      return chain;
    }),
    then: (
      resolve: (rows: unknown[]) => void,
      reject: (err: unknown) => void,
    ): void => {
      if (st.rejectWith) return reject(st.rejectWith);
      resolve(st.results.shift() ?? []);
    },
  };
  return chain;
}

function buildMockDb() {
  const st: MockState = { ops: [], results: [], rejectWith: null, cur: null };
  const chain = buildChain(st);
  return {
    db: chain as unknown as PostgresJsDatabase<typeof schema>,
    ops: st.ops,
    queue(rows: unknown[]): void {
      st.results.push(rows);
    },
    failWith(err: unknown): void {
      st.rejectWith = err;
    },
    only(kind: Op['kind']): Op[] {
      return st.ops.filter((o) => o.kind === kind);
    },
  };
}

function render(clause: SQL | undefined): { sql: string; params: unknown[] } {
  if (!clause) throw new Error('statement recorded no where() clause');
  const q = new PgDialect().sqlToQuery(clause);
  return { sql: q.sql, params: q.params };
}

const row = (over: Partial<PresenceRow> = {}): PresenceRow => ({
  id: 'row-1',
  guildId: 'g-1',
  voiceChannelId: 'vc-1',
  bindingId: 'bind-1',
  textChannelId: 'tc-1',
  messageId: 'msg-1',
  status: 'open',
  payloadHash: null,
  openedAt: new Date('2026-09-04T10:00:00Z'),
  emptySince: null,
  closedAt: null,
  closeReason: null,
  createdAt: new Date('2026-09-04T10:00:00Z'),
  updatedAt: new Date('2026-09-04T10:00:00Z'),
  ...over,
});

const OPEN_INPUT = {
  guildId: 'g-1',
  voiceChannelId: 'vc-1',
  bindingId: 'bind-1',
  textChannelId: 'tc-1',
  messageId: 'msg-1',
};

/** The partial unique index, read off the schema rather than hard-coded. */
function partialUniqueIndex() {
  const found = getTableConfig(table).indexes.find(
    (i) => (i.config as { unique?: boolean }).unique,
  );
  if (!found) throw new Error('no unique index declared on the table');
  return found.config as unknown as {
    name: string;
    columns: { name: string }[];
    where?: SQL;
  };
}

describe('the one-open-row-per-room guarantee (AC1)', () => {
  it('declares a UNIQUE index on (guild_id, voice_channel_id) restricted to open rows', () => {
    const idx = partialUniqueIndex();

    expect(idx.columns.map((c) => c.name)).toEqual([
      'guild_id',
      'voice_channel_id',
    ]);
    expect(idx.where && render(idx.where).sql).toBe(
      `"discord_channel_presence_messages"."status" = 'open'`,
    );
  });

  it('aims openRow ON CONFLICT at exactly that index — a partial index needs its predicate', async () => {
    const m = buildMockDb();
    m.queue([row()]);

    await openRow(m.db, OPEN_INPUT);

    const idx = partialUniqueIndex();
    const conflict = m.only('insert')[0].conflict;
    const columns = table as unknown as Record<string, unknown>;
    expect(conflict?.target).toEqual(
      idx.columns.map((c) => columns[camel(c.name)]),
    );
    // drizzle emits `on conflict (cols) where <where> do nothing`, so this
    // `where` IS the target predicate that selects the partial index.
    expect(conflict?.where && render(conflict.where).sql).toBe(
      idx.where ? render(idx.where).sql : 'MISSING',
    );
  });

  it('never issues a second INSERT when the room already has an open row', async () => {
    const m = buildMockDb();
    m.queue([]); // the DB did nothing — someone else holds the open row
    m.queue([row({ id: 'winner', messageId: 'msg-winner' })]);

    const result = await openRow(m.db, OPEN_INPUT);

    expect(result).toEqual({
      row: expect.objectContaining({ id: 'winner', messageId: 'msg-winner' }),
      created: false,
    });
    expect(m.only('insert')).toHaveLength(1);
  });

  it('reports a freshly created row as created:true', async () => {
    const m = buildMockDb();
    m.queue([row({ id: 'fresh' })]);

    const result = await openRow(m.db, OPEN_INPUT);

    expect(result).toEqual({
      row: expect.objectContaining({ id: 'fresh' }),
      created: true,
    });
    expect(m.only('select')).toHaveLength(0);
  });
});

describe('openRow — insert shape and failure handling', () => {
  it('inserts the row as open, with the caller-supplied identity', async () => {
    const m = buildMockDb();
    m.queue([row()]);

    await openRow(m.db, { ...OPEN_INPUT, bindingId: null });

    expect(m.only('insert')[0].table).toBe(table);
    expect(m.only('insert')[0].values).toEqual({
      guildId: 'g-1',
      voiceChannelId: 'vc-1',
      bindingId: null,
      textChannelId: 'tc-1',
      messageId: 'msg-1',
      status: 'open',
    });
  });

  it('propagates a failing insert untouched — a caught violation would poison the transaction', async () => {
    const m = buildMockDb();
    const violation = Object.assign(new Error('duplicate key value'), {
      code: '23505',
    });
    m.failWith(violation);

    await expect(openRow(m.db, OPEN_INPUT)).rejects.toBe(violation);
    expect(m.only('insert')).toHaveLength(1);
    expect(m.only('select')).toHaveLength(0);
  });

  it('throws rather than inventing a row when the conflict winner is already gone', async () => {
    const m = buildMockDb();
    m.queue([]);
    m.queue([]);

    await expect(openRow(m.db, OPEN_INPUT)).rejects.toThrow(
      'no open presence row for vc-1 after a conflicting insert',
    );
  });
});

/** camelCase a snake_case column name so index metadata maps to the schema. */
function camel(name: string): string {
  return name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

describe('findOpenRow / listOpenRows (reads)', () => {
  it('scopes findOpenRow to one open row for the room', async () => {
    const m = buildMockDb();
    m.queue([row({ payloadHash: 'abc123' })]);

    const found = await findOpenRow(m.db, 'g-1', 'vc-1');

    expect(found).toMatchObject({ id: 'row-1', payloadHash: 'abc123' });
    const op = m.only('select')[0];
    expect(op.table).toBe(table);
    expect(op.limit).toBe(1);
    const { sql, params } = render(op.where);
    expect(sql).toContain(`"guild_id" = $1`);
    expect(sql).toContain(`"voice_channel_id" = $2`);
    expect(sql).toContain(`"status" = $3`);
    expect(params).toEqual(['g-1', 'vc-1', 'open']);
  });

  it('returns null when the room has no open row', async () => {
    const m = buildMockDb();

    expect(await findOpenRow(m.db, 'g-1', 'vc-1')).toBeNull();
  });

  it('lists every open row oldest-first for recover(), and closed rows never appear', async () => {
    const m = buildMockDb();
    m.queue([row({ id: 'a' }), row({ id: 'b' })]);

    const rows = await listOpenRows(m.db);

    expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
    const op = m.only('select')[0];
    const { sql, params } = render(op.where);
    expect(sql).toContain(`"status" = $1`);
    expect(params).toEqual(['open']);
    expect(render(op.orderBy?.[0] as SQL).sql).toContain('"opened_at"');
  });
});

describe('markEmpty / clearEmpty (the D8 grace window)', () => {
  it('stamps empty_since only while it is still null, so the first empty flush wins', async () => {
    const m = buildMockDb();
    const at = new Date('2026-09-04T11:00:00Z');

    await markEmpty(m.db, 'row-1', at);

    const op = m.only('update')[0];
    expect(op.table).toBe(table);
    expect(op.set).toEqual({ emptySince: at, updatedAt: expect.any(Date) });
    const { sql, params } = render(op.where);
    expect(sql).toContain(`"empty_since" is null`);
    expect(params).toEqual(['row-1']);
  });

  it('clears empty_since on a rejoin inside the grace', async () => {
    const m = buildMockDb();

    await clearEmpty(m.db, 'row-1');

    const op = m.only('update')[0];
    expect(op.set).toEqual({ emptySince: null, updatedAt: expect.any(Date) });
    expect(render(op.where).params).toEqual(['row-1']);
  });
});

describe('closeRow / savePayloadHash (writes that need a live row)', () => {
  it('closes with a reason and a timestamp, and only ever an open row', async () => {
    const m = buildMockDb();

    await closeRow(m.db, 'row-1', 'missing');

    const op = m.only('update')[0];
    expect(op.set).toEqual({
      status: 'closed',
      closeReason: 'missing',
      closedAt: expect.any(Date),
      updatedAt: expect.any(Date),
    });
    const { sql, params } = render(op.where);
    expect(sql).toContain(`"status" = $2`);
    expect(params).toEqual(['row-1', 'open']);
  });

  it('stores the D5 payload hash on the open row only', async () => {
    const m = buildMockDb();

    await savePayloadHash(m.db, 'row-1', 'deadbeef');

    const op = m.only('update')[0];
    expect(op.set).toEqual({
      payloadHash: 'deadbeef',
      updatedAt: expect.any(Date),
    });
    const { sql, params } = render(op.where);
    expect(sql).toContain(`"status" = $2`);
    expect(params).toEqual(['row-1', 'open']);
  });
});
