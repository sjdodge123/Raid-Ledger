/**
 * ROK-1832 (Codex r3): the follow-up quick-sign-up DMs claim each recipient's
 * per-(user, event) notice key at send time, so the scheduler's later deferred
 * group announce (no `followupForEventId`) cannot notice them a second time.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { runFollowupFanout } from './post-event-followup-fanout.helpers';
import { resolvePostEventFollowupRecipients } from './post-event-followup.helpers';
import { eventNoticeKey } from './event-notice-plan.helpers';
import type { FollowupFanoutDeps } from './post-event-followup-fanout.helpers';

jest.mock('./post-event-followup.helpers', () => ({
  resolvePostEventFollowupRecipients: jest.fn(),
}));
const recipients = jest.mocked(resolvePostEventFollowupRecipients);
const dialect = new PgDialect();

function setup(): {
  execute: jest.Mock;
  createMany: jest.Mock;
  deps: FollowupFanoutDeps;
} {
  const execute = jest
    .fn()
    .mockResolvedValueOnce([{ id: 1 }]) // claimFanout
    .mockResolvedValueOnce([{ id: 10, title: 'Raid', creator_id: 9 }])
    .mockResolvedValue([]);
  const createMany = jest.fn().mockResolvedValue(undefined);
  const db = { execute } as unknown as FollowupFanoutDeps['db'];
  return {
    execute,
    createMany,
    deps: { db, notificationService: { createMany } },
  };
}

function renderedParams(execute: jest.Mock): unknown[] {
  return execute.mock.calls.flatMap(
    ([q]: [SQL]) => dialect.sqlToQuery(q).params,
  );
}

describe('runFollowupFanout — per-(user, event) notice claims', () => {
  beforeEach(() => recipients.mockResolvedValue([11, 22]));

  it('claims each recipient for the follow-up event after sending', async () => {
    const s = setup();
    await runFollowupFanout(s.deps, 10, { eventId: 55 }, 9);
    expect(s.createMany).toHaveBeenCalledTimes(1);
    const params = renderedParams(s.execute);
    expect(params).toContain(eventNoticeKey(55, 11));
    expect(params).toContain(eventNoticeKey(55, 22));
  });

  it('claims nothing on the poll path (no follow-up event yet)', async () => {
    const s = setup();
    await runFollowupFanout(
      s.deps,
      10,
      { lineupId: 1, matchId: 2, subtype: 'post_event_poll' },
      9,
    );
    const params = renderedParams(s.execute).map(String);
    expect(params.some((p) => p.startsWith('event-notice:'))).toBe(false);
  });
});
