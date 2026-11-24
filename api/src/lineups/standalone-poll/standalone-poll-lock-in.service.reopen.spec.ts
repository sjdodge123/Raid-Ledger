/**
 * ROK-2314 review MAJOR-1: a reschedule lock-in reopens the event's Discord
 * post (through `EVENT_POST_REOPEN_PORT`) BEFORE it emits `POLL_LOCKED_IN`,
 * so the poll → event chat copy never lands on a still-archived thread.
 */
import { createDrizzleMock } from '../../common/testing/drizzle-mock';
import { LINEUP_MATCH_EVENTS } from '../lineups-scheduling-hook.helpers';
import { EVENT_POST_REOPEN_PORT } from './event-post-reopen.port';
import { StandalonePollLockInService } from './standalone-poll-lock-in.service';

jest.mock('./standalone-poll-lockin.helpers', () => ({
  ...jest.requireActual('./standalone-poll-lockin.helpers'),
  runLockInFanout: jest.fn().mockResolvedValue(undefined),
}));

interface Built {
  service: StandalonePollLockInService;
  emit: jest.Mock;
  reopen: jest.Mock;
  get: jest.Mock;
}

function build(
  reopen: jest.Mock = jest.fn().mockResolvedValue(undefined),
): Built {
  const emit = jest.fn();
  const get = jest.fn(() => ({ reopenEventPost: reopen }));
  const service = new StandalonePollLockInService(
    createDrizzleMock() as never,
    { fireUpdateEmbed: jest.fn() } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { emitLifecycleEvent: jest.fn().mockResolvedValue(undefined) } as never,
    { enqueue: jest.fn().mockResolvedValue(undefined) } as never,
    { assertCreate: jest.fn() } as never,
    {} as never,
    { emit } as never,
    { get } as never,
  );
  return { service, emit, reopen, get };
}

const LOCK_IN = {
  matchId: 9,
  eventId: 77,
  startTime: '2099-01-01T19:00:00.000Z',
  creatorId: 4,
};

/** The invocation order of the first POLL_LOCKED_IN emit. */
function lockedInOrder(emit: jest.Mock): number {
  const i = emit.mock.calls.findIndex(
    (c: unknown[]) => c[0] === LINEUP_MATCH_EVENTS.POLL_LOCKED_IN,
  );
  return emit.mock.invocationCallOrder[i] ?? -Infinity;
}

describe('StandalonePollLockInService.afterComplete — reopen before POLL_LOCKED_IN (ROK-2314)', () => {
  it('reopens the linked event post before emitting POLL_LOCKED_IN', async () => {
    const { service, emit, reopen, get } = build();
    await service.afterComplete({ ok: true, linkedEventId: 77 }, LOCK_IN);
    expect(get).toHaveBeenCalledWith(EVENT_POST_REOPEN_PORT, { strict: false });
    expect(reopen).toHaveBeenCalledWith(77);
    expect(reopen.mock.invocationCallOrder[0] ?? Infinity).toBeLessThan(
      lockedInOrder(emit),
    );
  });

  it('awaits the reopen before emitting POLL_LOCKED_IN', async () => {
    let settle: () => void = () => undefined;
    const reopen = jest.fn(
      () => new Promise<void>((resolve) => (settle = resolve)),
    );
    const { service, emit } = build(reopen);
    const done = service.afterComplete(
      { ok: true, linkedEventId: 77 },
      LOCK_IN,
    );
    await Promise.resolve();
    expect(emit).not.toHaveBeenCalled();
    settle();
    await done;
    expect(emit).toHaveBeenCalledWith(LINEUP_MATCH_EVENTS.POLL_LOCKED_IN, {
      matchId: 9,
      eventId: 77,
    });
  });

  it('still emits POLL_LOCKED_IN when the reopen throws', async () => {
    const reopen = jest.fn().mockRejectedValue(new Error('discord down'));
    const { service, emit } = build(reopen);
    await service.afterComplete({ ok: true, linkedEventId: 77 }, LOCK_IN);
    expect(emit).toHaveBeenCalledWith(LINEUP_MATCH_EVENTS.POLL_LOCKED_IN, {
      matchId: 9,
      eventId: 77,
    });
  });

  it('reopens nothing for a fresh (non-reschedule) lock-in', async () => {
    const { service, reopen } = build();
    await service.afterComplete({ ok: true }, LOCK_IN);
    expect(reopen).not.toHaveBeenCalled();
  });
});
