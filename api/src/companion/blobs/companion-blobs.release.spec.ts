/**
 * ROK-1957 D-11 — `releaseUnusedRefsIn` is one DELETE scoped to the user,
 * the contract and the shas, that spares refs refreshed since the prune
 * began and refs a remaining plugin row still uses.
 */
import { PgDialect, QueryBuilder } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import { bg3Saves } from '../../drizzle/schema';
import { releaseUnusedRefsIn } from './companion-blobs.repository';

type Db = PostgresJsDatabase<typeof schema>;
const SHA = 'c'.repeat(64);
const BEFORE = new Date('2026-10-28T05:15:00Z');

function build() {
  const where = jest.fn().mockResolvedValue({ count: 1 });
  const tx = { delete: jest.fn().mockReturnValue({ where }) };
  return { tx: tx as unknown as Pick<Db, 'delete'>, where };
}

function rendered(arg: unknown): { sql: string; params: unknown[] } {
  if (arg === undefined) throw new Error('where() was not called');
  return new PgDialect().sqlToQuery(arg as SQL);
}

describe('releaseUnusedRefsIn (D-11)', () => {
  it('deletes only pre-cutoff refs that no remaining row uses', async () => {
    const { tx, where } = build();
    const release = {
      userId: 7,
      contract: 'bg3-save',
      shas: [SHA],
      referencedBefore: BEFORE,
      stillUsed: new QueryBuilder()
        .select({ sha: bg3Saves.thumbnailSha256 })
        .from(bg3Saves),
    };
    await expect(releaseUnusedRefsIn(tx, release)).resolves.toBe(1);
    const q = rendered(where.mock.calls[0]?.[0]);
    expect(q.sql).toContain('"referenced_at" < $4');
    expect(q.sql).toContain(
      '"sha256" not in (select "thumbnail_sha256" from "bg3_saves")',
    );
    expect(q.params).toEqual([7, 'bg3-save', SHA, BEFORE.toISOString()]);
  });

  it('issues no statement for an empty sha list', async () => {
    const { tx, where } = build();
    const release = {
      userId: 7,
      contract: 'bg3-save',
      shas: [],
      referencedBefore: BEFORE,
    };
    await expect(releaseUnusedRefsIn(tx, release)).resolves.toBe(0);
    expect(where).not.toHaveBeenCalled();
  });
});
