import { Test } from '@nestjs/testing';
import { DemoTestCoreController } from './demo-test-core.controller';
import { DemoTestService } from './demo-test.service';

function createMockService() {
  return {
    linkDiscordForTest: jest.fn().mockResolvedValue({ id: 1 }),
    enableDiscordNotificationsForTest: jest.fn().mockResolvedValue(undefined),
    getNotificationsForTest: jest.fn().mockResolvedValue([]),
    flushNotificationBufferForTest: jest.fn().mockResolvedValue(3),
    flushEmbedQueueForTest: jest.fn().mockResolvedValue({ success: true }),
    awaitProcessingForTest: jest.fn().mockResolvedValue(undefined),
    clearGameTimeConfirmationForTest: jest.fn().mockResolvedValue(undefined),
  };
}

describe('DemoTestCoreController', () => {
  let controller: DemoTestCoreController;
  let mockService: ReturnType<typeof createMockService>;

  beforeEach(async () => {
    mockService = createMockService();

    const module = await Test.createTestingModule({
      controllers: [DemoTestCoreController],
      providers: [{ provide: DemoTestService, useValue: mockService }],
    }).compile();

    controller = module.get(DemoTestCoreController);
  });

  it('linkDiscord delegates to service', async () => {
    const result = await controller.linkDiscordForTest({
      userId: 1,
      discordId: '123456789012345678',
      username: 'tester',
    });
    expect(result).toEqual({ success: true, user: { id: 1 } });
    expect(mockService.linkDiscordForTest).toHaveBeenCalledWith(
      1,
      '123456789012345678',
      'tester',
    );
  });

  it('linkDiscord rejects malformed discordId', async () => {
    await expect(
      controller.linkDiscordForTest({
        userId: 1,
        discordId: 'bad',
        username: 'x',
      }),
    ).rejects.toThrow(/Validation failed/);
  });

  it('enableDiscordNotifications delegates to service', async () => {
    const result = await controller.enableDiscordNotificationsForTest({
      userId: 7,
    });
    expect(result).toEqual({ success: true });
    expect(mockService.enableDiscordNotificationsForTest).toHaveBeenCalledWith(
      7,
    );
  });

  it('getNotifications requires userId', async () => {
    await expect(controller.getNotificationsForTest('0')).rejects.toThrow(
      /userId required/,
    );
  });

  it('getNotifications delegates with defaults', async () => {
    const result = await controller.getNotificationsForTest('5');
    expect(result).toEqual([]);
    expect(mockService.getNotificationsForTest).toHaveBeenCalledWith(
      5,
      undefined,
      20,
    );
  });

  it('getNotifications accepts type and limit', async () => {
    await controller.getNotificationsForTest('5', 'dm', '50');
    expect(mockService.getNotificationsForTest).toHaveBeenCalledWith(
      5,
      'dm',
      50,
    );
  });

  it('flushNotificationBuffer returns count', async () => {
    const result = await controller.flushNotificationBufferForTest();
    expect(result).toEqual({ success: true, flushed: 3 });
    expect(mockService.flushNotificationBufferForTest).toHaveBeenCalled();
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
