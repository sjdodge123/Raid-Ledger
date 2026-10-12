/**
 * ROK-1593 D7: the read cron's due filter, limit, lease jitter and the
 * kill-switch gate, against a recording db stub (persistence is A9's).
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import type { Queue } from 'bullmq';
import type { CronJobService } from '../../cron-jobs/cron-job.service';
import type { SettingsService } from '../../settings/settings.service';
import type { GameTimeService } from '../../users/game-time.service';
import {
  CalendarReadCron,
  READ_CRON_LIMIT,
  dueReadConnectionFilter,
  leaseReadConnections,
} from './calendar-read.cron';
import {
  busyBlockPruneCutoff,
  ignoredDayPruneCutoff,
} from './calendar-read-purge.helpers';

const NOW = new Date('2026-10-11T12:00:00Z');
const MIN = 60_000;

const strayRows = [{ userId: 9 }, { userId: 9 }, { userId: 11 }];

function recordingDb(dueIds: number[], staleUsers: number[] | Error = []) {
  const calls = { limit: [] as number[], sets: [] as unknown[], deletes: 0 };
  const distinct = {
    from: () => distinct,
    innerJoin: () => distinct,
    where: () => distinct,
    orderBy: () => distinct,
    limit: () =>
      staleUsers instanceof Error
        ? Promise.reject(staleUsers)
        : Promise.resolve(staleUsers.map((userId) => ({ userId }))),
  };
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: (n: number) => {
      calls.limit.push(n);
      return Promise.resolve(dueIds.map((id) => ({ id })));
    },
  };
  const db = {
    select: () => chain,
    selectDistinct: () => distinct,
    update: () => ({
      set: (v: unknown) => {
        calls.sets.push(v);
        return { where: () => Promise.resolve() };
      },
    }),
    delete: () => ({
      where: () => ({
        returning: () => {
          calls.deletes += 1;
          return Promise.resolve(calls.deletes === 3 ? strayRows : []);
        },
      }),
    }),
  };
  return { db, calls };
}

function makeCron(
  dueIds: number[],
  enabled = true,
  staleUsers: number[] | Error = [],
) {
  const { db, calls } = recordingDb(dueIds, staleUsers);
  const invalidated: number[] = [];
  const gameTime = {
    invalidateUserCache: (u: number) => invalidated.push(u),
  };
  const added: string[] = [];
  const queue = {
    getJob: () => Promise.resolve(undefined),
    remove: () => Promise.resolve(0),
    add: (_n: string, _d: unknown, o: { jobId: string }) => {
      added.push(o.jobId);
      return Promise.resolve({});
    },
  };
  const settings = { get: () => Promise.resolve(String(enabled)) };
  const cron = new CalendarReadCron(
    db as never,
    settings as unknown as SettingsService,
    {} as CronJobService,
    queue as unknown as Queue,
    gameTime as unknown as GameTimeService,
  );
  return { cron, calls, added, invalidated };
}

describe('dueReadConnectionFilter', () => {
  const q = new PgDialect().sqlToQuery(
    dueReadConnectionFilter(NOW) ??
      (() => {
        throw new Error('filter missing');
      })(),
  );

  it('requires read on and status active (a failed sync stays active, D5)', () => {
    expect(q.sql).toContain('"read_enabled" = $1');
    expect(q.sql).toMatch(/"status" in \(\$2\)/);
    expect(q.params.slice(0, 2)).toEqual([true, 'active']);
  });

  it('is due when next_sync_at is unset or not after now', () => {
    expect(q.sql).toMatch(
      /\("calendar_connections"\."next_sync_at" is null or "calendar_connections"\."next_sync_at" <= \$3\)/,
    );
    expect(q.params[2]).toBe(NOW.toISOString());
  });
});

describe('CalendarReadCron.run', () => {
  it(`queues each due connection, at most ${READ_CRON_LIMIT} per tick`, async () => {
    const { cron, calls, added } = makeCron([4, 7]);
    await expect(cron.run(NOW, () => 0.5)).resolves.toEqual([4, 7]);
    expect(READ_CRON_LIMIT).toBe(200);
    expect(calls.limit).toEqual([200]);
    expect(added).toEqual(['cal-read-4', 'cal-read-7']);
  });

  it('kill switch off → nothing selected or queued; prunes + stray-absence purge run', async () => {
    const { cron, calls, added, invalidated } = makeCron([4], false, [5]);
    await expect(cron.run(NOW)).resolves.toEqual([]);
    expect(calls.limit).toEqual([]);
    expect(added).toEqual([]);
    // Ended busy blocks + stale ignored days + synced absences.
    expect(calls.deletes).toBe(3);
    expect(invalidated).toEqual([9, 11]);
  });

  it('kill switch on → a derive per user with stale synced absences', async () => {
    const { cron, added, calls, invalidated } = makeCron([4], true, [5, 8]);
    await cron.run(NOW, () => 0.5);
    expect(added).toEqual(['cal-derive-5', 'cal-derive-8', 'cal-read-4']);
    expect(calls.deletes).toBe(2);
    expect(invalidated).toEqual([]);
  });

  it('a failing backstop query still queues the due syncs', async () => {
    const { cron, added } = makeCron([4], true, new Error('statement timeout'));
    await expect(cron.run(NOW, () => 0.5)).resolves.toEqual([4]);
    expect(added).toEqual(['cal-read-4']);
  });

  it('prunes blocks ended more than 24 h ago (before any window start)', () => {
    expect(NOW.getTime() - busyBlockPruneCutoff(NOW).getTime()).toBe(
      24 * 60 * MIN,
    );
  });
});

describe('leaseReadConnections (D7 jitter)', () => {
  it.each([
    [0, 25],
    [0.5, 30],
    [1, 35],
  ])('random %p → next_sync_at = now + %p min', async (r, minutes) => {
    const { db, calls } = recordingDb([]);
    await leaseReadConnections(db as never, [1], NOW, () => r);
    expect(calls.sets).toEqual([
      { nextSyncAt: new Date(NOW.getTime() + minutes * MIN) },
    ]);
  });

  it('keeps ignored days from UTC yesterday on (no zone can still need older)', () => {
    expect(ignoredDayPruneCutoff(NOW)).toBe('2026-10-10');
    expect(ignoredDayPruneCutoff(new Date('2026-10-11T00:30:00Z'))).toBe(
      '2026-10-10',
    );
  });
});
