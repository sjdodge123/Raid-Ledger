/**
 * ROK-1957 D-9 / D-11 — one group's prune transaction applies
 * `planRetention`: stamp the kept last row, delete the rest, and release
 * only the thumbnails no remaining row uses, with the run's start as the
 * `referenced_at` cutoff.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../../drizzle/schema';
import { createDrizzleMock } from '../../../common/testing/drizzle-mock';
import type { CompanionBlobStore } from '../../../companion/blobs/companion-blob.store';
import { BG3_SAVE_CONTRACT_ID, BG3_SESSION_GAP_MS } from '../bg3.constants';
import type { Bg3RetentionRow } from './bg3-retention.helpers';
import { Bg3RetentionRepository } from './bg3-retention.repository';

type Db = PostgresJsDatabase<typeof schema>;
const H = 3_600_000;
const CUTOFF = new Date('2026-07-30T00:00:00Z');
const STARTED = new Date('2026-10-28T05:15:00Z');
const OLD = CUTOFF.getTime() - 30 * 24 * H;
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

function row(id: number, at: number, sha: string | null): Bg3RetentionRow {
  return {
    id,
    savedAt: new Date(at),
    currentLevel: 'WLD_Main_A',
    partyMaxLevel: 3,
    thumbnailSha256: sha,
  };
}

function rendered(arg: unknown): { sql: string; params: unknown[] } {
  if (arg === undefined) throw new Error('where() was not called');
  return new PgDialect().sqlToQuery(arg as SQL);
}

function build(rows: Bg3RetentionRow[]) {
  const db = createDrizzleMock();
  db.for.mockResolvedValueOnce(rows);
  const deleteWhere = jest.fn().mockResolvedValue({ count: 0 });
  db.delete.mockReturnValue({ where: deleteWhere });
  const updateWhere = jest.fn().mockResolvedValue(undefined);
  const set = jest.fn().mockReturnValue({ where: updateWhere });
  db.update.mockReturnValue({ set });
  const store = { releaseUnusedRefsIn: jest.fn().mockResolvedValue(1) };
  const repo = new Bg3RetentionRepository(
    db as unknown as Db,
    store as unknown as CompanionBlobStore,
  );
  return { repo, db, deleteWhere, set, updateWhere, store };
}

const GROUP = { userId: 7, campaignId: 3 };

describe('Bg3RetentionRepository.pruneGroup', () => {
  it('keeps the last save of an old session, stamped, and deletes the rest', async () => {
    const { repo, deleteWhere, set, updateWhere } = build([
      row(1, OLD, SHA_A),
      row(2, OLD + H, SHA_B),
      row(3, OLD + 2 * H, SHA_B),
      row(4, CUTOFF.getTime() - H, null),
      row(5, CUTOFF.getTime() + H, null),
    ]);
    await expect(
      repo.pruneGroup(GROUP, CUTOFF, STARTED, BG3_SESSION_GAP_MS),
    ).resolves.toBe(2);
    expect(set).toHaveBeenCalledWith({
      sessionFirstSavedAt: new Date(OLD),
      sessionSaveCount: 3,
    });
    expect(rendered(updateWhere.mock.calls[0]?.[0]).params).toEqual([3]);
    expect(rendered(deleteWhere.mock.calls[0]?.[0]).params).toEqual([1, 2]);
  });

  it('releases only the shas no remaining row uses, cut off at the run start', async () => {
    const { repo, store } = build([
      row(1, OLD, SHA_A),
      row(2, OLD + H, SHA_B),
      row(3, OLD + 2 * H, SHA_B),
    ]);
    await repo.pruneGroup(GROUP, CUTOFF, STARTED, BG3_SESSION_GAP_MS);
    expect(store.releaseUnusedRefsIn).toHaveBeenCalledTimes(1);
    expect(store.releaseUnusedRefsIn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: 7,
        contract: BG3_SAVE_CONTRACT_ID,
        shas: [SHA_A],
        referencedBefore: STARTED,
      }),
    );
  });

  it('takes the uploader’s blob lock before it locks any save row (review fix 2)', async () => {
    const { repo, db } = build([row(1, OLD, SHA_A), row(2, OLD + H, SHA_A)]);
    await repo.pruneGroup(GROUP, CUTOFF, STARTED, BG3_SESSION_GAP_MS);
    const lock = rendered(db.execute.mock.calls[0]?.[0]);
    expect([lock.sql, lock.params]).toEqual([
      'select pg_advisory_xact_lock(hashtext($1))',
      ['companion-blobs:7'],
    ]);
    expect(db.execute.mock.invocationCallOrder[0]).toBeLessThan(
      db.for.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('writes nothing for a group with nothing to thin (idempotent re-run)', async () => {
    const collapsed: Bg3RetentionRow = {
      ...row(3, OLD + 2 * H, SHA_B),
      sessionFirstSavedAt: new Date(OLD),
      sessionSaveCount: 3,
    };
    const { repo, deleteWhere, set, store } = build([collapsed]);
    await expect(
      repo.pruneGroup(GROUP, CUTOFF, STARTED, BG3_SESSION_GAP_MS),
    ).resolves.toBe(0);
    expect(deleteWhere).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(store.releaseUnusedRefsIn).not.toHaveBeenCalled();
  });
});
