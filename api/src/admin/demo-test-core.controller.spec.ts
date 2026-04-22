import { Test } from '@nestjs/testing';
import { DemoTestCoreController } from './demo-test-core.controller';
import { DemoTestService } from './demo-test.service';
import { TasteProfileService } from '../taste-profile/taste-profile.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';

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

type MockService = ReturnType<typeof createMockService>;
type GetController = () => DemoTestCoreController;
type GetMockService = () => MockService;

describe('DemoTestCoreController', () => {
  let controller: DemoTestCoreController;
  let mockService: MockService;

  beforeEach(async () => {
    mockService = createMockService();

    const module = await Test.createTestingModule({
      controllers: [DemoTestCoreController],
      providers: [
        { provide: DemoTestService, useValue: mockService },
        {
          provide: TasteProfileService,
          useValue: {
            aggregateVectors: jest.fn().mockResolvedValue(undefined),
            weeklyIntensityRollup: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: DrizzleAsyncProvider, useValue: {} },
      ],
    }).compile();

    controller = module.get(DemoTestCoreController);
  });

  describe('linkDiscord', () => {
    linkDiscordTests(
      () => controller,
      () => mockService,
    );
  });

  describe('enableDiscordNotifications', () => {
    enableDiscordNotificationsTests(
      () => controller,
      () => mockService,
    );
  });

  describe('getNotifications', () => {
    getNotificationsTests(
      () => controller,
      () => mockService,
    );
  });

  describe('flushNotificationBuffer', () => {
    flushNotificationBufferTests(
      () => controller,
      () => mockService,
    );
  });

  describe('flushEmbedQueue', () => {
    flushEmbedQueueTests(
      () => controller,
      () => mockService,
    );
  });

  describe('awaitProcessing', () => {
    awaitProcessingTests(
      () => controller,
      () => mockService,
    );
  });

  describe('clearGameTimeConfirmation (ROK-999)', () => {
    clearGameTimeConfirmationTests(
      () => controller,
      () => mockService,
    );
  });
});

function linkDiscordTests(
  getController: GetController,
  getMock: GetMockService,
) {
  it('delegates to service', async () => {
    const result = await getController().linkDiscordForTest({
      userId: 1,
      discordId: '123456789012345678',
      username: 'tester',
    });
    expect(result).toEqual({ success: true, user: { id: 1 } });
    expect(getMock().linkDiscordForTest).toHaveBeenCalledWith(
      1,
      '123456789012345678',
      'tester',
    );
  });

  it('rejects malformed discordId', async () => {
    await expect(
      getController().linkDiscordForTest({
        userId: 1,
        discordId: 'bad',
        username: 'x',
      }),
    ).rejects.toThrow(/Validation failed/);
  });
}

function enableDiscordNotificationsTests(
  getController: GetController,
  getMock: GetMockService,
) {
  it('delegates to service', async () => {
    const result = await getController().enableDiscordNotificationsForTest({
      userId: 7,
    });
    expect(result).toEqual({ success: true });
    expect(getMock().enableDiscordNotificationsForTest).toHaveBeenCalledWith(7);
  });
}

function getNotificationsTests(
  getController: GetController,
  getMock: GetMockService,
) {
  it('requires userId', async () => {
    await expect(getController().getNotificationsForTest('0')).rejects.toThrow(
      /userId required/,
    );
  });

  it('delegates with defaults', async () => {
    const result = await getController().getNotificationsForTest('5');
    expect(result).toEqual([]);
    expect(getMock().getNotificationsForTest).toHaveBeenCalledWith(
      5,
      undefined,
      20,
    );
  });

  it('accepts type and limit', async () => {
    await getController().getNotificationsForTest('5', 'dm', '50');
    expect(getMock().getNotificationsForTest).toHaveBeenCalledWith(5, 'dm', 50);
  });
}

function flushNotificationBufferTests(
  getController: GetController,
  getMock: GetMockService,
) {
  it('returns count', async () => {
    const result = await getController().flushNotificationBufferForTest();
    expect(result).toEqual({ success: true, flushed: 3 });
    expect(getMock().flushNotificationBufferForTest).toHaveBeenCalled();
  });
}

function flushEmbedQueueTests(
  getController: GetController,
  getMock: GetMockService,
) {
  it('returns success', async () => {
    const result = await getController().flushEmbedQueueForTest();
    expect(result).toMatchObject({ success: true });
    expect(getMock().flushEmbedQueueForTest).toHaveBeenCalled();
  });
}

function awaitProcessingTests(
  getController: GetController,
  getMock: GetMockService,
) {
  it('returns success with default timeout', async () => {
    const result = await getController().awaitProcessingForTest({});
    expect(result).toMatchObject({ success: true });
    expect(getMock().awaitProcessingForTest).toHaveBeenCalledWith(30000);
  });

  it('accepts custom timeout', async () => {
    const result = await getController().awaitProcessingForTest({
      timeoutMs: 5000,
    });
    expect(result).toMatchObject({ success: true });
    expect(getMock().awaitProcessingForTest).toHaveBeenCalledWith(5000);
  });
}

function clearGameTimeConfirmationTests(
  getController: GetController,
  getMock: GetMockService,
) {
  it('delegates to service', async () => {
    const req = {
      user: {
        id: 1,
        username: 'test',
        role: 'admin' as const,
        discordId: null,
        impersonatedBy: null,
      },
    };
    const result = await getController().clearGameTimeConfirmationForTest(req);
    expect(result).toEqual({ success: true });
    expect(getMock().clearGameTimeConfirmationForTest).toHaveBeenCalledWith(1);
  });
}
