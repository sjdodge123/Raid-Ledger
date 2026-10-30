/**
 * ROK-1917 Codex P2 — an exact duplicate pull keeps its FIRST reporter
 * (`ON CONFLICT DO NOTHING`). The raid-progress trust filter (Q1) reads that
 * reporter, so a pull would vanish once its first reporter left the roster
 * even though a current member re-imported it. The rule: a re-import claims
 * the pull only when the stored reporter is untrusted AND the importer is
 * trusted — an outsider can never take a pull from a trusted reporter.
 */
import { pickReassignable, shouldReassign } from './addon-import-raid.reassign';

const ROSTER = new Set([1, 2]);

describe('shouldReassign (ROK-1917 P2)', () => {
  it('moves a pull from a reporter who left the roster to a current member', () => {
    expect(shouldReassign(9, 1, ROSTER)).toBe(true);
  });

  it('never moves a pull from a trusted reporter, even to another member', () => {
    expect(shouldReassign(2, 1, ROSTER)).toBe(false);
  });

  it('never moves a pull to an importer who is not on the roster', () => {
    expect(shouldReassign(9, 8, ROSTER)).toBe(false);
    expect(shouldReassign(2, 8, ROSTER)).toBe(false);
  });

  it('keeps a since-deleted reporter (NULL) — Q1 already trusts it', () => {
    expect(shouldReassign(null, 1, ROSTER)).toBe(false);
  });

  it('is a no-op when the importer already owns the pull', () => {
    expect(shouldReassign(1, 1, ROSTER)).toBe(false);
  });
});

describe('pickReassignable (ROK-1917 P2)', () => {
  it('returns only the ids of pulls whose reporter left the roster', () => {
    const rows = [
      { id: 10, reportedByUserId: 9 },
      { id: 11, reportedByUserId: 2 },
      { id: 12, reportedByUserId: null },
      { id: 13, reportedByUserId: 7 },
    ];
    expect(pickReassignable(rows, 1, ROSTER)).toEqual([10, 13]);
  });

  it('returns nothing for an outsider importer', () => {
    const rows = [{ id: 10, reportedByUserId: 9 }];
    expect(pickReassignable(rows, 8, ROSTER)).toEqual([]);
  });
});
