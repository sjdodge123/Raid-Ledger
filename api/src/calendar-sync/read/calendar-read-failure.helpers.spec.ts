/**
 * Tech debt 2026-10-31: the final-attempt `next_sync_at` honours a provider's
 * `Retry-After` when it is later than the D5 backoff (never sooner).
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import {
  RateLimitError,
  TransientError,
} from '../providers/calendar-provider.errors';
import {
  recordReadSyncFailure,
  type ReadFailureConnection,
} from './calendar-read-failure.helpers';

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-11-01T12:00:00Z');
const CONN: ReadFailureConnection = {
  id: 7,
  lastErrorCode: null,
  lastSyncedAt: new Date('2026-11-01T11:30:00Z'),
  createdAt: new Date('2026-10-01T00:00:00Z'),
};

/** A db whose `update().set()` records the fields it was given. */
function fakeDb() {
  const sets: Array<Record<string, unknown>> = [];
  const db = {
    update: () => ({
      set: (fields: Record<string, unknown>) => {
        sets.push(fields);
        return { where: () => Promise.resolve() };
      },
    }),
  } as unknown as PostgresJsDatabase<typeof schema>;
  return { db, sets };
}

async function finalNextSync(err: Error): Promise<number | undefined> {
  const { db, sets } = fakeDb();
  await recordReadSyncFailure(db, CONN, err, { finalAttempt: true, now: NOW });
  const next = sets[0]?.nextSyncAt;
  return next instanceof Date ? next.getTime() - NOW.getTime() : undefined;
}

describe('recordReadSyncFailure — final attempt next_sync_at', () => {
  it('a transient failure keeps the 1 h backoff', async () => {
    expect(await finalNextSync(new TransientError())).toBe(HOUR);
  });

  it('a Retry-After of 3 h pushes next_sync_at to 3 h, not 1 h', async () => {
    expect(await finalNextSync(new RateLimitError(3 * HOUR))).toBe(3 * HOUR);
  });

  it('a Retry-After shorter than the backoff never syncs sooner', async () => {
    expect(await finalNextSync(new RateLimitError(60_000))).toBe(HOUR);
  });
});
