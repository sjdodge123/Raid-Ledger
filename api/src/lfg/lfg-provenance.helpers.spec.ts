/**
 * ROK-1454 D5 / AC-P (unit tier) — the converted-group read must NOT be built
 * out of the live predicate family.
 *
 * `liveIntent` (`lfg-query.helpers.ts:106`) is THREE filters — `status =
 * 'active'`, `expires_at > now()` and `eligibleUser()`. `convertGroup` flips
 * status to `converted` and never resets `expires_at`, so a converted group is
 * historical on BOTH the status and the expiry axis: a read composing
 * `liveIntent` returns an empty roster and the final embed silently loses
 * everyone. That is exactly what got round 1 rejected.
 *
 * These cases execute the real drizzle SQL builder and assert on the compiled
 * WHERE clause, so "the expiry predicate is not in there" is checked against
 * generated SQL rather than against a hand-wave. The same claim is exercised
 * end-to-end against Postgres in `lfg-provenance.integration.spec.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import type { LfgDb } from './lfg-query.helpers';
import {
  convertedToTarget,
  listConvertedGroupMembers,
} from './lfg-provenance.helpers';

/** Compile a drizzle condition to the SQL text + bound params Postgres sees. */
function compile(cond: unknown): { sql: string; params: unknown[] } {
  const query = new PgDialect().sqlToQuery(cond as SQL);
  return { sql: query.sql, params: query.params };
}

/** The WHERE clause `listConvertedGroupMembers` handed to drizzle. */
function capturedWhere(db: MockDb): { sql: string; params: unknown[] } {
  expect(db.where).toHaveBeenCalledTimes(1);
  return compile(db.where.mock.calls[0][0]);
}

const ROW = {
  userId: 7,
  username: 'ripley',
  displayName: 'Ellen',
  avatar: 'avatar-hash',
  customAvatarUrl: null as string | null,
  expiresAt: new Date('2026-08-01T10:00:00.000Z'),
  joinedAt: new Date('2026-07-20T09:00:00.000Z'),
};

function mockWithRows(rows: unknown[]): MockDb {
  const db = createDrizzleMock();
  db.orderBy.mockResolvedValue(rows);
  return db;
}

describe('convertedToTarget', () => {
  it('filters on converted_to_poll_id for a poll target', () => {
    const { sql, params } = compile(convertedToTarget({ pollId: 42 }));
    expect(sql).toContain('converted_to_poll_id');
    expect(sql).not.toContain('converted_to_event_id');
    expect(params).toEqual([42]);
  });

  it('filters on converted_to_event_id for an event target', () => {
    const { sql, params } = compile(convertedToTarget({ eventId: 99 }));
    expect(sql).toContain('converted_to_event_id');
    expect(sql).not.toContain('converted_to_poll_id');
    expect(params).toEqual([99]);
  });

  it('keeps the moved predicate byte-identical: pollId wins when both are set', () => {
    // The private `matchesTarget` it replaces branched on
    // `target.pollId !== undefined`, not on which field is "more set". Moving a
    // predicate between files must not quietly change its tie-break.
    const { sql, params } = compile(
      convertedToTarget({ pollId: 1, eventId: 2 }),
    );
    expect(sql).toContain('converted_to_poll_id');
    expect(params).toEqual([1]);
  });
});

describe('listConvertedGroupMembers — the WHERE clause', () => {
  it('does NOT filter on expires_at (a converted group is always expired eventually)', async () => {
    const db = mockWithRows([]);
    await listConvertedGroupMembers(db as unknown as LfgDb, 3, { eventId: 5 });

    const { sql } = capturedWhere(db);
    expect(sql).not.toMatch(/expires_at/);
  });

  it('does NOT filter on status = active', async () => {
    const db = mockWithRows([]);
    await listConvertedGroupMembers(db as unknown as LfgDb, 3, { eventId: 5 });

    const { params } = capturedWhere(db);
    expect(params).not.toContain('active');
  });

  it('filters on game, converted status and the provenance target', async () => {
    const db = mockWithRows([]);
    await listConvertedGroupMembers(db as unknown as LfgDb, 3, { eventId: 5 });

    const { sql, params } = capturedWhere(db);
    expect(sql).toContain('game_id');
    expect(sql).toContain('converted_to_event_id');
    expect(params).toEqual(expect.arrayContaining([3, 'converted', 5]));
  });

  it('still excludes deactivated and banned holders (ROK-313 family)', async () => {
    const db = mockWithRows([]);
    await listConvertedGroupMembers(db as unknown as LfgDb, 3, { eventId: 5 });

    const { sql } = capturedWhere(db);
    expect(sql).toMatch(/deactivated_at"? is null/);
    expect(sql).toMatch(/banned_at"? is null/);
  });

  it('scopes a poll target to converted_to_poll_id', async () => {
    const db = mockWithRows([]);
    await listConvertedGroupMembers(db as unknown as LfgDb, 3, { pollId: 11 });

    const { sql, params } = capturedWhere(db);
    expect(sql).toContain('converted_to_poll_id');
    expect(params).toEqual(expect.arrayContaining([11]));
  });
});

describe('listConvertedGroupMembers — shape', () => {
  it('joins users and orders by joined-at then id, oldest first', async () => {
    const db = mockWithRows([]);
    await listConvertedGroupMembers(db as unknown as LfgDb, 3, { eventId: 5 });

    expect(db.innerJoin).toHaveBeenCalledTimes(1);
    const ordering = (db.orderBy.mock.calls[0] as unknown[]).map(
      (c) => compile(c).sql,
    );
    expect(ordering).toEqual([
      expect.stringMatching(/created_at"? asc/),
      expect.stringMatching(/"id" asc/),
    ]);
  });

  it('maps rows onto LfgMemberDto with ISO instants', async () => {
    const db = mockWithRows([ROW]);

    const members = await listConvertedGroupMembers(db as unknown as LfgDb, 3, {
      eventId: 5,
    });

    expect(members).toEqual([
      {
        userId: 7,
        username: 'ripley',
        displayName: 'Ellen',
        avatarUrl: 'avatar-hash',
        expiresAt: '2026-08-01T10:00:00.000Z',
        joinedAt: '2026-07-20T09:00:00.000Z',
      },
    ]);
  });

  it('prefers a custom avatar over the Discord one, like listGroupMembers', async () => {
    const db = mockWithRows([{ ...ROW, customAvatarUrl: 'https://cdn/x.png' }]);

    const [member] = await listConvertedGroupMembers(
      db as unknown as LfgDb,
      3,
      { eventId: 5 },
    );

    expect(member.avatarUrl).toBe('https://cdn/x.png');
  });
});

describe('the module never reaches for the live predicate family', () => {
  it('does not reference liveIntent in executable code', () => {
    const source = readFileSync(
      join(__dirname, 'lfg-provenance.helpers.ts'),
      'utf8',
    );
    // Strip comments FIRST: this file's own doc comment explains why it must
    // not compose `liveIntent`, and a naive scan trips on that explanation
    // (the exact defect that landed twice in ROK-1314).
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

    expect(code).not.toMatch(/liveIntent/);
  });
});
