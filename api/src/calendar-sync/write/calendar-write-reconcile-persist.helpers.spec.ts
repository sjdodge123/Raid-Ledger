/**
 * ROK-1596 review m4: `handleFailure` reports exhausted retries to Sentry
 * without the error's message, and `isFinalAttempt` reads BullMQ's counters.
 * The DB writes themselves are covered by
 * `calendar-write-reconcile.integration.spec.ts`.
 */
jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

import * as Sentry from '@sentry/nestjs';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import {
  ProviderRequestError,
  TransientError,
} from '../providers/calendar-provider.errors';
import {
  handleFailure,
  isFinalAttempt,
} from './calendar-write-reconcile-persist.helpers';

const capture = Sentry.captureException as jest.Mock;
const key = { connectionId: 7, eventId: 11, userId: 13 };

/** A query-builder stub: every chain step returns itself, awaits to []. */
function stubDb() {
  const chain: Record<string, unknown> = {};
  for (const m of ['values', 'onConflictDoUpdate', 'set', 'where'])
    chain[m] = jest.fn(() => chain);
  chain.returning = jest.fn(() => Promise.resolve([{ id: 1 }]));
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve([]).then(res);
  const db = { insert: jest.fn(() => chain), update: jest.fn(() => chain) };
  return { db, asDb: db as unknown as PostgresJsDatabase<typeof schema> };
}

beforeEach(() => capture.mockReset());

describe('handleFailure (m4)', () => {
  it('final attempt of a retryable error: records a link, reports a body-free event, rethrows', async () => {
    const { db, asDb } = stubDb();
    const err = new TransientError('http_503');
    err.message = 'Bearer ya29.SECRET {"body":"echoed"}';

    await expect(handleFailure(asDb, key, err, true)).rejects.toBe(err);
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledTimes(1);
    const [event, ctx] = capture.mock.calls[0] as [Error, unknown];
    expect(event.message).toBe('calendar write retries exhausted');
    expect(JSON.stringify([event.message, ctx])).not.toMatch(/SECRET|body/);
    expect(ctx).toEqual({
      tags: { area: 'calendar-write', code: 'transient:http_503' },
      extra: { connectionId: 7, eventId: 11 },
    });
  });

  it('a retryable error before the final attempt: rethrown, nothing written or reported', async () => {
    const { db, asDb } = stubDb();
    const err = new TransientError('http_503');

    await expect(handleFailure(asDb, key, err, false)).rejects.toBe(err);
    expect(db.insert).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it('a permanent 4xx: recorded and swallowed, never reported', async () => {
    const { db, asDb } = stubDb();
    const err = new ProviderRequestError('http_400');

    await expect(handleFailure(asDb, key, err, false)).resolves.toEqual({
      result: 'failed',
      reason: 'rejected:http_400',
    });
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(capture).not.toHaveBeenCalled();
  });
});

describe('isFinalAttempt', () => {
  it.each([
    [{ attemptsMade: 0, opts: { attempts: 6 } }, false],
    [{ attemptsMade: 4, opts: { attempts: 6 } }, false],
    [{ attemptsMade: 5, opts: { attempts: 6 } }, true],
    [{ attemptsMade: 0, opts: {} }, true],
    [{}, true],
  ])('%j → %s', (job, expected) => {
    expect(isFinalAttempt(job)).toBe(expected);
  });
});
