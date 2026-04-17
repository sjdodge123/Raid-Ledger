import { Test } from '@nestjs/testing';
import { DemoTestController } from './demo-test.controller';
import { DemoTestService } from './demo-test.service';
import { LineupSteamNudgeService } from '../lineups/lineup-steam-nudge.service';

function createMockService() {
  return {
    flushVoiceSessionsForTest: jest.fn().mockResolvedValue({ success: true }),
    flushEmbedQueueForTest: jest.fn().mockResolvedValue({ success: true }),
    awaitProcessingForTest: jest.fn().mockResolvedValue(undefined),
    // Existing methods (unused in these tests but needed for type compat)
    linkDiscordForTest: jest.fn(),
    enableDiscordNotificationsForTest: jest.fn(),
    createSignupForTest: jest.fn(),
    addGameInterestForTest: jest.fn(),
    triggerDepartureForTest: jest.fn(),
    cancelSignupForTest: jest.fn(),
    getNotificationsForTest: jest.fn(),
    flushNotificationBufferForTest: jest.fn(),
    cleanupScheduledEventsForTest: jest
      .fn()
      .mockResolvedValue({ success: true, deleted: 3, failed: 0, total: 3 }),
    enableScheduledEventsForTest: jest
      .fn()
      .mockResolvedValue({ success: true }),
    disableScheduledEventsForTest: jest
      .fn()
      .mockResolvedValue({ success: true }),
    pauseReconciliationForTest: jest.fn().mockResolvedValue({ success: true }),
    setEventTimesForTest: jest.fn().mockResolvedValue({ success: true }),
    clearGameTimeConfirmationForTest: jest.fn().mockResolvedValue(undefined),
    setAutoHeartPrefForTest: jest.fn().mockResolvedValue(undefined),
  };
}

describe('DemoTestController — new test utility endpoints', () => {
  let controller: DemoTestController;
  let mockService: ReturnType<typeof createMockService>;

  beforeEach(async () => {
    mockService = createMockService();

    const module = await Test.createTestingModule({
      controllers: [DemoTestController],
      providers: [
        { provide: DemoTestService, useValue: mockService },
        {
          provide: LineupSteamNudgeService,
          useValue: { nudgeUnlinkedMembers: jest.fn() },
        },
      ],
    }).compile();

    controller = module.get(DemoTestController);
  });

  it('flushVoiceSessions returns success', async () => {
    const result = await controller.flushVoiceSessionsForTest();
    expect(result).toMatchObject({ success: true });
    expect(mockService.flushVoiceSessionsForTest).toHaveBeenCalled();
  });

  it('flushEmbedQueue returns success', async () => {
    const result = await controller.flushEmbedQueueForTest();
    expect(result).toMatchObject({ success: true });
    expect(mockService.flushEmbedQueueForTest).toHaveBeenCalled();
  });

  it('awaitProcessing returns success with default timeout', async () => {
    const result = await controller.awaitProcessingForTest({});
    expect(result).toMatchObject({ success: true });
    expect(mockService.awaitProcessingForTest).toHaveBeenCalledWith(30000);
  });

  it('awaitProcessing accepts custom timeout', async () => {
    const result = await controller.awaitProcessingForTest({
      timeoutMs: 5000,
    });
    expect(result).toMatchObject({ success: true });
    expect(mockService.awaitProcessingForTest).toHaveBeenCalledWith(5000);
  });

  it('cleanupScheduledEvents delegates to service', async () => {
    const result = await controller.cleanupScheduledEventsForTest();
    expect(result).toMatchObject({
      success: true,
      deleted: 3,
      failed: 0,
      total: 3,
    });
    expect(mockService.cleanupScheduledEventsForTest).toHaveBeenCalled();
  });

  it('enableScheduledEvents delegates to service (ROK-969)', async () => {
    const result = await controller.enableScheduledEventsForTest();
    expect(result).toMatchObject({ success: true });
    expect(mockService.enableScheduledEventsForTest).toHaveBeenCalled();
  });

  it('disableScheduledEvents delegates to service (ROK-969)', async () => {
    const result = await controller.disableScheduledEventsForTest();
    expect(result).toMatchObject({ success: true });
    expect(mockService.disableScheduledEventsForTest).toHaveBeenCalled();
  });

  it('pauseReconciliation delegates to service (ROK-969)', async () => {
    const result = await controller.pauseReconciliationForTest();
    expect(result).toMatchObject({ success: true });
    expect(mockService.pauseReconciliationForTest).toHaveBeenCalled();
  });

  it('setEventTimes delegates to service (ROK-969)', async () => {
    const result = await controller.setEventTimesForTest({
      eventId: 1,
      startTime: '2026-04-01T00:00:00Z',
      endTime: '2026-04-01T02:00:00Z',
    });
    expect(result).toMatchObject({ success: true });
    expect(mockService.setEventTimesForTest).toHaveBeenCalledWith(
      1,
      '2026-04-01T00:00:00Z',
      '2026-04-01T02:00:00Z',
    );
  });

  it('setEventTimes rejects invalid eventId', async () => {
    await expect(
      controller.setEventTimesForTest({
        eventId: -1,
        startTime: '2026-04-01T00:00:00Z',
        endTime: '2026-04-01T02:00:00Z',
      }),
    ).rejects.toThrow(/Validation failed/);
  });

  it('setEventTimes rejects non-datetime strings', async () => {
    await expect(
      controller.setEventTimesForTest({
        eventId: 1,
        startTime: 'not-a-date',
        endTime: '2026-04-01T02:00:00Z',
      }),
    ).rejects.toThrow(/Validation failed/);
  });

  it('setAutoHeartPref delegates to service (ROK-1054)', async () => {
    const result = await controller.setAutoHeartPrefForTest({
      userId: 7,
      enabled: true,
    });
    expect(result).toEqual({ success: true });
    expect(mockService.setAutoHeartPrefForTest).toHaveBeenCalledWith(7, true);
  });

  it('setAutoHeartPref accepts enabled=false', async () => {
    const result = await controller.setAutoHeartPrefForTest({
      userId: 12,
      enabled: false,
    });
    expect(result).toEqual({ success: true });
    expect(mockService.setAutoHeartPrefForTest).toHaveBeenCalledWith(12, false);
  });

  it('setAutoHeartPref rejects invalid userId', async () => {
    await expect(
      controller.setAutoHeartPrefForTest({
        userId: -1,
        enabled: true,
      }),
    ).rejects.toThrow(/Validation failed/);
  });

  it('setAutoHeartPref rejects non-boolean enabled', async () => {
    await expect(
      controller.setAutoHeartPrefForTest({
        userId: 1,
        enabled: 'yes',
      }),
    ).rejects.toThrow(/Validation failed/);
  });

  it('clearGameTimeConfirmation delegates to service (ROK-999)', async () => {
    const req = {
      user: {
        id: 1,
        username: 'test',
        role: 'admin' as const,
        discordId: null,
        impersonatedBy: null,
      },
    };
    const result = await controller.clearGameTimeConfirmationForTest(req);
    expect(result).toEqual({ success: true });
    expect(mockService.clearGameTimeConfirmationForTest).toHaveBeenCalledWith(
      1,
    );
  });
});
