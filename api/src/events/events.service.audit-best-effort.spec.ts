/**
 * A failed activity-log write after a cancel / reschedule has committed must
 * not turn the request into a 500, and the reschedule must still run its
 * postMutate (re-fetch + APP_EVENT emit → embed refresh).
 */
import { Test } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as Sentry from '@sentry/nestjs';
import type { EventResponseDto } from '@raid-ledger/contract';
import { EventsService } from './events.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { AvailabilityService } from '../availability/availability.service';
import { NotificationService } from '../notifications/notification.service';
import { NotificationDedupService } from '../notifications/notification-dedup.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { SettingsService } from '../settings/settings.service';
import { APP_EVENT_EVENTS } from '../discord-bot/discord-bot.constants';
import { emitEventLifecycle } from './event-create-flow.helpers';
import { cancelEvent, rescheduleEvent } from './event-lifecycle.helpers';

jest.mock('@sentry/nestjs', () => ({
  ...jest.requireActual<object>('@sentry/nestjs'),
  captureException: jest.fn(),
}));
jest.mock('./event-lifecycle.helpers', () => ({
  ...jest.requireActual<object>('./event-lifecycle.helpers'),
  cancelEvent: jest.fn().mockResolvedValue(undefined),
  rescheduleEvent: jest.fn().mockResolvedValue(undefined),
}));
// findOne → findOneEvent + mapEventToResponse; stub both to the seeded event.
jest.mock('./event-find.helpers', () => ({
  ...jest.requireActual<object>('./event-find.helpers'),
  findOneEvent: jest.fn().mockResolvedValue({}),
}));
jest.mock('./event-response.helpers', () => ({
  ...jest.requireActual<object>('./event-response.helpers'),
  mapEventToResponse: jest.fn(() => ({ ...mockEventStub })),
}));
jest.mock('./event-create-flow.helpers', () => ({
  ...jest.requireActual<object>('./event-create-flow.helpers'),
  emitEventLifecycle: jest.fn(),
}));

const captureException = jest.mocked(Sentry.captureException);
const emitLifecycle = jest.mocked(emitEventLifecycle);
const auditErr = new Error('audit insert failed');
// `mock` prefix: read lazily inside the hoisted jest.mock factory above.
const mockEventStub = {
  id: 7,
  startTime: '2026-02-10T18:00:00.000Z',
} satisfies Partial<EventResponseDto>;
const eventStub = mockEventStub;

async function build() {
  const activityLog = { log: jest.fn().mockRejectedValue(auditErr) };
  const mod = await Test.createTestingModule({
    providers: [
      EventsService,
      { provide: DrizzleAsyncProvider, useValue: {} },
      { provide: AvailabilityService, useValue: {} },
      { provide: NotificationService, useValue: {} },
      { provide: NotificationDedupService, useValue: {} },
      { provide: SettingsService, useValue: {} },
      { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      { provide: ActivityLogService, useValue: activityLog },
    ],
  }).compile();
  return { service: mod.get(EventsService), activityLog };
}

describe('EventsService — best-effort audit after a landed mutation', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => errorSpy.mockRestore());

  it('cancel resolves with the event and reports the failed audit', async () => {
    const { service, activityLog } = await build();
    await expect(
      service.cancel(7, 3, false, { reason: 'sick' }),
    ).resolves.toEqual(eventStub);
    expect(jest.mocked(cancelEvent)).toHaveBeenCalledTimes(1);
    expect(activityLog.log).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(auditErr, {
      tags: { activityLog: 'event_cancelled' },
    });
    expect(emitLifecycle).toHaveBeenCalledWith(
      expect.anything(),
      APP_EVENT_EVENTS.CANCELLED,
      eventStub,
    );
  });

  it('reschedule resolves, still runs postMutate and reports the failed audit', async () => {
    const { service, activityLog } = await build();
    const dto = {
      startTime: '2026-02-11T18:00:00.000Z',
      endTime: '2026-02-11T20:00:00.000Z',
    };
    await expect(service.reschedule(7, 3, false, dto)).resolves.toEqual(
      eventStub,
    );
    expect(jest.mocked(rescheduleEvent)).toHaveBeenCalledTimes(1);
    expect(activityLog.log).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(auditErr, {
      tags: { activityLog: 'event_rescheduled' },
    });
    expect(emitLifecycle).toHaveBeenCalledWith(
      expect.anything(),
      APP_EVENT_EVENTS.UPDATED,
      eventStub,
    );
  });
});
