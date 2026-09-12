/**
 * Cohort signature unit tests (ROK-1309 S2).
 *
 * The signature is the join key between live-written memory rows and the
 * backfill migration, so these three properties are load-bearing:
 * order-independence, union dedupe, and the empty-cohort guard.
 */
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import {
  buildCohortSignature,
  loadCohortSignature,
} from './cohort-memory-signature.helpers';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

const asDb = (m: MockDb): Db => m as unknown as Db;
const rows = (...ids: number[]) => ids.map((user_id) => ({ user_id }));

describe('cohort-memory-signature.helpers', () => {
  let mockDb: MockDb;

  beforeEach(() => {
    mockDb = createDrizzleMock();
  });

  it('hashes order-independently: {C,A,B} and {A,B,C} agree', async () => {
    mockDb.execute.mockResolvedValueOnce(rows(30, 10, 20));
    const shuffled = await loadCohortSignature(asDb(mockDb), 1);
    mockDb.execute.mockResolvedValueOnce(rows(10, 20, 30));
    const ordered = await loadCohortSignature(asDb(mockDb), 1);

    expect(shuffled?.participantHash).toBe(ordered?.participantHash);
    expect(shuffled?.participantIds).toEqual([10, 20, 30]);
  });

  it('sorts numerically, not as text, and matches the canonical SQL vector', () => {
    // Parity vector pinned in the schema header: {10,2,7} -> "2,7,10".
    // A text sort would yield "10,2,7" and a different digest.
    expect(buildCohortSignature([10, 2, 7])?.participantHash).toBe(
      '90676ccf0f65e9bbe89124e3079b2d96e9cce8304560a6eadd6a2c8ea0befee7',
    );
  });

  it('dedupes the union: a nominator who also voted counts once', async () => {
    mockDb.execute.mockResolvedValueOnce(rows(5, 5, 9));
    const sig = await loadCohortSignature(asDb(mockDb), 1);

    expect(sig?.participantIds).toEqual([5, 9]);
    expect(sig?.cohortSize).toBe(2);
    expect(sig?.participantHash).toBe(
      buildCohortSignature([5, 9])?.participantHash,
    );
  });

  it('returns null for an empty cohort (zero nominators AND zero voters)', async () => {
    mockDb.execute.mockResolvedValueOnce([]);

    await expect(loadCohortSignature(asDb(mockDb), 1)).resolves.toBeNull();
    expect(buildCohortSignature([])).toBeNull();
  });
});
