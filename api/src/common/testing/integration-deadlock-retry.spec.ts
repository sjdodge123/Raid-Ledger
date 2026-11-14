/**
 * Unit spec for the integration reset's deadlock retry (ROK-2196).
 *
 * drizzle-orm 0.45 wraps every driver error in `DrizzleQueryError` and puts
 * the Postgres error (with `code: '40P01'`) on `.cause`, so a check on the
 * top-level `code` alone never fires and the retry was dead code.
 */
import { DrizzleQueryError } from 'drizzle-orm';
import { isDeadlockError, retryOnDeadlock } from './integration-deadlock-retry';

function pgError(code: string): Error {
  return Object.assign(new Error(`pg error ${code}`), { code });
}

function drizzleWrapped(code: string): DrizzleQueryError {
  return new DrizzleQueryError('DO $x$ … $x$', [], pgError(code));
}

describe('isDeadlockError', () => {
  it('recognises a bare Postgres 40P01 error', () => {
    expect(isDeadlockError(pgError('40P01'))).toBe(true);
  });

  it('recognises a 40P01 wrapped by drizzle in DrizzleQueryError.cause', () => {
    expect(isDeadlockError(drizzleWrapped('40P01'))).toBe(true);
  });

  it('rejects other codes, wrapped or bare, and non-errors', () => {
    expect(isDeadlockError(drizzleWrapped('23505'))).toBe(false);
    expect(isDeadlockError(pgError('23505'))).toBe(false);
    expect(isDeadlockError(new Error('plain'))).toBe(false);
    expect(isDeadlockError('40P01')).toBe(false);
    expect(isDeadlockError(null)).toBe(false);
  });
});

describe('retryOnDeadlock', () => {
  it('retries a drizzle-wrapped deadlock and then succeeds', async () => {
    const fn = jest
      .fn<Promise<void>, []>()
      .mockRejectedValueOnce(drizzleWrapped('40P01'))
      .mockResolvedValueOnce(undefined);
    const outcome = await retryOnDeadlock(fn, { baseDelayMs: 0 }).then(
      () => 'resolved',
      () => 'rejected',
    );
    expect(fn).toHaveBeenCalledTimes(2);
    expect(outcome).toBe('resolved');
  });

  it('rethrows a non-deadlock error without retrying', async () => {
    const err = drizzleWrapped('23505');
    const fn = jest.fn<Promise<void>, []>().mockRejectedValue(err);
    await expect(retryOnDeadlock(fn, { baseDelayMs: 0 })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after maxRetries attempts and rethrows the last deadlock', async () => {
    const err = drizzleWrapped('40P01');
    const fn = jest.fn<Promise<void>, []>().mockRejectedValue(err);
    await expect(
      retryOnDeadlock(fn, { baseDelayMs: 0, maxRetries: 3 }),
    ).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
