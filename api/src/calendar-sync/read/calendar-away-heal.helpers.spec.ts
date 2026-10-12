/**
 * ROK-1593 PR-B review MAJOR-1/2: the self-heal helpers against a recording
 * db stub (the SQL itself is proven in `calendar-away-heal.integration.spec.ts`).
 */
import type { CalendarReadQueue } from './calendar-read.enqueue.helpers';
import {
  deriveIfNeedsReconnect,
  enqueueDerivesBestEffort,
  purgeStrayCalendarAbsences,
  utcYesterday,
} from './calendar-away-heal.helpers';

function queueStub(failFor: number[] = []) {
  const added: string[] = [];
  const queue = {
    getJob: () => Promise.resolve(undefined),
    remove: () => Promise.resolve(0),
    add: (_n: string, d: { userId: number }, o: { jobId: string }) => {
      if (failFor.includes(d.userId)) return Promise.reject(new Error('redis'));
      added.push(o.jobId);
      return Promise.resolve({});
    },
  };
  return { queue: queue as unknown as CalendarReadQueue, added };
}

function selectDb(rows: unknown[] | Error) {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () =>
      rows instanceof Error ? Promise.reject(rows) : Promise.resolve(rows),
  };
  return { select: () => chain } as never;
}

describe('enqueueDerivesBestEffort', () => {
  it('a failed enqueue is skipped; the rest are still queued', async () => {
    const { queue, added } = queueStub([2]);
    await enqueueDerivesBestEffort(queue, [1, 2, 3], 'test');
    expect(added).toEqual(['cal-derive-1', 'cal-derive-3']);
  });
});

describe('deriveIfNeedsReconnect (MAJOR-2 b)', () => {
  it('connection now needs_reconnect → a derive for its owner', async () => {
    const { queue, added } = queueStub();
    await deriveIfNeedsReconnect(selectDb([{ userId: 4 }]), queue, 10);
    expect(added).toEqual(['cal-derive-4']);
  });

  it('connection still active (no row matched) → nothing queued', async () => {
    const { queue, added } = queueStub();
    await deriveIfNeedsReconnect(selectDb([]), queue, 10);
    expect(added).toEqual([]);
  });

  it('a failing lookup never throws into the write job', async () => {
    const { queue, added } = queueStub();
    await expect(
      deriveIfNeedsReconnect(selectDb(new Error('db down')), queue, 10),
    ).resolves.toBeUndefined();
    expect(added).toEqual([]);
  });
});

describe('purgeStrayCalendarAbsences (MAJOR-1)', () => {
  it('returns each touched user once', async () => {
    const rows = [{ userId: 2 }, { userId: 2 }, { userId: 6 }];
    const db = {
      delete: () => ({
        where: () => ({ returning: () => Promise.resolve(rows) }),
      }),
    } as never;
    await expect(purgeStrayCalendarAbsences(db)).resolves.toEqual([2, 6]);
  });
});

describe('utcYesterday (review r2 N2 backstop floor)', () => {
  it('is the UTC calendar day before now, whatever the hour', () => {
    expect(utcYesterday(new Date('2026-10-12T00:30:00Z'))).toBe('2026-10-11');
    expect(utcYesterday(new Date('2026-10-12T23:59:00Z'))).toBe('2026-10-11');
    expect(utcYesterday(new Date('2026-03-01T12:00:00Z'))).toBe('2026-02-28');
  });
});
