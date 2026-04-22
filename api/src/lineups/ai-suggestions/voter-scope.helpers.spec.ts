/**
 * Voter scope helpers — unit tests (TDD FAILING, ROK-931).
 *
 * Dev agent implements `voter-scope.helpers.ts` to make these pass. The
 * hash function must be deterministic across insertion order and stable
 * across process restarts (SHA1 of sorted user IDs).
 */
import { computeVoterSetHash } from './voter-scope.helpers';

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
    expect(computeVoterSetHash([1, 2])).not.toBe(computeVoterSetHash([1, 2, 3]));
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
