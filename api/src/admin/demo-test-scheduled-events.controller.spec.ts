import { Test } from '@nestjs/testing';
import { DemoTestScheduledEventsController } from './demo-test-scheduled-events.controller';
import { DemoTestService } from './demo-test.service';
import { SettingsService } from '../settings/settings.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';

// ROK-1070: helper used by reset-events handler — mock at module level so
// the controller's direct call is observable in tests.
jest.mock('./demo-test-rok1070.helpers', () => ({
  resetEventsForTest: jest.fn().mockResolvedValue({ deletedCount: 2 }),
}));
import { resetEventsForTest as resetEventsHelperMock } from './demo-test-rok1070.helpers';

function createMockService() {
  return {
    triggerScheduledEventCompletionForTest: jest
      .fn()
      .mockResolvedValue({ success: true }),
    pauseReconciliationForTest: jest.fn().mockResolvedValue({ success: true }),
    enableScheduledEventsForTest: jest
      .fn()
      .mockResolvedValue({ success: true }),
    disableScheduledEventsForTest: jest
      .fn()
      .mockResolvedValue({ success: true }),
    cleanupScheduledEventsForTest: jest
      .fn()
      .mockResolvedValue({ success: true, deleted: 3, failed: 0, total: 3 }),
    setEventTimesForTest: jest.fn().mockResolvedValue({ success: true }),
  };
}

type MockService = ReturnType<typeof createMockService>;
type GetController = () => DemoTestScheduledEventsController;
type GetMockService = () => MockService;

describe('DemoTestScheduledEventsController', () => {
  let controller: DemoTestScheduledEventsController;
  let mockService: MockService;
  const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;

  beforeEach(async () => {
    mockService = createMockService();
    process.env.DEMO_MODE = 'true';
    (resetEventsHelperMock as jest.Mock)
      .mockReset()
      .mockResolvedValue({ deletedCount: 2 });

    const module = await Test.createTestingModule({
      controllers: [DemoTestScheduledEventsController],
      providers: [
        { provide: DemoTestService, useValue: mockService },
        {
          provide: SettingsService,
          useValue: { getDemoMode: jest.fn().mockResolvedValue(true) },
        },
        { provide: DrizzleAsyncProvider, useValue: {} },
      ],
    }).compile();

    controller = module.get(DemoTestScheduledEventsController);
  });

  afterEach(() => {
    if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
  });

  const getController = () => controller;
  const getService = () => mockService;

  describe('triggerScheduledEventCompletion', () =>
    triggerScheduledEventCompletionTests(getController, getService));
  describe('pauseReconciliation (ROK-969)', () =>
    pauseReconciliationTests(getController, getService));
  describe('enableScheduledEvents (ROK-969)', () =>
    enableScheduledEventsTests(getController, getService));
  describe('disableScheduledEvents (ROK-969)', () =>
    disableScheduledEventsTests(getController, getService));
  describe('cleanupScheduledEvents', () =>
    cleanupScheduledEventsTests(getController, getService));
  describe('setEventTimes (ROK-969)', () =>
    setEventTimesTests(getController, getService));
  describe('resetEvents (ROK-1070)', () => resetEventsTests(getController));
});

function triggerScheduledEventCompletionTests(
  getController: GetController,
  getMock: GetMockService,
) {
  it('delegates to service', async () => {
    const result =
      await getController().triggerScheduledEventCompletionForTest();
    expect(result).toMatchObject({ success: true });
    expect(getMock().triggerScheduledEventCompletionForTest).toHaveBeenCalled();
  });
}

function pauseReconciliationTests(
  getController: GetController,
  getMock: GetMockService,
) {
  it('delegates to service', async () => {
    const result = await getController().pauseReconciliationForTest();
    expect(result).toMatchObject({ success: true });
    expect(getMock().pauseReconciliationForTest).toHaveBeenCalled();
  });
}

function enableScheduledEventsTests(
  getController: GetController,
  getMock: GetMockService,
) {
  it('delegates to service', async () => {
    const result = await getController().enableScheduledEventsForTest();
    expect(result).toMatchObject({ success: true });
    expect(getMock().enableScheduledEventsForTest).toHaveBeenCalled();
  });
}

function disableScheduledEventsTests(
  getController: GetController,
  getMock: GetMockService,
) {
  it('delegates to service', async () => {
    const result = await getController().disableScheduledEventsForTest();
    expect(result).toMatchObject({ success: true });
    expect(getMock().disableScheduledEventsForTest).toHaveBeenCalled();
  });
}

function cleanupScheduledEventsTests(
  getController: GetController,
  getMock: GetMockService,
) {
  it('delegates to service', async () => {
    const result = await getController().cleanupScheduledEventsForTest();
    expect(result).toMatchObject({
      success: true,
      deleted: 3,
      failed: 0,
      total: 3,
    });
    expect(getMock().cleanupScheduledEventsForTest).toHaveBeenCalled();
  });
}

function setEventTimesTests(
  getController: GetController,
  getMock: GetMockService,
) {
  it('delegates to service', async () => {
    const result = await getController().setEventTimesForTest({
      eventId: 1,
      startTime: '2026-04-01T00:00:00Z',
      endTime: '2026-04-01T02:00:00Z',
    });
    expect(result).toMatchObject({ success: true });
    expect(getMock().setEventTimesForTest).toHaveBeenCalledWith(
      1,
      '2026-04-01T00:00:00Z',
      '2026-04-01T02:00:00Z',
    );
  });

  it('rejects invalid eventId', async () => {
    await expect(
      getController().setEventTimesForTest({
        eventId: -1,
        startTime: '2026-04-01T00:00:00Z',
        endTime: '2026-04-01T02:00:00Z',
      }),
    ).rejects.toThrow(/Validation failed/);
  });

  it('rejects non-datetime strings', async () => {
    await expect(
      getController().setEventTimesForTest({
        eventId: 1,
        startTime: 'not-a-date',
        endTime: '2026-04-01T02:00:00Z',
      }),
    ).rejects.toThrow(/Validation failed/);
  });
}

function resetEventsTests(getController: GetController) {
  it('delegates to helper with db + titlePrefix', async () => {
    const result = await getController().resetEventsForTest({
      titlePrefix: 'smoke-w0-',
    });
    expect(result).toMatchObject({ success: true, deletedCount: 2 });
    expect(resetEventsHelperMock).toHaveBeenCalledWith(
      expect.anything(),
      'smoke-w0-',
    );
  });

  it('rejects empty titlePrefix', async () => {
    await expect(
      getController().resetEventsForTest({ titlePrefix: '' }),
    ).rejects.toThrow(/Validation failed/);
  });

  it('rejects missing titlePrefix', async () => {
    await expect(getController().resetEventsForTest({})).rejects.toThrow(
      /Validation failed/,
    );
  });
}
