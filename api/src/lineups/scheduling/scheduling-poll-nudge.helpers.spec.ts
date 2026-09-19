/**
 * Unit tests for the two helpers the organiser "Rally" nudge shares with the
 * recurring cron nudge (ROK-1618).
 *
 * `scheduling-poll-nudge.integration.spec.ts` remains the cron path's
 * behavioural guard against a real database; these cases pin the parts the
 * rally newly depends on and that a DB test cannot see cheaply — that
 * `loadNudgePollById` runs the SAME nudgeable-poll SQL narrowed to one match,
 * and that `sendPollNudge` uses the SHARED per-member dedup key so a rally can
 * never out-spam the cron (D2).
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { POLL_NUDGE_TTL_SECONDS } from '../lineup-notification.constants';
import {
  loadNudgePollById,
  sendPollNudge,
  type NudgePoll,
  type PollNudgeDeps,
} from './scheduling-poll-nudge.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** A db double whose only job is to capture and answer `execute`. */
function mockDb(rows: unknown[]): { db: Db; execute: jest.Mock } {
  const execute = jest.fn().mockResolvedValue(rows);
  return { db: { execute } as unknown as Db, execute };
}

/** One row as the nudgeable-polls query returns it. */
function pollRow(overrides: Record<string, unknown> = {}) {
  return {
    lineupId: 4,
    matchId: 9,
    gameName: 'Valheim',
    hasFutureSlots: true,
    hadSlots: true,
    inDeadlineHandoff: false,
    ...overrides,
  };
}

function poll(overrides: Partial<NudgePoll> = {}): NudgePoll {
  return {
    lineupId: 4,
    matchId: 9,
    gameName: 'Valheim',
    hasFutureSlots: true,
    hadSlots: true,
    inDeadlineHandoff: false,
    ...overrides,
  };
}

describe('loadNudgePollById', () => {
  it('narrows the shared nudgeable-polls query to one match', async () => {
    const { db, execute } = mockDb([pollRow()]);

    await loadNudgePollById(db, 9);

    const query = execute.mock.calls[0][0] as { queryChunks?: unknown[] };
    const rendered = JSON.stringify(query.queryChunks ?? query);
    // The eligibility predicates the cron relies on must still be there…
    expect(rendered).toContain('clm.status');
    expect(rendered).toContain('hasFutureSlots');
    // …plus the single-match narrowing.
    expect(rendered).toContain('clm.id =');
  });

  it('maps the row the same way the cron listing does', async () => {
    const { db } = mockDb([pollRow({ hasFutureSlots: false, hadSlots: true })]);

    const found = await loadNudgePollById(db, 9);

    expect(found).toEqual({
      lineupId: 4,
      matchId: 9,
      gameName: 'Valheim',
      hasFutureSlots: false,
      hadSlots: true,
      inDeadlineHandoff: false,
    });
  });

  it('returns null when the match is not (or no longer) nudgeable', async () => {
    const { db } = mockDb([]);

    await expect(loadNudgePollById(db, 9)).resolves.toBeNull();
  });
});

/** Notification + dedup doubles, with the mocks exposed for assertions. */
function deps(alreadySent: boolean, created: unknown = { id: 1 }) {
  const checkAndMarkSent = jest.fn().mockResolvedValue(alreadySent);
  const create = jest.fn().mockResolvedValue(created);
  return {
    value: {
      notificationService: { create },
      dedupService: { checkAndMarkSent },
    } as unknown as PollNudgeDeps,
    checkAndMarkSent,
    create,
  };
}

describe('sendPollNudge', () => {
  it('marks the SHARED per-member key at the 24h nudge TTL', async () => {
    const d = deps(false);

    await sendPollNudge(d.value, poll(), 42);

    expect(d.checkAndMarkSent).toHaveBeenCalledWith(
      'sched-poll-nudge:9:42',
      POLL_NUDGE_TTL_SECONDS,
    );
  });

  it('creates the poll-nudge notification with the cron payload', async () => {
    const d = deps(false);

    const result = await sendPollNudge(d.value, poll(), 42);

    expect(result).toEqual({ dispatched: true, created: true });
    expect(d.create).toHaveBeenCalledWith({
      userId: 42,
      type: 'community_lineup',
      title: 'Scheduling poll waiting on you',
      message:
        'The group still needs your availability for Valheim — ' +
        'vote on a time so the poll can lock in.',
      payload: {
        subtype: 'scheduling_poll_nudge',
        reminderWindow: 'poll-9',
        lineupId: 4,
        matchId: 9,
        gameName: 'Valheim',
      },
    });
  });

  it('sends nothing when the member was already nudged this window', async () => {
    const d = deps(true);

    const result = await sendPollNudge(d.value, poll(), 42);

    expect(result).toEqual({ dispatched: false, created: false });
    expect(d.create).not.toHaveBeenCalled();
  });

  it('reports created=false when preferences suppressed the notification', async () => {
    const d = deps(false, null);

    const result = await sendPollNudge(d.value, poll(), 42);

    // `dispatched` stays true: the dedup key IS burnt, which is exactly the
    // cron's pre-existing behaviour and must not change.
    expect(result).toEqual({ dispatched: true, created: false });
  });

  it('uses the stalled-poll copy when no proposed day is still future', async () => {
    const d = deps(false);

    await sendPollNudge(d.value, poll({ hasFutureSlots: false }), 42);

    expect(d.create.mock.calls[0][0].title).toBe(
      'Scheduling poll needs new times',
    );
  });

  it('lets a dispatch failure propagate to the caller', async () => {
    const d = deps(false);
    d.create.mockRejectedValue(new Error('discord down'));

    await expect(sendPollNudge(d.value, poll(), 42)).rejects.toThrow(
      'discord down',
    );
  });
});
