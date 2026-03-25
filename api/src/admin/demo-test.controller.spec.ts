import { Test } from '@nestjs/testing';
import { DemoTestController } from './demo-test.controller';
import { DemoTestService } from './demo-test.service';

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
  };
}

describe('DemoTestController — new test utility endpoints', () => {
  let controller: DemoTestController;
  let mockService: ReturnType<typeof createMockService>;

  beforeEach(async () => {
    mockService = createMockService();

    const module = await Test.createTestingModule({
      controllers: [DemoTestController],
      providers: [{ provide: DemoTestService, useValue: mockService }],
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
});
