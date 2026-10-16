/**
 * ROK-1809 — family-lock helpers (unit). The race itself is proven against
 * real Postgres in `refresh-rotation-race.integration.spec.ts`; these pin the
 * lock statement, that a token's family is locked before anything else runs,
 * and the deadlock-free key ordering of the multi-family lock.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { defined } from '../../common/testing/narrow';
import {
  REFRESH_FAMILY_LOCK_CLASS,
  lockFamily,
  lockFamilyOfToken,
  lockUserFamilies,
} from './refresh-rotation.helpers';

/** A tx fake: `select*` chains resolve to `rows`; `execute` records SQL. */
function fakeTx(rows: unknown[]) {
  const executed: SQL[] = [];
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(rows),
    then: (ok: (v: unknown[]) => unknown) => Promise.resolve(rows).then(ok),
  };
  const tx = {
    select: () => chain,
    selectDistinct: () => chain,
    execute: (query: SQL) => {
      executed.push(query);
      return Promise.resolve([]);
    },
  };
  // Repo convention for a db test double: the helpers only touch
  // select/selectDistinct/execute.
  return { db: tx as never, executed };
}

const dialect = new PgDialect();
const lockedFamilies = (executed: SQL[]) =>
  executed.map((q) => dialect.sqlToQuery(q).params[1]);

describe('refresh family lock helpers (ROK-1809)', () => {
  it('lockFamily takes the two-key xact lock in the refresh class', async () => {
    const { db, executed } = fakeTx([]);
    await lockFamily(db, 'fam-a');
    const query = dialect.sqlToQuery(defined(executed[0], 'lock statement'));
    expect(query.sql).toContain('pg_advisory_xact_lock(');
    expect(query.sql).toContain('hashtext(');
    expect(query.params).toEqual([REFRESH_FAMILY_LOCK_CLASS, 'fam-a']);
  });

  it('lockFamilyOfToken locks the presented token family', async () => {
    const { db, executed } = fakeTx([{ familyId: 'fam-x' }]);
    await expect(lockFamilyOfToken(db, 'hash')).resolves.toBe('fam-x');
    expect(lockedFamilies(executed)).toEqual(['fam-x']);
  });

  it('lockFamilyOfToken takes no lock for an unknown token', async () => {
    const { db, executed } = fakeTx([]);
    await expect(lockFamilyOfToken(db, 'hash')).resolves.toBeNull();
    expect(executed).toHaveLength(0);
  });

  it('lockUserFamilies locks every live family in lock-key order', async () => {
    const { db, executed } = fakeTx([
      { familyId: 'fam-c', lockKey: 30 },
      { familyId: 'fam-b', lockKey: -5 },
      { familyId: 'fam-z', lockKey: 7 },
      { familyId: 'fam-a', lockKey: 7 },
    ]);
    await lockUserFamilies(db, 1);
    expect(lockedFamilies(executed)).toEqual([
      'fam-b',
      'fam-a',
      'fam-z',
      'fam-c',
    ]);
  });
});
