/**
 * ROK-1857 — the write listener subscribes the poll lifecycle emits
 * (RESCHEDULING on open, RESCHEDULE_CLEARED on expiry/abort) and routes them
 * to the same event-wide fan-out as UPDATED. Fan-out queries and the enqueue
 * are mocked; the real path is covered by the integration specs.
 */
import type { Queue } from 'bullmq';
import { APP_EVENT_EVENTS } from '../../discord-bot/discord-bot.constants';
import { getCalendarSyncEnabled } from '../../settings/settings-calendar-sync.helpers';
import type { SettingsService } from '../../settings/settings.service';
import { enqueueCalendarWriteJob } from './calendar-write.enqueue.helpers';
import { findEventFanoutKeys } from './calendar-write-fanout.helpers';
import { CalendarWriteListener } from './calendar-write.listener';

jest.mock('../../settings/settings-calendar-sync.helpers', () => ({
  getCalendarSyncEnabled: jest.fn(),
}));
jest.mock('./calendar-write.enqueue.helpers', () => ({
  enqueueCalendarWriteJob: jest.fn(),
}));
jest.mock('./calendar-write-fanout.helpers', () => ({
  findEventFanoutKeys: jest.fn(),
  findEventLinkKeys: jest.fn(),
  findSignupUserId: jest.fn(),
  findUserWriteConnectionIds: jest.fn(),
}));
const syncEnabled = jest.mocked(getCalendarSyncEnabled);
const enqueue = jest.mocked(enqueueCalendarWriteJob);
const fanout = jest.mocked(findEventFanoutKeys);

const DB = { db: true };
const QUEUE = { queue: true } as unknown as Queue;
const KEYS = [
  { connectionId: 1, eventId: 42, userId: 7 },
  { connectionId: 2, eventId: 42, userId: 8 },
];

/** Prototype methods whose @OnEvent metadata names `event`. */
function listenersFor(event: string): string[] {
  const proto = CalendarWriteListener.prototype as unknown as Record<
    string,
    unknown
  >;
  return Object.getOwnPropertyNames(proto).filter((name) => {
    const fn = proto[name];
    if (typeof fn !== 'function') return false;
    const meta: unknown = Reflect.getMetadata('EVENT_LISTENER_METADATA', fn);
    return (
      Array.isArray(meta) &&
      meta.some((m: { event?: unknown }) => m.event === event)
    );
  });
}

function makeListener() {
  return new CalendarWriteListener(
    DB as never,
    {} as SettingsService,
    QUEUE,
  ) as unknown as Record<string, (p: { eventId: number }) => Promise<void>>;
}

beforeEach(() => {
  jest.clearAllMocks();
  syncEnabled.mockResolvedValue(true);
  fanout.mockResolvedValue(KEYS);
  enqueue.mockResolvedValue(undefined as never);
});

describe('CalendarWriteListener — rescheduling poll emits (ROK-1857)', () => {
  it.each([
    [APP_EVENT_EVENTS.RESCHEDULING, 'onEventRescheduling'],
    [APP_EVENT_EVENTS.RESCHEDULE_CLEARED, 'onRescheduleCleared'],
    [APP_EVENT_EVENTS.UPDATED, 'onEventUpdated'],
  ])('%s is subscribed by %s', (event, method) => {
    expect(listenersFor(event)).toEqual([method]);
  });

  it.each([APP_EVENT_EVENTS.RESCHEDULING, APP_EVENT_EVENTS.RESCHEDULE_CLEARED])(
    '%s enqueues one reconcile job per event-wide fan-out key',
    async (event) => {
      const [method] = listenersFor(event);
      const handler = method ? makeListener()[method] : undefined;
      expect(handler).toBeDefined();
      await handler?.call(makeListener(), { eventId: 42 });
      expect(fanout).toHaveBeenCalledWith(DB, 42);
      expect(enqueue.mock.calls.map((c) => c[1])).toEqual(
        KEYS.map((k) => ({ kind: 'reconcile', ...k })),
      );
    },
  );

  it('kill switch off → no fan-out, no enqueue', async () => {
    syncEnabled.mockResolvedValue(false);
    const listener = makeListener();
    await listener.onRescheduleCleared?.call(listener, { eventId: 42 });
    expect(fanout).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
});
