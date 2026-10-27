/** ROK-1956 R1 — the shared per-user blob lock statement. */
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import {
  companionBlobLockKey,
  lockCompanionUserBlobs,
} from './companion-blob-lock';

describe('lockCompanionUserBlobs', () => {
  it('takes pg_advisory_xact_lock on the one per-user key', async () => {
    const seen: SQL[] = [];
    const tx = {
      execute: jest.fn((q: SQL) => (seen.push(q), Promise.resolve([]))),
    };
    await lockCompanionUserBlobs(tx, 7);
    expect(seen).toHaveLength(1);
    const [q] = seen;
    if (!q) throw new Error('no statement');
    expect(new PgDialect().sqlToQuery(q)).toMatchObject({
      sql: 'select pg_advisory_xact_lock(hashtext($1))',
      params: ['companion-blobs:7'],
    });
    expect(companionBlobLockKey(7)).toBe('companion-blobs:7');
  });
});
