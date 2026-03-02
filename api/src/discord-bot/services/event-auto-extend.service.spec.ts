/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { EventAutoExtendService } from './event-auto-extend.service';
import { SettingsService } from '../../settings/settings.service';
import { VoiceAttendanceService } from './voice-attendance.service';
import { ScheduledEventService } from './scheduled-event.service';
import { AdHocNotificationService } from './ad-hoc-notification.service';
import { AdHocEventsGateway } from '../../events/ad-hoc-events.gateway';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';

/**
 * Build a minimal event candidate row as returned by the auto-extend DB query.
 */
function makeCandidate(overrides: {
  id?: number;
  originalEnd?: Date;
  extendedUntil?: Date | null;
  discordScheduledEventId?: string | null;
  isAdHoc?: boolean;
  channelBindingId?: string | null;
}) {
  const originalEnd =
    overrides.originalEnd ?? new Date(Date.now() + 5 * 60 * 1000);
  return {
    id: overrides.id ?? 42,
    duration: [
      new Date(originalEnd.getTime() - 2 * 60 * 60 * 1000),
      originalEnd,
    ] as [Date, Date],
    extendedUntil: overrides.extendedUntil ?? null,
    discordScheduledEventId: overrides.discordScheduledEventId ?? null,
    isAdHoc: overrides.isAdHoc ?? false,
    channelBindingId: overrides.channelBindingId ?? null,
  };
}

/**
 * Build a chainable Drizzle select mock that resolves at `.where()` (no `.limit()`).
 * The candidate query in checkAndExtendEvents() terminates at `.where()`.
 */
function createSelectWhereChain(rows: unknown[] = []) {
  const chain: Record<string, jest.Mock> = {};
  chain.select = jest.fn().mockReturnValue(chain);
  chain.from = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockResolvedValue(rows);
  return chain;
}

/**
 * Build a chainable Drizzle update mock.
 */
function createUpdateChain() {
  const chain: Record<string, jest.Mock> = {};
  chain.set = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockResolvedValue(undefined);
  return chain;
}

describe('EventAutoExtendService', () => {
  let service: EventAutoExtendService;
  let settingsService: jest.Mocked<SettingsService>;
  let voiceAttendanceService: jest.Mocked<VoiceAttendanceService>;
  let scheduledEventService: jest.Mocked<ScheduledEventService>;
  let adHocNotificationService: jest.Mocked<AdHocNotificationService>;
  let adHocGateway: jest.Mocked<AdHocEventsGateway>;
  let cronJobService: jest.Mocked<CronJobService>;
  let mockDb: {
    select: jest.Mock;
    update: jest.Mock;
  };

  beforeEach(async () => {
    mockDb = {
      select: jest.fn(),
      update: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventAutoExtendService,
        {
          provide: DrizzleAsyncProvider,
          useValue: mockDb,
        },
        {
          provide: SettingsService,
          useValue: {
            getEventAutoExtendEnabled: jest.fn().mockResolvedValue(true),
            getEventAutoExtendIncrementMinutes: jest.fn().mockResolvedValue(15),
            getEventAutoExtendMaxOverageMinutes: jest
              .fn()
              .mockResolvedValue(120),
            getEventAutoExtendMinVoiceMembers: jest.fn().mockResolvedValue(2),
          },
        },
        {
          provide: VoiceAttendanceService,
          useValue: {
            getActiveCount: jest.fn().mockReturnValue(3),
          },
        },
        {
          provide: ScheduledEventService,
          useValue: {
            updateEndTime: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: AdHocNotificationService,
          useValue: {
            queueUpdate: jest.fn(),
          },
        },
        {
          provide: AdHocEventsGateway,
          useValue: {
            emitEndTimeExtended: jest.fn(),
          },
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

    service = module.get(EventAutoExtendService);
    settingsService = module.get(SettingsService);
    voiceAttendanceService = module.get(VoiceAttendanceService);
    scheduledEventService = module.get(ScheduledEventService);
    adHocNotificationService = module.get(AdHocNotificationService);
    adHocGateway = module.get(AdHocEventsGateway);
    cronJobService = module.get(CronJobService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── Feature disabled ──────────────────────────────────────────────────────

  describe('when feature is disabled', () => {
    it('does nothing when EVENT_AUTO_EXTEND_ENABLED is false', async () => {
      settingsService.getEventAutoExtendEnabled.mockResolvedValue(false);

      await service.checkAndExtendEvents();

      expect(mockDb.select).not.toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(adHocGateway.emitEndTimeExtended).not.toHaveBeenCalled();
    });
  });

  // ─── No candidates ─────────────────────────────────────────────────────────

  describe('when no candidate events are found', () => {
    it('returns early without touching update or gateway when candidate list is empty', async () => {
      mockDb.select.mockReturnValue(createSelectWhereChain([]));

      await service.checkAndExtendEvents();

      expect(mockDb.update).not.toHaveBeenCalled();
      expect(adHocGateway.emitEndTimeExtended).not.toHaveBeenCalled();
      expect(scheduledEventService.updateEndTime).not.toHaveBeenCalled();
    });
  });

  // ─── Voice member threshold ────────────────────────────────────────────────

  describe('voice member threshold', () => {
    it('extends when active voice count exactly meets the minimum threshold', async () => {
      const candidate = makeCandidate({ id: 42 });
      mockDb.select.mockReturnValue(createSelectWhereChain([candidate]));
      const updateChain = createUpdateChain();
      mockDb.update.mockReturnValue(updateChain);

      voiceAttendanceService.getActiveCount.mockReturnValue(2);
      settingsService.getEventAutoExtendMinVoiceMembers.mockResolvedValue(2);

      await service.checkAndExtendEvents();

      expect(mockDb.update).toHaveBeenCalled();
      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({ extendedUntil: expect.any(Date) }),
      );
    });

    it('does NOT extend when active voice count is one below the threshold', async () => {
      const candidate = makeCandidate({ id: 42 });
      mockDb.select.mockReturnValue(createSelectWhereChain([candidate]));

      voiceAttendanceService.getActiveCount.mockReturnValue(1);
      settingsService.getEventAutoExtendMinVoiceMembers.mockResolvedValue(2);

      await service.checkAndExtendEvents();

      expect(mockDb.update).not.toHaveBeenCalled();
      expect(adHocGateway.emitEndTimeExtended).not.toHaveBeenCalled();
    });

    it('does NOT extend when active count is zero', async () => {
      const candidate = makeCandidate({ id: 42 });
      mockDb.select.mockReturnValue(createSelectWhereChain([candidate]));

      voiceAttendanceService.getActiveCount.mockReturnValue(0);

      await service.checkAndExtendEvents();

      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });

  // ─── Extension logic ───────────────────────────────────────────────────────

  describe('extension logic', () => {
    it('extends extendedUntil by the configured increment when threshold is met', async () => {
      const originalEnd = new Date();
      const candidate = makeCandidate({
        id: 42,
        originalEnd,
        extendedUntil: null,
      });
      mockDb.select.mockReturnValue(createSelectWhereChain([candidate]));
      const updateChain = createUpdateChain();
      mockDb.update.mockReturnValue(updateChain);

      settingsService.getEventAutoExtendIncrementMinutes.mockResolvedValue(15);
      voiceAttendanceService.getActiveCount.mockReturnValue(3);

      await service.checkAndExtendEvents();

      const setCall = updateChain.set.mock.calls[0][0] as {
        extendedUntil: Date;
      };
      // Should be ~15 min after originalEnd
      const expectedMs = originalEnd.getTime() + 15 * 60 * 1000;
      expect(
        Math.abs(setCall.extendedUntil.getTime() - expectedMs),
      ).toBeLessThan(5000);
    });

    it('extends from extendedUntil (not originalEnd) when event is already extended', async () => {
      const originalEnd = new Date(Date.now() - 10 * 60 * 1000); // already passed
      const currentExtendedUntil = new Date(Date.now() + 3 * 60 * 1000); // still in window

      const candidate = makeCandidate({
        id: 42,
        originalEnd,
        extendedUntil: currentExtendedUntil,
      });
      mockDb.select.mockReturnValue(createSelectWhereChain([candidate]));
      const updateChain = createUpdateChain();
      mockDb.update.mockReturnValue(updateChain);

      settingsService.getEventAutoExtendIncrementMinutes.mockResolvedValue(15);
      voiceAttendanceService.getActiveCount.mockReturnValue(3);

      await service.checkAndExtendEvents();

      const setCall = updateChain.set.mock.calls[0][0] as {
        extendedUntil: Date;
      };
      // Should be ~15 min after currentExtendedUntil, not after originalEnd
      const expectedMs = currentExtendedUntil.getTime() + 15 * 60 * 1000;
      expect(
        Math.abs(setCall.extendedUntil.getTime() - expectedMs),
      ).toBeLessThan(5000);
    });

    it('emits a WebSocket event with the new end time ISO string', async () => {
      const candidate = makeCandidate({ id: 42 });
      mockDb.select.mockReturnValue(createSelectWhereChain([candidate]));
      const updateChain = createUpdateChain();
      mockDb.update.mockReturnValue(updateChain);
      voiceAttendanceService.getActiveCount.mockReturnValue(3);

      await service.checkAndExtendEvents();

      expect(adHocGateway.emitEndTimeExtended).toHaveBeenCalledWith(
        42,
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/), // ISO string
      );
    });

    it('sets updatedAt to a current Date alongside extendedUntil', async () => {
      const candidate = makeCandidate({ id: 42 });
      mockDb.select.mockReturnValue(createSelectWhereChain([candidate]));
      const updateChain = createUpdateChain();
      mockDb.update.mockReturnValue(updateChain);
      voiceAttendanceService.getActiveCount.mockReturnValue(3);

      const before = Date.now();
      await service.checkAndExtendEvents();
      const after = Date.now();

      const setCall = updateChain.set.mock.calls[0][0] as { updatedAt: Date };
      expect(setCall.updatedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(setCall.updatedAt.getTime()).toBeLessThanOrEqual(after + 1000);
    });
  });

  // ─── Max overage cap ───────────────────────────────────────────────────────

  describe('max overage cap', () => {
    it('does NOT extend when event is already at max overage', async () => {
      const maxOverageMinutes = 120;
      const originalEnd = new Date(Date.now() - 5 * 60 * 1000);
      // Already at exactly max overage
      const extendedUntil = new Date(
        originalEnd.getTime() + maxOverageMinutes * 60 * 1000,
      );

      const candidate = makeCandidate({ id: 42, originalEnd, extendedUntil });
      mockDb.select.mockReturnValue(createSelectWhereChain([candidate]));

      settingsService.getEventAutoExtendMaxOverageMinutes.mockResolvedValue(
        maxOverageMinutes,
      );
      voiceAttendanceService.getActiveCount.mockReturnValue(5);

      await service.checkAndExtendEvents();

      expect(mockDb.update).not.toHaveBeenCalled();
      expect(adHocGateway.emitEndTimeExtended).not.toHaveBeenCalled();
    });

    it('caps extendedUntil at max overage when increment would push past it', async () => {
      const maxOverageMinutes = 120;
      const originalEnd = new Date(Date.now() - 5 * 60 * 1000);
      // 115 min overage — increment of 15 would push to 130, over cap
      const extendedUntil = new Date(originalEnd.getTime() + 115 * 60 * 1000);

      const candidate = makeCandidate({ id: 42, originalEnd, extendedUntil });
      mockDb.select.mockReturnValue(createSelectWhereChain([candidate]));
      const updateChain = createUpdateChain();
      mockDb.update.mockReturnValue(updateChain);

      settingsService.getEventAutoExtendMaxOverageMinutes.mockResolvedValue(
        maxOverageMinutes,
      );
      settingsService.getEventAutoExtendIncrementMinutes.mockResolvedValue(15);
      voiceAttendanceService.getActiveCount.mockReturnValue(5);

      await service.checkAndExtendEvents();

      const setCall = updateChain.set.mock.calls[0][0] as {
        extendedUntil: Date;
      };
      const maxEnd = originalEnd.getTime() + maxOverageMinutes * 60 * 1000;
      expect(setCall.extendedUntil.getTime()).toBe(maxEnd);
    });

    it('extends normally when well within max overage headroom', async () => {
      const maxOverageMinutes = 120;
      const originalEnd = new Date(Date.now() - 5 * 60 * 1000);
      // 60 min overage — increment of 15 is well within cap of 120
      const extendedUntil = new Date(originalEnd.getTime() + 60 * 60 * 1000);

      const candidate = makeCandidate({ id: 42, originalEnd, extendedUntil });
      mockDb.select.mockReturnValue(createSelectWhereChain([candidate]));
      const updateChain = createUpdateChain();
      mockDb.update.mockReturnValue(updateChain);

      settingsService.getEventAutoExtendMaxOverageMinutes.mockResolvedValue(
        maxOverageMinutes,
      );
      settingsService.getEventAutoExtendIncrementMinutes.mockResolvedValue(15);
      voiceAttendanceService.getActiveCount.mockReturnValue(5);

      await service.checkAndExtendEvents();

      expect(mockDb.update).toHaveBeenCalled();
      const setCall = updateChain.set.mock.calls[0][0] as {
        extendedUntil: Date;
      };
      const expectedEnd = extendedUntil.getTime() + 15 * 60 * 1000;
      expect(
        Math.abs(setCall.extendedUntil.getTime() - expectedEnd),
      ).toBeLessThan(1000);
    });
  });

  // ─── Discord Scheduled Event end time update ───────────────────────────────

  describe('Discord Scheduled Event end time update', () => {
    it('calls scheduledEventService.updateEndTime when event has a discordScheduledEventId', async () => {
      const candidate = makeCandidate({
        id: 42,
        discordScheduledEventId: 'discord-se-1',
      });
      mockDb.select.mockReturnValue(createSelectWhereChain([candidate]));
      const updateChain = createUpdateChain();
      mockDb.update.mockReturnValue(updateChain);
      voiceAttendanceService.getActiveCount.mockReturnValue(3);

      await service.checkAndExtendEvents();
      // Let the fire-and-forget .catch() chain resolve
      await Promise.resolve();

      expect(scheduledEventService.updateEndTime).toHaveBeenCalledWith(
        42,
        expect.any(Date),
      );
    });

    it('does NOT call scheduledEventService.updateEndTime when discordScheduledEventId is null', async () => {
      const candidate = makeCandidate({
        id: 42,
        discordScheduledEventId: null,
      });
      mockDb.select.mockReturnValue(createSelectWhereChain([candidate]));
      const updateChain = createUpdateChain();
      mockDb.update.mockReturnValue(updateChain);
      voiceAttendanceService.getActiveCount.mockReturnValue(3);

      await service.checkAndExtendEvents();
      await Promise.resolve();

      expect(scheduledEventService.updateEndTime).not.toHaveBeenCalled();
    });

    it('does not propagate errors from updateEndTime — fire and forget', async () => {
      const candidate = makeCandidate({
        id: 42,
        discordScheduledEventId: 'discord-se-1',
      });
      mockDb.select.mockReturnValue(createSelectWhereChain([candidate]));
      const updateChain = createUpdateChain();
      mockDb.update.mockReturnValue(updateChain);
      voiceAttendanceService.getActiveCount.mockReturnValue(3);

      scheduledEventService.updateEndTime.mockRejectedValue(
        new Error('Discord API failed'),
      );

      await expect(service.checkAndExtendEvents()).resolves.not.toThrow();
    });
  });

  // ─── Multiple candidates ───────────────────────────────────────────────────

  describe('multiple candidates', () => {
    it('processes each eligible candidate independently', async () => {
      const c1 = makeCandidate({ id: 10 });
      const c2 = makeCandidate({ id: 20 });
      mockDb.select.mockReturnValue(createSelectWhereChain([c1, c2]));

      let updateCount = 0;
      mockDb.update.mockImplementation(() => {
        updateCount++;
        return createUpdateChain();
      });

      voiceAttendanceService.getActiveCount.mockReturnValue(3);

      await service.checkAndExtendEvents();

      expect(updateCount).toBe(2);
      expect(adHocGateway.emitEndTimeExtended).toHaveBeenCalledTimes(2);
    });

    it('skips below-threshold candidates while extending above-threshold ones', async () => {
      const c1 = makeCandidate({ id: 10 });
      const c2 = makeCandidate({ id: 20 });
      mockDb.select.mockReturnValue(createSelectWhereChain([c1, c2]));
      const updateChain = createUpdateChain();
      mockDb.update.mockReturnValue(updateChain);

      settingsService.getEventAutoExtendMinVoiceMembers.mockResolvedValue(2);
      // c1 = 3 (above threshold), c2 = 1 (below)
      voiceAttendanceService.getActiveCount
        .mockReturnValueOnce(3)
        .mockReturnValueOnce(1);

      await service.checkAndExtendEvents();

      expect(mockDb.update).toHaveBeenCalledTimes(1);
      expect(adHocGateway.emitEndTimeExtended).toHaveBeenCalledTimes(1);
      expect(adHocGateway.emitEndTimeExtended).toHaveBeenCalledWith(
        10,
        expect.any(String),
      );
    });

    it('skips capped candidates while extending un-capped ones', async () => {
      const maxOverageMinutes = 120;
      const originalEnd = new Date(Date.now() - 5 * 60 * 1000);

      const cappedCandidate = makeCandidate({
        id: 10,
        originalEnd,
        extendedUntil: new Date(
          originalEnd.getTime() + maxOverageMinutes * 60 * 1000,
        ),
      });
      const normalCandidate = makeCandidate({
        id: 20,
        originalEnd,
        extendedUntil: null,
      });

      mockDb.select.mockReturnValue(
        createSelectWhereChain([cappedCandidate, normalCandidate]),
      );
      const updateChain = createUpdateChain();
      mockDb.update.mockReturnValue(updateChain);

      settingsService.getEventAutoExtendMaxOverageMinutes.mockResolvedValue(
        maxOverageMinutes,
      );
      voiceAttendanceService.getActiveCount.mockReturnValue(5);

      await service.checkAndExtendEvents();

      expect(mockDb.update).toHaveBeenCalledTimes(1);
      expect(adHocGateway.emitEndTimeExtended).toHaveBeenCalledWith(
        20,
        expect.any(String),
      );
    });
  });

  // ─── Ad-hoc Discord embed update (ROK-612) ─────────────────────────────

  describe('ad-hoc Discord embed update', () => {
    it('queues a Discord embed update when extending an ad-hoc event with a binding', async () => {
      const candidate = makeCandidate({
        id: 42,
        isAdHoc: true,
        channelBindingId: 'binding-abc',
      });
      mockDb.select.mockReturnValue(createSelectWhereChain([candidate]));
      const updateChain = createUpdateChain();
      mockDb.update.mockReturnValue(updateChain);
      voiceAttendanceService.getActiveCount.mockReturnValue(3);

      await service.checkAndExtendEvents();

      expect(adHocNotificationService.queueUpdate).toHaveBeenCalledWith(
        42,
        'binding-abc',
      );
    });

    it('does NOT queue a Discord embed update for scheduled (non-ad-hoc) events', async () => {
      const candidate = makeCandidate({
        id: 42,
        isAdHoc: false,
        channelBindingId: null,
      });
      mockDb.select.mockReturnValue(createSelectWhereChain([candidate]));
      const updateChain = createUpdateChain();
      mockDb.update.mockReturnValue(updateChain);
      voiceAttendanceService.getActiveCount.mockReturnValue(3);

      await service.checkAndExtendEvents();

      expect(adHocNotificationService.queueUpdate).not.toHaveBeenCalled();
    });

    it('does NOT queue a Discord embed update when ad-hoc event has no binding', async () => {
      const candidate = makeCandidate({
        id: 42,
        isAdHoc: true,
        channelBindingId: null,
      });
      mockDb.select.mockReturnValue(createSelectWhereChain([candidate]));
      const updateChain = createUpdateChain();
      mockDb.update.mockReturnValue(updateChain);
      voiceAttendanceService.getActiveCount.mockReturnValue(3);

      await service.checkAndExtendEvents();

      expect(adHocNotificationService.queueUpdate).not.toHaveBeenCalled();
    });
  });

  // ─── Cron tracking ────────────────────────────────────────────────────────

  describe('handleCheckExtensions (cron delegate)', () => {
    it('delegates to cronJobService.executeWithTracking with the correct job name', async () => {
      mockDb.select.mockReturnValue(createSelectWhereChain([]));

      await service.handleCheckExtensions();

      expect(cronJobService.executeWithTracking).toHaveBeenCalledWith(
        'EventAutoExtendService_checkExtensions',
        expect.any(Function),
      );
    });
  });
});
