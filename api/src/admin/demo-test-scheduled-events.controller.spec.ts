import { Test } from '@nestjs/testing';
import { DemoTestScheduledEventsController } from './demo-test-scheduled-events.controller';
import { DemoTestService } from './demo-test.service';

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
    resetEventsForTest: jest.fn().mockResolvedValue({ deletedCount: 2 }),
  };
}

type MockService = ReturnType<typeof createMockService>;
type GetController = () => DemoTestScheduledEventsController;
type GetMockService = () => MockService;

describe('DemoTestScheduledEventsController', () => {
  let controller: DemoTestScheduledEventsController;
  let mockService: MockService;

  beforeEach(async () => {
    mockService = createMockService();

    const module = await Test.createTestingModule({
      controllers: [DemoTestScheduledEventsController],
      providers: [{ provide: DemoTestService, useValue: mockService }],
    }).compile();

    controller = module.get(DemoTestScheduledEventsController);
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
  describe('resetEvents (ROK-1070)', () =>
    resetEventsTests(getController, getService));
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

function resetEventsTests(
  getController: GetController,
  getMock: GetMockService,
) {
  it('delegates to service with titlePrefix', async () => {
    const result = await getController().resetEventsForTest({
      titlePrefix: 'smoke-w0-',
    });
    expect(result).toMatchObject({ success: true, deletedCount: 2 });
    expect(getMock().resetEventsForTest).toHaveBeenCalledWith('smoke-w0-');
  });

  it('rejects empty titlePrefix', async () => {
    await expect(
      getController().resetEventsForTest({ titlePrefix: '' }),
    ).rejects.toThrow(/Validation failed/);
  });

  it('rejects missing titlePrefix', async () => {
    await expect(
      getController().resetEventsForTest({} as never),
    ).rejects.toThrow(/Validation failed/);
  });
}
