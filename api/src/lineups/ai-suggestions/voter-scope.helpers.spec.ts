/**
 * Voter scope helpers — unit tests (TDD FAILING, ROK-931).
 *
 * Dev agent implements `voter-scope.helpers.ts` to make these pass. The
 * hash function must be deterministic across insertion order and stable
 * across process restarts (SHA1 of sorted user IDs).
 */
import { computeVoterSetHash, resolveVoterScope } from './voter-scope.helpers';
import * as eligibility from '../lineups-eligibility.helpers';

jest.mock('../lineups-eligibility.helpers');

const mockedLoadInvitees = eligibility.loadInvitees as jest.Mock;

describe('computeVoterSetHash (ROK-931)', () => {
  it('returns the same hash regardless of input order', () => {
    const a = computeVoterSetHash([3, 1, 2]);
    const b = computeVoterSetHash([1, 2, 3]);
    const c = computeVoterSetHash([2, 3, 1]);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('deduplicates repeated user IDs before hashing', () => {
    const withDupes = computeVoterSetHash([1, 2, 2, 3, 3, 3]);
    const unique = computeVoterSetHash([1, 2, 3]);
    expect(withDupes).toBe(unique);
  });

  it('produces different hashes for different voter sets', () => {
    expect(computeVoterSetHash([1, 2])).not.toBe(
      computeVoterSetHash([1, 2, 3]),
    );
    expect(computeVoterSetHash([1, 2, 3])).not.toBe(
      computeVoterSetHash([4, 5, 6]),
    );
  });

  it('returns a stable hash for the empty voter set', () => {
    expect(computeVoterSetHash([])).toBe(computeVoterSetHash([]));
    expect(computeVoterSetHash([])).not.toBe(computeVoterSetHash([1]));
  });

  it('emits a lowercase hex string (SHA1 shape)', () => {
    const hash = computeVoterSetHash([7, 11, 13]);
    expect(hash).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('resolveVoterScope — private lineup (ROK-1412)', () => {
  beforeEach(() => jest.clearAllMocks());

  /** Mock the single query shape `filterToUsersWithVector` uses:
   * `select().from().where()` resolving to taste-vector rows. */
  function makeDb(vectorUserIds: number[]) {
    const where = jest
      .fn()
      .mockResolvedValue(vectorUserIds.map((userId) => ({ userId })));
    const from = jest.fn().mockReturnValue({ where });
    const select = jest.fn().mockReturnValue({ from });
    return { select } as unknown as Parameters<typeof resolveVoterScope>[0];
  }

  it('scopes the voter set to the active invitees returned by loadInvitees', async () => {
    // ROK-1412: loadInvitees inner-joins active users, so its result is
    // already deactivation-filtered — the voter scope inherits that pruning.
    mockedLoadInvitees.mockResolvedValue([20, 21]);
    const db = makeDb([20, 21]);

    const scope = await resolveVoterScope(db, { id: 7, visibility: 'private' });

    expect(mockedLoadInvitees).toHaveBeenCalledWith(db, 7);
    expect([...scope.userIds].sort((a, b) => a - b)).toEqual([20, 21]);
    expect(scope.hash).toBe(computeVoterSetHash([20, 21]));
  });
});
