/**
 * Unit tests for the ROK-1438 lock-key derivation.
 *
 * The lock itself needs a real database (see games-name-lock.integration.spec.ts);
 * what's unit-testable here is the property that prevents two overlapping
 * batches from deadlocking — every caller derives the SAME sorted key list for
 * the same set of names.
 */
import {
  buildGameNameLockKeys,
  GAMES_NAME_LOCK_CLASS,
} from './games-name-lock.helpers';

describe('buildGameNameLockKeys', () => {
  it('accepts a bare string as a one-name list', () => {
    expect(buildGameNameLockKeys('Metro Exodus')).toEqual(['metro exodus']);
  });

  it('collapses names that normalize to the same key', () => {
    // "Slay the Spire II" and "Slay the Spire 2" are the ROK-1113 dedup pair —
    // they must contend on ONE lock, not two.
    expect(
      buildGameNameLockKeys(['Slay the Spire II', 'Slay the Spire 2']),
    ).toHaveLength(1);
  });

  it('returns keys in a stable sorted order regardless of input order', () => {
    const a = buildGameNameLockKeys(['Metro Exodus', 'Deep Rock', 'Anno 1800']);
    const b = buildGameNameLockKeys(['Deep Rock', 'Anno 1800', 'Metro Exodus']);
    // This is the deadlock guard: two batches sharing a subset of titles
    // acquire that subset in the same order, so no cycle can form.
    expect(a).toEqual(b);
    expect(a).toEqual([...a].sort());
  });

  it('drops names that normalize to nothing', () => {
    expect(buildGameNameLockKeys(['', '   '])).toEqual([]);
  });

  it('pins the advisory-lock namespace', () => {
    // Changing this silently would let an in-flight deploy run two app
    // versions locking on different classids — i.e. no mutual exclusion.
    expect(GAMES_NAME_LOCK_CLASS).toBe(1438);
  });
});
