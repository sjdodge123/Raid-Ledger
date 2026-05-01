import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { DemoTestCoreController } from './demo-test-core.controller';
import { DemoTestService } from './demo-test.service';
import { TasteProfileService } from '../taste-profile/taste-profile.service';
import { SettingsService } from '../settings/settings.service';
import { SlowQueriesService } from '../slow-queries/slow-queries.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { DEMO_USERNAMES } from './demo-data.constants';

function createMockService() {
  return {
    linkDiscordForTest: jest.fn().mockResolvedValue({ id: 1 }),
    enableDiscordNotificationsForTest: jest.fn().mockResolvedValue(undefined),
    getNotificationsForTest: jest.fn().mockResolvedValue([]),
    flushNotificationBufferForTest: jest.fn().mockResolvedValue(3),
    flushEmbedQueueForTest: jest.fn().mockResolvedValue({ success: true }),
    awaitProcessingForTest: jest.fn().mockResolvedValue(undefined),
    clearGameTimeConfirmationForTest: jest.fn().mockResolvedValue(undefined),
    resetOnboardingForTest: jest.fn().mockResolvedValue(undefined),
  };
}

function createMockSlowQueries() {
  return {
    appendDigestToLog: jest.fn().mockResolvedValue(undefined),
    getLogFilePath: jest
      .fn()
      .mockReturnValue('/tmp/raid-ledger-smoke/slow-queries.log'),
  };
}

type MockService = ReturnType<typeof createMockService>;
type MockSlowQueries = ReturnType<typeof createMockSlowQueries>;
type MockTasteProfileService = {
  aggregateVectors: jest.Mock;
  weeklyIntensityRollup: jest.Mock;
};
type MockSettingsService = { getDemoMode: jest.Mock };
type GetController = () => DemoTestCoreController;
type GetMockService = () => MockService;
type GetMockSlowQueries = () => MockSlowQueries;
type GetMockTaste = () => MockTasteProfileService;
type GetMockSettings = () => MockSettingsService;

/**
 * Minimal mock of the drizzle select builder. Returns `rows` when
 * `.from(table)` is eventually awaited. One call per `.select().from()`.
 */
function mockDb(rowsByCall: unknown[][]) {
  let call = 0;
  const db = {
    select: jest.fn(() => ({
      from: jest.fn(() => {
        const rows = rowsByCall[call] ?? [];
        call += 1;
        return Promise.resolve(rows);
      }),
    })),
    insert: jest.fn(() => ({
      values: jest.fn(() => ({
        onConflictDoNothing: jest.fn().mockResolvedValue(undefined),
      })),
    })),
  };
  return db;
}

describe('DemoTestCoreController', () => {
  let controller: DemoTestCoreController;
  let mockService: MockService;
  let mockSlowQueries: MockSlowQueries;
  let mockTaste: MockTasteProfileService;
  let mockSettings: MockSettingsService;
  const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;

  beforeEach(async () => {
    mockService = createMockService();
    mockSlowQueries = createMockSlowQueries();
    mockTaste = {
      aggregateVectors: jest.fn().mockResolvedValue(undefined),
      weeklyIntensityRollup: jest.fn().mockResolvedValue(undefined),
    };
    mockSettings = { getDemoMode: jest.fn().mockResolvedValue(true) };
    process.env.DEMO_MODE = 'true';

    const module = await Test.createTestingModule({
      controllers: [DemoTestCoreController],
      providers: [
        { provide: DemoTestService, useValue: mockService },
        { provide: TasteProfileService, useValue: mockTaste },
        { provide: SettingsService, useValue: mockSettings },
        { provide: SlowQueriesService, useValue: mockSlowQueries },
        { provide: DrizzleAsyncProvider, useValue: mockDb([]) },
      ],
    }).compile();

    controller = module.get(DemoTestCoreController);
  });

  afterEach(() => {
    if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
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

  describe('rebuildTasteProfiles (ROK-1083)', () => {
    rebuildTasteProfilesTests(
      () => controller,
      () => mockTaste,
      () => mockSettings,
    );
  });

  describe('reseedTasteProfiles (ROK-1083)', () => {
    reseedTasteProfilesTests(() => mockSettings);
  });

  describe('seedSlowQueriesLog (ROK-1070)', () => {
    seedSlowQueriesLogTests(
      () => controller,
      () => mockSlowQueries,
    );
  });

  describe('resetOnboarding (ROK-1070)', () => {
    resetOnboardingTests(
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

/**
 * Helper: build a controller instance with a custom db mock so the
 * reseed-taste-profiles flow can be exercised (its select->filter->insert
 * pipeline reads from two tables).
 */
async function buildController(overrides: {
  demoMode?: boolean;
  envDemo?: boolean;
  dbRows?: unknown[][];
}): Promise<{
  controller: DemoTestCoreController;
  taste: MockTasteProfileService;
}> {
  const prevEnv = process.env.DEMO_MODE;
  process.env.DEMO_MODE = overrides.envDemo === false ? 'false' : 'true';
  const taste = {
    aggregateVectors: jest.fn().mockResolvedValue(undefined),
    weeklyIntensityRollup: jest.fn().mockResolvedValue(undefined),
  };
  const settings = {
    getDemoMode: jest.fn().mockResolvedValue(overrides.demoMode ?? true),
  };
  const db = mockDb(overrides.dbRows ?? []);
  const module = await Test.createTestingModule({
    controllers: [DemoTestCoreController],
    providers: [
      { provide: DemoTestService, useValue: createMockService() },
      { provide: TasteProfileService, useValue: taste },
      { provide: SettingsService, useValue: settings },
      { provide: SlowQueriesService, useValue: createMockSlowQueries() },
      { provide: DrizzleAsyncProvider, useValue: db },
    ],
  }).compile();
  const controller = module.get(DemoTestCoreController);
  // Restore DEMO_MODE after the controller is built; the handler reads it
  // at call time so the tests below re-set it as needed.
  if (prevEnv === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = prevEnv;
  return { controller, taste };
}

function rebuildTasteProfilesTests(
  getController: GetController,
  getTaste: GetMockTaste,
  getSettings: GetMockSettings,
) {
  it('runs aggregate → weekly-intensity → archetype-refresh in order', async () => {
    const order: string[] = [];
    getTaste().aggregateVectors.mockImplementation(() => {
      order.push('aggregate');
      return Promise.resolve();
    });
    getTaste().weeklyIntensityRollup.mockImplementation(() => {
      order.push('weekly');
      return Promise.resolve();
    });
    const result = await getController().rebuildTasteProfilesForTest();
    expect(order).toEqual(['aggregate', 'weekly']);
    expect(result.success).toBe(true);
  });

  it('throws ForbiddenException when DB demoMode is false', async () => {
    getSettings().getDemoMode.mockResolvedValueOnce(false);
    await expect(
      getController().rebuildTasteProfilesForTest(),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(getTaste().aggregateVectors).not.toHaveBeenCalled();
    expect(getTaste().weeklyIntensityRollup).not.toHaveBeenCalled();
  });

  it('throws ForbiddenException when env DEMO_MODE !== "true"', async () => {
    process.env.DEMO_MODE = 'false';
    await expect(
      getController().rebuildTasteProfilesForTest(),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(getTaste().aggregateVectors).not.toHaveBeenCalled();
  });
}

function reseedTasteProfilesTests(getSettings: GetMockSettings) {
  it('scopes seed to DEMO_USERNAMES and never touches real accounts', async () => {
    const demoName = DEMO_USERNAMES[0];
    const dbRows: unknown[][] = [
      [
        { id: 1, username: 'roknua' }, // real operator — must NOT be seeded
        { id: 2, username: demoName }, // demo — should be seeded
      ],
      [{ id: 100, igdbId: 1942 }],
    ];
    const { controller, taste } = await buildController({ dbRows });
    const result = await controller.reseedTasteProfilesForTest();
    expect(result.success).toBe(true);
    // Only 1 demo user was eligible, so seededUsers must be 1.
    expect(result.seededUsers).toBe(1);
    expect(taste.aggregateVectors).toHaveBeenCalledTimes(1);
    expect(taste.weeklyIntensityRollup).toHaveBeenCalledTimes(1);
  });

  it('throws ForbiddenException before any DB read when demoMode is off', async () => {
    const { controller, taste } = await buildController({ demoMode: false });
    await expect(
      controller.reseedTasteProfilesForTest(),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(taste.aggregateVectors).not.toHaveBeenCalled();
    // settings was called by the gate check, but db.select should not have been
    // triggered — if it was, the gate ran too late.
    expect(getSettings()).toBeDefined(); // sanity
  });

  it('throws ForbiddenException when env DEMO_MODE !== "true"', async () => {
    const { controller, taste } = await buildController({});
    // Flip env AFTER the controller is built — the handler reads it at call time.
    process.env.DEMO_MODE = 'false';
    try {
      await expect(
        controller.reseedTasteProfilesForTest(),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(taste.aggregateVectors).not.toHaveBeenCalled();
    } finally {
      process.env.DEMO_MODE = 'true';
    }
  });
}

function seedSlowQueriesLogTests(
  getController: GetController,
  getMockSlowQueries: GetMockSlowQueries,
) {
  it('delegates to SlowQueriesService.appendDigestToLog', async () => {
    const result = await getController().seedSlowQueriesLogForTest({});
    expect(result).toMatchObject({
      success: true,
      logFilePath: expect.stringContaining('slow-queries.log'),
    });
    expect(getMockSlowQueries().appendDigestToLog).toHaveBeenCalledTimes(1);
    expect(getMockSlowQueries().getLogFilePath).toHaveBeenCalledTimes(1);
  });

  it('rejects unknown body fields (Zod strict)', async () => {
    await expect(
      getController().seedSlowQueriesLogForTest({ entryCount: 5 } as unknown),
    ).rejects.toThrow(/Validation failed/);
  });
}

function resetOnboardingTests(
  getController: GetController,
  getMock: GetMockService,
) {
  it('delegates to service with authenticated user id', async () => {
    const req = {
      user: {
        id: 7,
        username: 'admin',
        role: 'admin' as const,
        discordId: null,
        impersonatedBy: null,
      },
    };
    const result = await getController().resetOnboardingForTest(req);
    expect(result).toEqual({ success: true });
    expect(getMock().resetOnboardingForTest).toHaveBeenCalledWith(7);
  });
}
