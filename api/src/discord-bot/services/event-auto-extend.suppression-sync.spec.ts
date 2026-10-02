/**
 * ROK-1696: a suppressed Quick Play join that writes `extended_until`
 * forward must reach the same consumers as the auto-extend cron — the
 * active-event cache, web clients and the Discord scheduled event — even
 * when the admin auto-extend toggle is OFF.
 */
import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EventAutoExtendService } from './event-auto-extend.service';
import { SettingsService } from '../../settings/settings.service';
import { VoiceAttendanceService } from './voice-attendance.service';
import { ScheduledEventService } from './scheduled-event.service';
import { AdHocNotificationService } from './ad-hoc-notification.service';
import { AdHocEventsGateway } from '../../events/ad-hoc-events.gateway';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as fanOut from './event-end-time-fanout.helpers';
import {
  SUPPRESSION_WINDOW_EVENTS,
  type SuppressionWindowExtendedPayload,
} from './suppression-window-events';

interface SyncCtx {
  service: EventAutoExtendService;
  settingsService: jest.Mocked<SettingsService>;
  scheduledEventService: jest.Mocked<ScheduledEventService>;
  adHocNotificationService: jest.Mocked<AdHocNotificationService>;
  adHocGateway: jest.Mocked<AdHocEventsGateway>;
  eventCache: { invalidate: jest.Mock; refresh: jest.Mock };
  mockDb: { select: jest.Mock; update: jest.Mock };
}

async function buildModule(): Promise<SyncCtx> {
  const mockDb = { select: jest.fn(), update: jest.fn() };
  const eventCache = {
    invalidate: jest.fn(),
    refresh: jest.fn().mockResolvedValue(undefined),
  };
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      EventAutoExtendService,
      { provide: DrizzleAsyncProvider, useValue: mockDb },
      {
        provide: SettingsService,
        useValue: {
          // The admin toggle is OFF for every case in this file.
          getEventAutoExtendEnabled: jest.fn().mockResolvedValue(false),
          getEventAutoExtendIncrementMinutes: jest.fn().mockResolvedValue(15),
          getEventAutoExtendMaxOverageMinutes: jest.fn().mockResolvedValue(120),
          getEventAutoExtendMinVoiceMembers: jest.fn().mockResolvedValue(2),
        },
      },
      {
        provide: VoiceAttendanceService,
        useValue: { getActiveCount: jest.fn().mockReturnValue(3) },
      },
      {
        provide: ScheduledEventService,
        useValue: { updateEndTime: jest.fn().mockResolvedValue(undefined) },
      },
      {
        provide: AdHocNotificationService,
        useValue: { queueUpdate: jest.fn() },
      },
      {
        provide: AdHocEventsGateway,
        useValue: { emitEndTimeExtended: jest.fn() },
      },
      {
        provide: CronJobService,
        useValue: {
          executeWithTracking: jest
            .fn()
            .mockImplementation((_name: string, fn: () => Promise<void>) =>
              fn(),
            ),
        },
      },
    ],
  }).compile();

  const service = module.get(EventAutoExtendService);
  // `@Optional() eventCache: ActiveEventCacheService | null` emits `Object`
  // as its design type, so DI cannot resolve it by class token. Set the
  // field directly, as scheduled-event.service.spec-helpers.ts does.
  (service as unknown as { eventCache: unknown }).eventCache = eventCache;
  return {
    service,
    settingsService: module.get(SettingsService),
    scheduledEventService: module.get(ScheduledEventService),
    adHocNotificationService: module.get(AdHocNotificationService),
    adHocGateway: module.get(AdHocEventsGateway),
    eventCache,
    mockDb,
  };
}

const NEW_END = new Date('2026-10-01T21:30:00.000Z');

function payload(
  overrides: Partial<SuppressionWindowExtendedPayload> = {},
): SuppressionWindowExtendedPayload {
  return {
    eventId: 77,
    newEnd: NEW_END,
    discordScheduledEventId: 'se-77',
    ...overrides,
  };
}

/** Let fire-and-forget `.catch()` handlers settle. */
const flushPromises = () => new Promise((r) => setImmediate(r));

let ctx: SyncCtx;
let warnSpy: jest.SpyInstance;

beforeEach(async () => {
  ctx = await buildModule();
  warnSpy = jest
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

describe('EventAutoExtendService — suppression-window listener wiring (ROK-1696)', () => {
  it('is subscribed to SUPPRESSION_WINDOW_EVENTS.EXTENDED', () => {
    // Scanned by method, so a missing or mistyped subscription reads as `[]`.
    const proto = EventAutoExtendService.prototype as unknown as Record<
      string,
      unknown
    >;
    const listeners = Object.getOwnPropertyNames(proto).filter((name) => {
      const method = proto[name];
      if (typeof method !== 'function') return false;
      const events = Reflect.getMetadata('EVENT_LISTENER_METADATA', method) as
        { event: unknown }[] | undefined;
      return (events ?? []).some(
        (e) => e.event === SUPPRESSION_WINDOW_EVENTS.EXTENDED,
      );
    });
    expect(listeners).toEqual(['onSuppressionWindowExtended']);
  });
});

describe('EventAutoExtendService — suppression-window fan-out (ROK-1696)', () => {
  it('pushes the new end to web clients, the cache and Discord with auto-extend OFF', () => {
    ctx.service.onSuppressionWindowExtended(payload());

    expect(ctx.adHocGateway.emitEndTimeExtended).toHaveBeenCalledWith(
      77,
      '2026-10-01T21:30:00.000Z',
    );
    expect(ctx.eventCache.invalidate).toHaveBeenCalledWith(77);
    expect(ctx.eventCache.refresh).toHaveBeenCalledTimes(1);
    expect(ctx.scheduledEventService.updateEndTime).toHaveBeenCalledWith(
      77,
      NEW_END,
    );
  });

  it('does not consult the admin auto-extend toggle', () => {
    ctx.service.onSuppressionWindowExtended(payload());

    expect(
      ctx.settingsService.getEventAutoExtendEnabled,
    ).not.toHaveBeenCalled();
  });

  it('never queues an ad-hoc embed update — the event is scheduled, not ad-hoc', () => {
    ctx.service.onSuppressionWindowExtended(payload());

    expect(ctx.adHocNotificationService.queueUpdate).not.toHaveBeenCalled();
  });

  it('skips the Discord update when no scheduled event is linked', () => {
    ctx.service.onSuppressionWindowExtended(
      payload({ discordScheduledEventId: null }),
    );

    expect(ctx.scheduledEventService.updateEndTime).not.toHaveBeenCalled();
    expect(ctx.adHocGateway.emitEndTimeExtended).toHaveBeenCalledWith(
      77,
      '2026-10-01T21:30:00.000Z',
    );
  });

  it('routes through the shared fanOutEndTimeExtension helper', () => {
    const helperSpy = jest.spyOn(fanOut, 'fanOutEndTimeExtension');

    ctx.service.onSuppressionWindowExtended(payload());

    expect(helperSpy).toHaveBeenCalledTimes(1);
    expect(helperSpy).toHaveBeenCalledWith(
      expect.objectContaining({ adHocGateway: ctx.adHocGateway }),
      {
        id: 77,
        isAdHoc: false,
        channelBindingId: null,
        discordScheduledEventId: 'se-77',
      },
      NEW_END,
    );
  });
});

describe('EventAutoExtendService — suppression-window failures and gating (ROK-1696)', () => {
  it('logs and swallows a rejected Discord end-time update', async () => {
    ctx.scheduledEventService.updateEndTime.mockRejectedValue(
      new Error('discord down'),
    );

    expect(() =>
      ctx.service.onSuppressionWindowExtended(payload()),
    ).not.toThrow();
    await flushPromises();

    expect(warnSpy).toHaveBeenCalledWith(
      'Failed to update scheduled event end time for 77: discord down',
    );
  });

  it('logs and swallows a synchronous fan-out failure', () => {
    ctx.adHocGateway.emitEndTimeExtended.mockImplementation(() => {
      throw new Error('socket gone');
    });

    expect(() =>
      ctx.service.onSuppressionWindowExtended(payload()),
    ).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(
      'Suppression-window fan-out failed for 77: socket gone',
    );
  });

  it('leaves the auto-extend cron gated by the toggle', async () => {
    const result = await ctx.service.checkAndExtendEvents();

    expect(result).toBe(false);
    expect(ctx.mockDb.select).not.toHaveBeenCalled();
    expect(ctx.mockDb.update).not.toHaveBeenCalled();
  });
});
