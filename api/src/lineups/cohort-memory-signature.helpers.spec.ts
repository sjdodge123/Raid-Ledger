/**
 * Cohort signature unit tests (ROK-1309 S2, extended by ROK-1538).
 *
 * The signature is the join key between live-written memory rows and the
 * backfill migration, so these properties are load-bearing:
 * order-independence, union dedupe, and the empty-cohort guard.
 *
 * ROK-1538 additionally pins the four SOURCES the roster union reads from.
 * Dropping any one of them (e.g. the invitee branch) still produces a
 * perfectly well-formed hash — it is just a hash of the wrong set, which
 * silently orphans every row the other branches wrote. Only the SQL shape
 * catches that here; the behavioural proof lives in
 * `cohort-memory-write.integration.spec.ts` against a real DB.
 */
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import {
  buildCohortSignature,
  loadCohortSignature,
  loadRosterParticipantIds,
} from './cohort-memory-signature.helpers';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

const asDb = (m: MockDb): Db => m as unknown as Db;
const rows = (...ids: number[]) => ids.map((user_id) => ({ user_id }));

/** Flatten the string chunks of the drizzle `sql` template the mock captured. */
const capturedSql = (mockDb: MockDb): string => {
  const chunks = (
    mockDb.execute.mock.calls[0][0] as { queryChunks?: unknown[] }
  ).queryChunks;
  return (chunks ?? [])
    .map((c) =>
      typeof c === 'object' && c !== null && 'value' in c
        ? String(c.value)
        : '',
    )
    .join(' ');
};

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

  it('returns null for an empty cohort (a lineup id that does not exist)', async () => {
    mockDb.execute.mockResolvedValueOnce([]);

    await expect(loadCohortSignature(asDb(mockDb), 1)).resolves.toBeNull();
    expect(buildCohortSignature([])).toBeNull();
  });

  it('unions all FOUR roster sources: creator, invitees, nominators, voters', async () => {
    mockDb.execute.mockResolvedValueOnce(rows(1, 2));
    await loadRosterParticipantIds(asDb(mockDb), 42);

    const query = capturedSql(mockDb);
    expect(query).toContain('created_by');
    expect(query).toContain('community_lineup_invitees');
    expect(query).toContain('nominated_by');
    expect(query).toContain('community_lineup_votes');
    // A NULL nominator would arrive as Number(null) === 0 and forge a member.
    expect(query).toContain('nominated_by IS NOT NULL');
  });

  it('dedupes a creator who is ALSO rowed as an invitee', async () => {
    // `addInvitees` does not exclude the creator, so the union hands back the
    // same id twice — counting it twice would inflate cohort_size and make
    // this cohort unmatchable (ROK-1444 hit the same bug on participantCount).
    mockDb.execute.mockResolvedValueOnce(rows(7, 7, 11));
    const sig = await loadCohortSignature(asDb(mockDb), 1);

    expect(sig?.participantIds).toEqual([7, 11]);
    expect(sig?.cohortSize).toBe(2);
  });

  it('loadCohortSignature reads the ROSTER, not the engaged set', async () => {
    mockDb.execute.mockResolvedValueOnce(rows(3));
    await loadCohortSignature(asDb(mockDb), 5);

    expect(capturedSql(mockDb)).toContain('community_lineup_invitees');
  });
});
