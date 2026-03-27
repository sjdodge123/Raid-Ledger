import { Logger } from '@nestjs/common';
import { bestEffortInit } from './lifecycle.util';

describe('bestEffortInit', () => {
  let logger: Logger;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    logger = new Logger('TestLabel');
    errorSpy = jest.spyOn(logger, 'error').mockImplementation();
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('executes the callback successfully', async () => {
    const fn = jest.fn().mockResolvedValue(undefined);

    await bestEffortInit('TestInit', logger, fn);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('catches errors and logs them without re-throwing', async () => {
    const error = new Error('DB connection failed');
    const fn = jest.fn().mockRejectedValue(error);

    await expect(
      bestEffortInit('CacheWarm', logger, fn),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      '[bestEffortInit] CacheWarm failed — feature degraded but app continues',
      error.stack,
    );
  });

  it('handles non-Error throwables', async () => {
    const fn = jest.fn().mockRejectedValue('string-error');

    await expect(
      bestEffortInit('StringErr', logger, fn),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      '[bestEffortInit] StringErr failed — feature degraded but app continues',
      'string-error',
    );
  });

  describe('retry behaviour', () => {
    let warnSpy: jest.SpyInstance;

    beforeEach(() => {
      jest.useFakeTimers();
      warnSpy = jest.spyOn(logger, 'warn').mockImplementation();
    });

    afterEach(() => {
      jest.useRealTimers();
      warnSpy.mockRestore();
    });

    /**
     * Helper: advance fake timers through pending retry delays.
     * bestEffortInit uses setTimeout-based backoff internally,
     * so we flush all pending timers after each rejection.
     */
    async function drainRetryTimers(
      pendingCall: Promise<void>,
      retryCount: number,
    ): Promise<void> {
      for (let i = 0; i < retryCount; i++) {
        await jest.advanceTimersByTimeAsync(10_000);
      }
      await pendingCall;
    }

    it('retries on failure and succeeds on 2nd attempt', async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValueOnce(undefined);

      const call = bestEffortInit('Retry', logger, fn, { retries: 2 });
      await drainRetryTimers(call, 1);

      expect(fn).toHaveBeenCalledTimes(2);
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('logs warn on each retry attempt with attempt number', async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new Error('fail-1'))
        .mockRejectedValueOnce(new Error('fail-2'))
        .mockResolvedValueOnce(undefined);

      const call = bestEffortInit('WarnTest', logger, fn, { retries: 3 });
      await drainRetryTimers(call, 2);

      expect(warnSpy).toHaveBeenCalledTimes(2);
      expect(warnSpy).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('attempt 1'),
        expect.anything(),
      );
      expect(warnSpy).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('attempt 2'),
        expect.anything(),
      );
    });

    it('logs error only on final exhaustion', async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new Error('fail-1'))
        .mockRejectedValueOnce(new Error('fail-2'))
        .mockRejectedValueOnce(new Error('final-fail'));

      const call = bestEffortInit('Exhaust', logger, fn, { retries: 2 });
      await drainRetryTimers(call, 2);

      // warn on retries 1 and 2, error only on final exhaustion
      expect(warnSpy).toHaveBeenCalledTimes(2);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith(
        '[bestEffortInit] Exhaust failed — feature degraded but app continues',
        expect.any(String),
      );
    });

    it('uses exponential backoff: 1s, 2s, 4s', async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new Error('fail-1'))
        .mockRejectedValueOnce(new Error('fail-2'))
        .mockRejectedValueOnce(new Error('fail-3'))
        .mockResolvedValueOnce(undefined);

      const call = bestEffortInit('Backoff', logger, fn, { retries: 3 });

      // After initial failure, first retry should wait 1s
      expect(fn).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(999);
      expect(fn).toHaveBeenCalledTimes(1); // not yet
      await jest.advanceTimersByTimeAsync(1);
      expect(fn).toHaveBeenCalledTimes(2); // 1s elapsed

      // Second retry waits 2s
      await jest.advanceTimersByTimeAsync(1_999);
      expect(fn).toHaveBeenCalledTimes(2); // not yet
      await jest.advanceTimersByTimeAsync(1);
      expect(fn).toHaveBeenCalledTimes(3); // 2s elapsed

      // Third retry waits 4s
      await jest.advanceTimersByTimeAsync(3_999);
      expect(fn).toHaveBeenCalledTimes(3); // not yet
      await jest.advanceTimersByTimeAsync(1);
      expect(fn).toHaveBeenCalledTimes(4); // 4s elapsed

      await call;
    });
  });
});
