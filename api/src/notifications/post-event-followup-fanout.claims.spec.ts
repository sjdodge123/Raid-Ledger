/**
 * ROK-1832 (Codex r3 + r8): the follow-up quick-sign-up DMs claim each
 * recipient's per-(user, event) notice key BEFORE sending, so whichever of the
 * follow-up fan-out and the scheduler's deferred group notice (no
 * `followupForEventId`) reaches a user first wins and the other skips them.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { runFollowupFanout } from './post-event-followup-fanout.helpers';
import { resolvePostEventFollowupRecipients } from './post-event-followup.helpers';
import {
  eventNoticeKey,
  sendClaimedEventNotice,
} from './event-notice-plan.helpers';
import type { FollowupFanoutDeps } from './post-event-followup-fanout.helpers';
import type {
  CreateNotificationInput,
  NotificationDto,
} from './notification.types';

jest.mock('./post-event-followup.helpers', () => ({
  resolvePostEventFollowupRecipients: jest.fn(),
}));
const recipients = jest.mocked(resolvePostEventFollowupRecipients);
const dialect = new PgDialect();

/** The row `createMany` returns for an input it actually created. */
function asCreated(i: CreateNotificationInput, n: number): NotificationDto {
  const { userId, type, title, message } = i;
  return { id: String(n), userId, type, title, message, createdAt: '' };
}

/** A dedup service over the same fake table (first claim wins). */
function dedupOver(held: Set<string>) {
  return {
    checkAndMarkSent: jest.fn((key: string) => {
      const had = held.has(key);
      held.add(key);
      return Promise.resolve(had);
    }),
    releaseKey: jest.fn(),
  };
}

/** A fake `notification_dedup` table: `held` is the set of claimed keys. */
function setup(held: Set<string> = new Set()) {
  const execute = jest.fn((q: SQL) => {
    const { sql: text, params } = dialect.sqlToQuery(q);
    if (text.includes('SET attendees_notified_at = now()')) {
      return Promise.resolve([{ id: 1 }]);
    }
    if (text.includes('SELECT id, title, creator_id')) {
      return Promise.resolve([{ id: 10, title: 'Raid', creator_id: 9 }]);
    }
    if (text.includes('DELETE FROM notification_dedup')) {
      params.forEach((k) => held.delete(String(k)));
      return Promise.resolve([]);
    }
    if (text.includes('INSERT INTO notification_dedup')) {
      const keys = params.map(String).filter((p) => p.startsWith('event-'));
      const won = keys.filter((k) => !held.has(k));
      won.forEach((k) => held.add(k));
      return Promise.resolve(won.map((dedup_key) => ({ dedup_key })));
    }
    return Promise.resolve([]);
  });
  const createMany = jest.fn((inputs: CreateNotificationInput[]) =>
    Promise.resolve(inputs.map(asCreated)),
  );
  const db = { execute } as unknown as FollowupFanoutDeps['db'];
  return {
    execute,
    createMany,
    deps: { db, notificationService: { createMany } },
  };
}

function sentTo(createMany: jest.Mock): number[] {
  const [inputs] = createMany.mock.calls[0] as [CreateNotificationInput[]];
  return inputs.map((i) => i.userId);
}

function claimCallIndex(execute: jest.Mock): number {
  return execute.mock.calls.findIndex(([q]: [SQL]) =>
    dialect.sqlToQuery(q).sql.includes('INSERT INTO notification_dedup'),
  );
}

describe('runFollowupFanout — per-(user, event) notice claims', () => {
  beforeEach(() => recipients.mockResolvedValue([11, 22]));

  it('claims each recipient for the follow-up event before sending', async () => {
    const s = setup();
    await runFollowupFanout(s.deps, 10, { eventId: 55 }, 9);
    const claimAt = claimCallIndex(s.execute);
    expect(claimAt).toBeGreaterThanOrEqual(0);
    const claimOrder = s.execute.mock.invocationCallOrder[claimAt] ?? Infinity;
    const sendOrder = s.createMany.mock.invocationCallOrder[0] ?? -Infinity;
    expect(claimOrder).toBeLessThan(sendOrder);
    expect(sentTo(s.createMany)).toEqual([11, 22]);
  });

  it('skips a recipient the scheduler group notice already claimed', async () => {
    const s = setup(new Set([eventNoticeKey(55, 11)]));
    await runFollowupFanout(s.deps, 10, { eventId: 55 }, 9);
    expect(sentTo(s.createMany)).toEqual([22]);
  });

  it('a later group notice skips the recipients the follow-up claimed', async () => {
    const held = new Set<string>();
    const s = setup(held);
    await runFollowupFanout(s.deps, 10, { eventId: 55 }, 9);
    const dedup = {
      checkAndMarkSent: jest.fn((key: string) =>
        Promise.resolve(held.has(key)),
      ),
      releaseKey: jest.fn(),
    };
    const send = jest.fn().mockResolvedValue({});
    expect(await sendClaimedEventNotice(dedup, 55, 11, send)).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('gives the claims back when the send fails', async () => {
    const s = setup();
    s.createMany.mockRejectedValue(new Error('boom'));
    await expect(
      runFollowupFanout(s.deps, 10, { eventId: 55 }, 9),
    ).rejects.toThrow('boom');
    const deletes = s.execute.mock.calls
      .map(([q]: [SQL]) => dialect.sqlToQuery(q))
      .filter((r) => r.sql.includes('DELETE FROM notification_dedup'));
    expect(deletes.flatMap((r) => r.params)).toEqual([
      eventNoticeKey(55, 11),
      eventNoticeKey(55, 22),
    ]);
  });

  it('claims nothing on the poll path (no follow-up event yet)', async () => {
    const s = setup();
    await runFollowupFanout(
      s.deps,
      10,
      { lineupId: 1, matchId: 2, subtype: 'post_event_poll' },
      9,
    );
    expect(claimCallIndex(s.execute)).toBe(-1);
    expect(sentTo(s.createMany)).toEqual([11, 22]);
  });
});

describe('runFollowupFanout — claims kept only for notified recipients (Codex r9)', () => {
  beforeEach(() => recipients.mockResolvedValue([11, 22]));

  it('keeps the claim of every recipient it notified', async () => {
    const held = new Set<string>();
    const s = setup(held);
    await runFollowupFanout(s.deps, 10, { eventId: 55 }, 9);
    expect([...held]).toEqual([eventNoticeKey(55, 11), eventNoticeKey(55, 22)]);
  });

  it('releases the claim of a recipient createMany filtered out (Codex r9)', async () => {
    const held = new Set<string>();
    const s = setup(held);
    s.createMany.mockImplementation((inputs: CreateNotificationInput[]) =>
      Promise.resolve(inputs.filter((i) => i.userId !== 22).map(asCreated)),
    );
    await runFollowupFanout(s.deps, 10, { eventId: 55 }, 9);
    expect([...held]).toEqual([eventNoticeKey(55, 11)]);
    const send = jest.fn().mockResolvedValue({});
    expect(await sendClaimedEventNotice(dedupOver(held), 55, 22, send)).toBe(
      true,
    );
    expect(send).toHaveBeenCalledTimes(1);
  });
});
