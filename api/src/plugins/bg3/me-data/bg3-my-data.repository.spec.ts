/**
 * ROK-1957 D-18 — "Delete my BG3 data" removes only the caller's claims,
 * key bindings, default and saves in one transaction, then releases the
 * deleted saves' distinct thumbnail shas with a NOT-NULL `stillUsed` guard,
 * and clears the caller's `bg3-save` latest-wins markers.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableName, type SQL, type Table } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';
import { createDrizzleMock } from '../../../common/testing/drizzle-mock';
import type { CompanionBlobStore } from '../../../companion/blobs/companion-blob.store';
import { BG3_SAVE_CONTRACT_ID } from '../bg3.constants';
import { Bg3MyDataRepository } from './bg3-my-data.repository';

type Db = PostgresJsDatabase<typeof schema>;
const ME = 7;
const STARTED = new Date('2026-10-28T06:00:00Z');
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

function rendered(arg: unknown): { sql: string; params: unknown[] } {
  if (arg === undefined) throw new Error('where() was not called');
  return new PgDialect().sqlToQuery(arg as SQL);
}

function build(saveShas: (string | null)[], counts = 1) {
  const db = createDrizzleMock();
  const wheres = new Map<string, unknown>();
  db.delete.mockImplementation((table: Table) => ({
    where: (cond: unknown) => {
      const name = getTableName(table);
      wheres.set(name, cond);
      if (name !== 'bg3_saves') return Promise.resolve({ count: counts });
      return {
        returning: () => Promise.resolve(saveShas.map((sha) => ({ sha }))),
      };
    },
  }));
  const store = { releaseUnusedRefsIn: jest.fn().mockResolvedValue(2) };
  const repo = new Bg3MyDataRepository(
    db as unknown as Db,
    store as unknown as CompanionBlobStore,
  );
  return { db, repo, wheres, store };
}

const TABLES = [
  ['bg3_party_claims', 'user_id'],
  ['bg3_campaign_keys', 'user_id'],
  ['bg3_user_defaults', 'user_id'],
  ['bg3_saves', 'uploader_user_id'],
] as const;

describe('Bg3MyDataRepository.deleteAllFor', () => {
  it.each(TABLES)('scopes the %s delete to the caller', async (table, col) => {
    const { repo, wheres } = build([SHA_A]);
    await repo.deleteAllFor(ME, STARTED);
    const q = rendered(wheres.get(table));
    expect(q.sql).toBe(`"${table}"."${col}" = $1`);
    expect(q.params).toEqual([ME]);
  });

  it('runs every delete and the ref release in one transaction', async () => {
    const { db, repo, wheres } = build([SHA_A]);
    await repo.deleteAllFor(ME, STARTED);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect([...wheres.keys()].sort()).toEqual(
      [...TABLES.map(([t]) => t), 'companion_ingest_latest'].sort(),
    );
  });

  it("clears the caller's bg3-save latest-wins markers (a re-upload is not stale)", async () => {
    const { repo, wheres } = build([SHA_A]);
    await repo.deleteAllFor(ME, STARTED);
    const q = rendered(wheres.get('companion_ingest_latest'));
    expect(q.sql).toBe(
      '("companion_ingest_latest"."user_id" = $1 and "companion_ingest_latest"."contract" = $2)',
    );
    expect(q.params).toEqual([ME, BG3_SAVE_CONTRACT_ID]);
  });

  it("releases the caller's distinct non-null shas, cut off at the start", async () => {
    const { repo, store } = build([SHA_A, null, SHA_B, SHA_A]);
    await repo.deleteAllFor(ME, STARTED);
    expect(store.releaseUnusedRefsIn).toHaveBeenCalledTimes(1);
    const release = store.releaseUnusedRefsIn.mock.calls[0]?.[1];
    expect(release).toMatchObject({
      userId: ME,
      contract: BG3_SAVE_CONTRACT_ID,
      shas: [SHA_A, SHA_B],
      referencedBefore: STARTED,
    });
  });

  it("guards stillUsed to the caller's non-null shas (NOT IN with NULL keeps all)", async () => {
    const { db, repo } = build([SHA_A]);
    await repo.deleteAllFor(ME, STARTED);
    expect(db.select).toHaveBeenCalledWith({
      sha: schema.bg3Saves.thumbnailSha256,
    });
    expect(db.from).toHaveBeenCalledWith(schema.bg3Saves);
    const q = rendered(db.where.mock.calls[0]?.[0]);
    expect(q.sql).toBe(
      '("bg3_saves"."uploader_user_id" = $1 and "bg3_saves"."thumbnail_sha256" is not null)',
    );
    expect(q.params).toEqual([ME]);
  });

  it('returns the per-table counts', async () => {
    const { repo } = build([SHA_A, SHA_B, null], 1);
    await expect(repo.deleteAllFor(ME, STARTED)).resolves.toEqual({
      saves: 3,
      campaignKeys: 1,
      defaultCampaign: 1,
      claims: 1,
      thumbnailRefs: 2,
    });
  });

  it('a user with no BG3 data gets zeros and an empty sha list', async () => {
    const { repo, store } = build([], 0);
    store.releaseUnusedRefsIn.mockResolvedValue(0);
    await expect(repo.deleteAllFor(ME, STARTED)).resolves.toEqual({
      saves: 0,
      campaignKeys: 0,
      defaultCampaign: 0,
      claims: 0,
      thumbnailRefs: 0,
    });
    expect(store.releaseUnusedRefsIn.mock.calls[0]?.[1]?.shas).toEqual([]);
  });
});
