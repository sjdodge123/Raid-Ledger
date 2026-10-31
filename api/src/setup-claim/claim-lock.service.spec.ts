import {
  CLAIM_LOCK_DURATION_MS,
  CLAIM_LOCK_THRESHOLD,
  CLAIM_LOCK_WINDOW_MS,
  ClaimLockService,
} from './claim-lock.service';

const T0 = new Date('2026-10-30T05:00:00.000Z').getTime();
const MIN = 60 * 1000;

function fail(lock: ClaimLockService, times: number): Date | null {
  let last: Date | null = null;
  for (let i = 0; i < times; i += 1) last = lock.recordFailure();
  return last;
}

describe('ClaimLockService', () => {
  let lock: ClaimLockService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(T0);
    lock = new ClaimLockService();
  });

  afterEach(() => jest.useRealTimers());

  it('pins the ruled numbers: 100 failures / 60 min → 15 min', () => {
    expect(CLAIM_LOCK_THRESHOLD).toBe(100);
    expect(CLAIM_LOCK_WINDOW_MS).toBe(60 * MIN);
    expect(CLAIM_LOCK_DURATION_MS).toBe(15 * MIN);
  });

  it('stays open after 99 failures', () => {
    expect(fail(lock, 99)).toBeNull();
    expect(lock.lockedUntil()).toBeNull();
  });

  it('locks for 15 min on the 100th failure', () => {
    fail(lock, 99);
    const until = lock.recordFailure();
    expect(until?.getTime()).toBe(T0 + 15 * MIN);
    expect(lock.lockedUntil()?.getTime()).toBe(T0 + 15 * MIN);
  });

  it('does not extend the lock on failures while locked', () => {
    fail(lock, 100);
    jest.setSystemTime(T0 + 5 * MIN);
    expect(lock.recordFailure()?.getTime()).toBe(T0 + 15 * MIN);
  });

  it('is still locked 1 ms before the lapse and open at it, window cleared', () => {
    fail(lock, 100);
    jest.setSystemTime(T0 + 15 * MIN - 1);
    expect(lock.lockedUntil()).not.toBeNull();
    jest.setSystemTime(T0 + 15 * MIN);
    expect(lock.lockedUntil()).toBeNull();
    // The window cleared with the lapse: 99 fresh failures do not relock.
    expect(fail(lock, 99)).toBeNull();
    expect(lock.recordFailure()).not.toBeNull();
  });

  it('drops failures 60 min old out of the rolling window', () => {
    fail(lock, 50);
    jest.setSystemTime(T0 + 30 * MIN);
    fail(lock, 49);
    jest.setSystemTime(T0 + 60 * MIN);
    // The first 50 are now exactly 60 min old → out; 49 + 1 = 50 < 100.
    expect(lock.recordFailure()).toBeNull();
    expect(lock.lockedUntil()).toBeNull();
  });

  it('counts failures 1 ms inside the window', () => {
    fail(lock, 50);
    jest.setSystemTime(T0 + 60 * MIN - 1);
    expect(fail(lock, 49)).toBeNull();
    expect(lock.recordFailure()?.getTime()).toBe(T0 + 60 * MIN - 1 + 15 * MIN);
  });

  it('forceLock locks for 15 min; reset clears lock and failures', () => {
    expect(lock.forceLock().getTime()).toBe(T0 + 15 * MIN);
    expect(lock.lockedUntil()).not.toBeNull();
    fail(lock, 10);
    lock.reset();
    expect(lock.lockedUntil()).toBeNull();
    expect(fail(lock, 99)).toBeNull();
  });
});
