/**
 * ROK-2020 (Codex P2): participant removal and a slot tap for the same user
 * serialise on one `(matchId, userId)` advisory lock. These cases pin that the
 * lock is the real advisory statement and that the REMOVAL path takes it
 * before its first delete (the vote path is pinned in
 * `scheduling.service.spec.ts`, "takes the (match, user) roster lock").
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import {
  MATCH_MEMBER_LOCK_CLASS,
  lockMatchMember,
} from './scheduling-member-lock.helpers';
import { deleteMatchMemberWithVotes } from './scheduling-members-remove.helpers';

type Db = PostgresJsDatabase<typeof schema>;

function executedSql(db: MockDb, call: number): { sql: string; params: unknown[] } {
  const arg = db.execute.mock.calls[call]?.[0] as SQL | undefined;
  if (!arg) throw new Error(`execute call ${call} missing`);
  return new PgDialect().sqlToQuery(arg);
}

describe('roster lock (ROK-2020)', () => {
  let db: MockDb;

  beforeEach(() => {
    db = createDrizzleMock();
    db.returning.mockResolvedValue([]);
  });

  it('issues a transaction-scoped two-key advisory lock on (match, user)', async () => {
    await lockMatchMember(db as unknown as Db, 20, 7);
    const query = executedSql(db, 0);
    expect(query.sql).toContain('pg_advisory_xact_lock(');
    expect(query.sql).toContain('::int4, hashtext(');
    expect(query.params).toEqual([MATCH_MEMBER_LOCK_CLASS, '20:7']);
  });

  it('removal takes the lock inside its tx BEFORE deleting votes or the member', async () => {
    db.returning
      .mockResolvedValueOnce([{ id: 1 }])
      .mockResolvedValueOnce([{ id: 2 }]);

    await expect(
      deleteMatchMemberWithVotes(db as unknown as Db, 20, 7),
    ).resolves.toEqual({ removedVotes: 1, removedMembers: 1 });

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(executedSql(db, 0).params).toEqual([MATCH_MEMBER_LOCK_CLASS, '20:7']);
    const lockOrder = db.execute.mock.invocationCallOrder[0] ?? Infinity;
    const firstDelete = db.delete.mock.invocationCallOrder[0] ?? -1;
    expect(lockOrder).toBeLessThan(firstDelete);
  });
});
