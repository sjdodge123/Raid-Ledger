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

function createSelectWhereChain(rows: unknown[] = []) {
  const chain: Record<string, jest.Mock> = {};
  chain.select = jest.fn().mockReturnValue(chain);
  chain.from = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockResolvedValue(rows);
  return chain;
}

function createUpdateChain() {
  const chain: Record<string, jest.Mock> = {};
  chain.set = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockResolvedValue(undefined);
  return chain;
}

interface AutoExtendCtx {
  service: EventAutoExtendService;
  settingsService: jest.Mocked<SettingsService>;
  voiceAttendanceService: jest.Mocked<VoiceAttendanceService>;
  scheduledEventService: jest.Mocked<ScheduledEventService>;
  adHocNotificationService: jest.Mocked<AdHocNotificationService>;
  adHocGateway: jest.Mocked<AdHocEventsGateway>;
  cronJobService: jest.Mocked<CronJobService>;
  mockDb: { select: jest.Mock; update: jest.Mock };
}

async function buildAutoExtendModule(): Promise<AutoExtendCtx> {
  const mockDb = { select: jest.fn(), update: jest.fn() };
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      EventAutoExtendService,
      { provide: DrizzleAsyncProvider, useValue: mockDb },
      {
        provide: SettingsService,
        useValue: {
          getEventAutoExtendEnabled: jest.fn().mockResolvedValue(true),
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

  return {
    service: module.get(EventAutoExtendService),
    settingsService: module.get(SettingsService),
    voiceAttendanceService: module.get(VoiceAttendanceService),
    scheduledEventService: module.get(ScheduledEventService),
    adHocNotificationService: module.get(AdHocNotificationService),
    adHocGateway: module.get(AdHocEventsGateway),
    cronJobService: module.get(CronJobService),
    mockDb,
  };
}

describe('EventAutoExtendService — disabled & no candidates', () => {
  let ctx: AutoExtendCtx;

  beforeEach(async () => {
    ctx = await buildAutoExtendModule();
  });

  afterEach(() => jest.clearAllMocks());

  it('does nothing when EVENT_AUTO_EXTEND_ENABLED is false', async () => {
    ctx.settingsService.getEventAutoExtendEnabled.mockResolvedValue(false);
    await ctx.service.checkAndExtendEvents();
    expect(ctx.mockDb.select).not.toHaveBeenCalled();
    expect(ctx.mockDb.update).not.toHaveBeenCalled();
  });

  it('returns early without touching update when candidate list is empty', async () => {
    ctx.mockDb.select.mockReturnValue(createSelectWhereChain([]));
    await ctx.service.checkAndExtendEvents();
    expect(ctx.mockDb.update).not.toHaveBeenCalled();
    expect(ctx.adHocGateway.emitEndTimeExtended).not.toHaveBeenCalled();
  });
});

describe('EventAutoExtendService — voice member threshold', () => {
  let ctx: AutoExtendCtx;

  beforeEach(async () => {
    ctx = await buildAutoExtendModule();
  });

  afterEach(() => jest.clearAllMocks());

  it('extends when active voice count exactly meets the minimum threshold', async () => {
    const candidate = makeCandidate({ id: 42 });
    ctx.mockDb.select.mockReturnValue(createSelectWhereChain([candidate]));
    const uc = createUpdateChain();
    ctx.mockDb.update.mockReturnValue(uc);
    ctx.voiceAttendanceService.getActiveCount.mockReturnValue(2);
    ctx.settingsService.getEventAutoExtendMinVoiceMembers.mockResolvedValue(2);
    await ctx.service.checkAndExtendEvents();
    expect(ctx.mockDb.update).toHaveBeenCalled();
    expect(uc.set).toHaveBeenCalledWith(
      expect.objectContaining({ extendedUntil: expect.any(Date) }),
    );
  });

  it('does NOT extend when active voice count is one below the threshold', async () => {
    const candidate = makeCandidate({ id: 42 });
    ctx.mockDb.select.mockReturnValue(createSelectWhereChain([candidate]));
    ctx.voiceAttendanceService.getActiveCount.mockReturnValue(1);
    ctx.settingsService.getEventAutoExtendMinVoiceMembers.mockResolvedValue(2);
    await ctx.service.checkAndExtendEvents();
    expect(ctx.mockDb.update).not.toHaveBeenCalled();
  });

  it('does NOT extend when active count is zero', async () => {
    const candidate = makeCandidate({ id: 42 });
    ctx.mockDb.select.mockReturnValue(createSelectWhereChain([candidate]));
    ctx.voiceAttendanceService.getActiveCount.mockReturnValue(0);
    await ctx.service.checkAndExtendEvents();
    expect(ctx.mockDb.update).not.toHaveBeenCalled();
  });
});

describe('EventAutoExtendService — extension logic', () => {
  let ctx: AutoExtendCtx;

  beforeEach(async () => {
    ctx = await buildAutoExtendModule();
  });

  afterEach(() => jest.clearAllMocks());

  it('extends extendedUntil by the configured increment', async () => {
    const originalEnd = new Date();
    const candidate = makeCandidate({
      id: 42,
      originalEnd,
      extendedUntil: null,
    });
    ctx.mockDb.select.mockReturnValue(createSelectWhereChain([candidate]));
    const uc = createUpdateChain();
    ctx.mockDb.update.mockReturnValue(uc);
    ctx.settingsService.getEventAutoExtendIncrementMinutes.mockResolvedValue(
      15,
    );
    ctx.voiceAttendanceService.getActiveCount.mockReturnValue(3);
    await ctx.service.checkAndExtendEvents();
    const setCall = uc.set.mock.calls[0][0] as { extendedUntil: Date };
    const expectedMs = originalEnd.getTime() + 15 * 60 * 1000;
    expect(Math.abs(setCall.extendedUntil.getTime() - expectedMs)).toBeLessThan(
      5000,
    );
  });

  it('extends from extendedUntil (not originalEnd) when already extended', async () => {
    const originalEnd = new Date(Date.now() - 10 * 60 * 1000);
    const currentExtendedUntil = new Date(Date.now() + 3 * 60 * 1000);
    const candidate = makeCandidate({
      id: 42,
      originalEnd,
      extendedUntil: currentExtendedUntil,
    });
    ctx.mockDb.select.mockReturnValue(createSelectWhereChain([candidate]));
    const uc = createUpdateChain();
    ctx.mockDb.update.mockReturnValue(uc);
    ctx.settingsService.getEventAutoExtendIncrementMinutes.mockResolvedValue(
      15,
    );
    ctx.voiceAttendanceService.getActiveCount.mockReturnValue(3);
    await ctx.service.checkAndExtendEvents();
    const setCall = uc.set.mock.calls[0][0] as { extendedUntil: Date };
    const expectedMs = currentExtendedUntil.getTime() + 15 * 60 * 1000;
    expect(Math.abs(setCall.extendedUntil.getTime() - expectedMs)).toBeLessThan(
      5000,
    );
  });

  it('emits a WebSocket event with the new end time ISO string', async () => {
    const candidate = makeCandidate({ id: 42 });
    ctx.mockDb.select.mockReturnValue(createSelectWhereChain([candidate]));
    ctx.mockDb.update.mockReturnValue(createUpdateChain());
    ctx.voiceAttendanceService.getActiveCount.mockReturnValue(3);
    await ctx.service.checkAndExtendEvents();
    expect(ctx.adHocGateway.emitEndTimeExtended).toHaveBeenCalledWith(
      42,
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    );
  });

  it('sets updatedAt to a current Date alongside extendedUntil', async () => {
    const candidate = makeCandidate({ id: 42 });
    ctx.mockDb.select.mockReturnValue(createSelectWhereChain([candidate]));
    const uc = createUpdateChain();
    ctx.mockDb.update.mockReturnValue(uc);
    ctx.voiceAttendanceService.getActiveCount.mockReturnValue(3);
    const before = Date.now();
    await ctx.service.checkAndExtendEvents();
    const after = Date.now();
    const setCall = uc.set.mock.calls[0][0] as { updatedAt: Date };
    expect(setCall.updatedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(setCall.updatedAt.getTime()).toBeLessThanOrEqual(after + 1000);
  });
});

describe('EventAutoExtendService — max overage cap', () => {
  let ctx: AutoExtendCtx;

  beforeEach(async () => {
    ctx = await buildAutoExtendModule();
  });

  afterEach(() => jest.clearAllMocks());

  it('does NOT extend when event is already at max overage', async () => {
    const maxOverageMinutes = 120;
    const originalEnd = new Date(Date.now() - 5 * 60 * 1000);
    const extendedUntil = new Date(
      originalEnd.getTime() + maxOverageMinutes * 60 * 1000,
    );
    const candidate = makeCandidate({ id: 42, originalEnd, extendedUntil });
    ctx.mockDb.select.mockReturnValue(createSelectWhereChain([candidate]));
    ctx.settingsService.getEventAutoExtendMaxOverageMinutes.mockResolvedValue(
      maxOverageMinutes,
    );
    ctx.voiceAttendanceService.getActiveCount.mockReturnValue(5);
    await ctx.service.checkAndExtendEvents();
    expect(ctx.mockDb.update).not.toHaveBeenCalled();
  });

  it('caps extendedUntil at max overage when increment would push past it', async () => {
    const maxOverageMinutes = 120;
    const originalEnd = new Date(Date.now() - 5 * 60 * 1000);
    const extendedUntil = new Date(originalEnd.getTime() + 115 * 60 * 1000);
    const candidate = makeCandidate({ id: 42, originalEnd, extendedUntil });
    ctx.mockDb.select.mockReturnValue(createSelectWhereChain([candidate]));
    const uc = createUpdateChain();
    ctx.mockDb.update.mockReturnValue(uc);
    ctx.settingsService.getEventAutoExtendMaxOverageMinutes.mockResolvedValue(
      maxOverageMinutes,
    );
    ctx.settingsService.getEventAutoExtendIncrementMinutes.mockResolvedValue(
      15,
    );
    ctx.voiceAttendanceService.getActiveCount.mockReturnValue(5);
    await ctx.service.checkAndExtendEvents();
    const setCall = uc.set.mock.calls[0][0] as { extendedUntil: Date };
    const maxEnd = originalEnd.getTime() + maxOverageMinutes * 60 * 1000;
    expect(setCall.extendedUntil.getTime()).toBe(maxEnd);
  });

  it('extends normally when well within max overage headroom', async () => {
    const maxOverageMinutes = 120;
    const originalEnd = new Date(Date.now() - 5 * 60 * 1000);
    const extendedUntil = new Date(originalEnd.getTime() + 60 * 60 * 1000);
    const candidate = makeCandidate({ id: 42, originalEnd, extendedUntil });
    ctx.mockDb.select.mockReturnValue(createSelectWhereChain([candidate]));
    const uc = createUpdateChain();
    ctx.mockDb.update.mockReturnValue(uc);
    ctx.settingsService.getEventAutoExtendMaxOverageMinutes.mockResolvedValue(
      maxOverageMinutes,
    );
    ctx.settingsService.getEventAutoExtendIncrementMinutes.mockResolvedValue(
      15,
    );
    ctx.voiceAttendanceService.getActiveCount.mockReturnValue(5);
    await ctx.service.checkAndExtendEvents();
    expect(ctx.mockDb.update).toHaveBeenCalled();
    const setCall = uc.set.mock.calls[0][0] as { extendedUntil: Date };
    const expectedEnd = extendedUntil.getTime() + 15 * 60 * 1000;
    expect(
      Math.abs(setCall.extendedUntil.getTime() - expectedEnd),
    ).toBeLessThan(1000);
  });
});

describe('EventAutoExtendService — Discord Scheduled Event update', () => {
  let ctx: AutoExtendCtx;

  beforeEach(async () => {
    ctx = await buildAutoExtendModule();
  });

  afterEach(() => jest.clearAllMocks());

  it('calls updateEndTime when event has a discordScheduledEventId', async () => {
    const candidate = makeCandidate({
      id: 42,
      discordScheduledEventId: 'discord-se-1',
    });
    ctx.mockDb.select.mockReturnValue(createSelectWhereChain([candidate]));
    ctx.mockDb.update.mockReturnValue(createUpdateChain());
    ctx.voiceAttendanceService.getActiveCount.mockReturnValue(3);
    await ctx.service.checkAndExtendEvents();
    await Promise.resolve();
    expect(ctx.scheduledEventService.updateEndTime).toHaveBeenCalledWith(
      42,
      expect.any(Date),
    );
  });

  it('does NOT call updateEndTime when discordScheduledEventId is null', async () => {
    const candidate = makeCandidate({ id: 42, discordScheduledEventId: null });
    ctx.mockDb.select.mockReturnValue(createSelectWhereChain([candidate]));
    ctx.mockDb.update.mockReturnValue(createUpdateChain());
    ctx.voiceAttendanceService.getActiveCount.mockReturnValue(3);
    await ctx.service.checkAndExtendEvents();
    await Promise.resolve();
    expect(ctx.scheduledEventService.updateEndTime).not.toHaveBeenCalled();
  });

  it('does not propagate errors from updateEndTime — fire and forget', async () => {
    const candidate = makeCandidate({
      id: 42,
      discordScheduledEventId: 'discord-se-1',
    });
    ctx.mockDb.select.mockReturnValue(createSelectWhereChain([candidate]));
    ctx.mockDb.update.mockReturnValue(createUpdateChain());
    ctx.voiceAttendanceService.getActiveCount.mockReturnValue(3);
    ctx.scheduledEventService.updateEndTime.mockRejectedValue(
      new Error('Discord API failed'),
    );
    await expect(ctx.service.checkAndExtendEvents()).resolves.not.toThrow();
  });
});

describe('EventAutoExtendService — multiple candidates', () => {
  let ctx: AutoExtendCtx;

  beforeEach(async () => {
    ctx = await buildAutoExtendModule();
  });

  afterEach(() => jest.clearAllMocks());

  it('processes each eligible candidate independently', async () => {
    const c1 = makeCandidate({ id: 10 });
    const c2 = makeCandidate({ id: 20 });
    ctx.mockDb.select.mockReturnValue(createSelectWhereChain([c1, c2]));
    let updateCount = 0;
    ctx.mockDb.update.mockImplementation(() => {
      updateCount++;
      return createUpdateChain();
    });
    ctx.voiceAttendanceService.getActiveCount.mockReturnValue(3);
    await ctx.service.checkAndExtendEvents();
    expect(updateCount).toBe(2);
    expect(ctx.adHocGateway.emitEndTimeExtended).toHaveBeenCalledTimes(2);
  });

  it('skips below-threshold candidates while extending above-threshold ones', async () => {
    const c1 = makeCandidate({ id: 10 });
    const c2 = makeCandidate({ id: 20 });
    ctx.mockDb.select.mockReturnValue(createSelectWhereChain([c1, c2]));
    ctx.mockDb.update.mockReturnValue(createUpdateChain());
    ctx.settingsService.getEventAutoExtendMinVoiceMembers.mockResolvedValue(2);
    ctx.voiceAttendanceService.getActiveCount
      .mockReturnValueOnce(3)
      .mockReturnValueOnce(1);
    await ctx.service.checkAndExtendEvents();
    expect(ctx.mockDb.update).toHaveBeenCalledTimes(1);
    expect(ctx.adHocGateway.emitEndTimeExtended).toHaveBeenCalledWith(
      10,
      expect.any(String),
    );
  });

  it('skips capped candidates while extending un-capped ones', async () => {
    const maxOverageMinutes = 120;
    const originalEnd = new Date(Date.now() - 5 * 60 * 1000);
    const capped = makeCandidate({
      id: 10,
      originalEnd,
      extendedUntil: new Date(
        originalEnd.getTime() + maxOverageMinutes * 60 * 1000,
      ),
    });
    const normal = makeCandidate({ id: 20, originalEnd, extendedUntil: null });
    ctx.mockDb.select.mockReturnValue(createSelectWhereChain([capped, normal]));
    ctx.mockDb.update.mockReturnValue(createUpdateChain());
    ctx.settingsService.getEventAutoExtendMaxOverageMinutes.mockResolvedValue(
      maxOverageMinutes,
    );
    ctx.voiceAttendanceService.getActiveCount.mockReturnValue(5);
    await ctx.service.checkAndExtendEvents();
    expect(ctx.mockDb.update).toHaveBeenCalledTimes(1);
    expect(ctx.adHocGateway.emitEndTimeExtended).toHaveBeenCalledWith(
      20,
      expect.any(String),
    );
  });
});

describe('Regression: lookback window catches events ending at odd times (ROK-736)', () => {
  let ctx: AutoExtendCtx;

  beforeEach(async () => {
    ctx = await buildAutoExtendModule();
  });

  afterEach(() => jest.clearAllMocks());

  it('finds an event whose effective end is 4 minutes in the past', async () => {
    const originalEnd = new Date(Date.now() - 4 * 60 * 1000);
    const candidate = makeCandidate({
      id: 99,
      originalEnd,
      extendedUntil: null,
    });
    ctx.mockDb.select.mockReturnValue(createSelectWhereChain([candidate]));
    const uc = createUpdateChain();
    ctx.mockDb.update.mockReturnValue(uc);
    ctx.voiceAttendanceService.getActiveCount.mockReturnValue(3);
    await ctx.service.checkAndExtendEvents();
    expect(ctx.mockDb.update).toHaveBeenCalled();
    expect(uc.set).toHaveBeenCalledWith(
      expect.objectContaining({ extendedUntil: expect.any(Date) }),
    );
  });
});

describe('EventAutoExtendService — ad-hoc embed update & cron', () => {
  let ctx: AutoExtendCtx;

  beforeEach(async () => {
    ctx = await buildAutoExtendModule();
  });

  afterEach(() => jest.clearAllMocks());

  it('queues a Discord embed update when extending an ad-hoc event with a binding', async () => {
    const candidate = makeCandidate({
      id: 42,
      isAdHoc: true,
      channelBindingId: 'binding-abc',
    });
    ctx.mockDb.select.mockReturnValue(createSelectWhereChain([candidate]));
    ctx.mockDb.update.mockReturnValue(createUpdateChain());
    ctx.voiceAttendanceService.getActiveCount.mockReturnValue(3);
    await ctx.service.checkAndExtendEvents();
    expect(ctx.adHocNotificationService.queueUpdate).toHaveBeenCalledWith(
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
    ctx.mockDb.select.mockReturnValue(createSelectWhereChain([candidate]));
    ctx.mockDb.update.mockReturnValue(createUpdateChain());
    ctx.voiceAttendanceService.getActiveCount.mockReturnValue(3);
    await ctx.service.checkAndExtendEvents();
    expect(ctx.adHocNotificationService.queueUpdate).not.toHaveBeenCalled();
  });

  it('does NOT queue a Discord embed update when ad-hoc event has no binding', async () => {
    const candidate = makeCandidate({
      id: 42,
      isAdHoc: true,
      channelBindingId: null,
    });
    ctx.mockDb.select.mockReturnValue(createSelectWhereChain([candidate]));
    ctx.mockDb.update.mockReturnValue(createUpdateChain());
    ctx.voiceAttendanceService.getActiveCount.mockReturnValue(3);
    await ctx.service.checkAndExtendEvents();
    expect(ctx.adHocNotificationService.queueUpdate).not.toHaveBeenCalled();
  });

  it('delegates to cronJobService.executeWithTracking with the correct job name', async () => {
    ctx.mockDb.select.mockReturnValue(createSelectWhereChain([]));
    await ctx.service.handleCheckExtensions();
    expect(ctx.cronJobService.executeWithTracking).toHaveBeenCalledWith(
      'EventAutoExtendService_checkExtensions',
      expect.any(Function),
    );
  });
});
