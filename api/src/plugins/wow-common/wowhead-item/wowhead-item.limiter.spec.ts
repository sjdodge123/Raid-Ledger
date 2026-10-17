import {
  createWowheadLimiter,
  errorRetryOffsetMs,
  retryDelayMs,
} from './wowhead-item.limiter';

const HOUR = 3_600_000;

describe('createWowheadLimiter (fake timers)', () => {
  beforeEach(() => jest.useFakeTimers({ now: 0 }));
  afterEach(() => jest.useRealTimers());

  it('spaces task starts at least minIntervalMs apart', async () => {
    const limiter = createWowheadLimiter({ minIntervalMs: 1000 });
    const starts: number[] = [];
    const task = () => {
      starts.push(Date.now());
      return Promise.resolve();
    };
    const all = Promise.all([1, 2, 3].map(() => limiter.schedule(task)));
    await jest.advanceTimersByTimeAsync(5000);
    await all;
    expect(starts).toEqual([0, 1000, 2000]);
  });

  it('does not start the second task before the interval elapses', async () => {
    const limiter = createWowheadLimiter({ minIntervalMs: 1000 });
    const ran: string[] = [];
    void limiter.schedule(() => Promise.resolve(ran.push('a')));
    void limiter.schedule(() => Promise.resolve(ran.push('b')));
    await jest.advanceTimersByTimeAsync(999);
    expect(ran).toEqual(['a']);
    await jest.advanceTimersByTimeAsync(1);
    expect(ran).toEqual(['a', 'b']);
  });

  it('runs serially: a slow task holds the queue until it settles', async () => {
    const limiter = createWowheadLimiter({ minIntervalMs: 1000 });
    const starts: number[] = [];
    const slow = () => {
      starts.push(Date.now());
      return new Promise<void>((r) => setTimeout(r, 3000));
    };
    const fast = () => {
      starts.push(Date.now());
      return Promise.resolve();
    };
    const both = Promise.all([limiter.schedule(slow), limiter.schedule(fast)]);
    await jest.advanceTimersByTimeAsync(5000);
    await both;
    expect(starts).toEqual([0, 3000]);
  });

  it('a rejected task does not stall the queue', async () => {
    const limiter = createWowheadLimiter({ minIntervalMs: 1000 });
    const failed = limiter.schedule(() => Promise.reject(new Error('boom')));
    const next = limiter.schedule(() => Promise.resolve('ok'));
    const failedCheck = expect(failed).rejects.toThrow('boom');
    await jest.advanceTimersByTimeAsync(1000);
    await failedCheck;
    await expect(next).resolves.toBe('ok');
    expect(limiter.pending()).toBe(0);
  });

  it('does not wait when the interval already passed', async () => {
    const limiter = createWowheadLimiter({ minIntervalMs: 1000 });
    await limiter.schedule(() => Promise.resolve());
    jest.setSystemTime(5000);
    const starts: number[] = [];
    await limiter.schedule(() => Promise.resolve(starts.push(Date.now())));
    expect(starts).toEqual([5000]);
  });
});

describe('backoff schedule', () => {
  it('in-run retry delay doubles per attempt and caps at 60 s', () => {
    expect([0, 1, 2, 5, 6, 10].map(retryDelayMs)).toEqual([
      1000, 2000, 4000, 32000, 60000, 60000,
    ]);
  });

  it('error re-probe offset doubles in hours and caps at 24 h', () => {
    expect([1, 2, 4, 5, 9].map(errorRetryOffsetMs)).toEqual([
      2 * HOUR,
      4 * HOUR,
      16 * HOUR,
      24 * HOUR,
      24 * HOUR,
    ]);
  });
});
