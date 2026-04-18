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
  };
}

describe('DemoTestScheduledEventsController', () => {
  let controller: DemoTestScheduledEventsController;
  let mockService: ReturnType<typeof createMockService>;

  beforeEach(async () => {
    mockService = createMockService();

    const module = await Test.createTestingModule({
      controllers: [DemoTestScheduledEventsController],
      providers: [{ provide: DemoTestService, useValue: mockService }],
    }).compile();

    controller = module.get(DemoTestScheduledEventsController);
  });

  it('triggerScheduledEventCompletion delegates to service', async () => {
    const result = await controller.triggerScheduledEventCompletionForTest();
    expect(result).toMatchObject({ success: true });
    expect(
      mockService.triggerScheduledEventCompletionForTest,
    ).toHaveBeenCalled();
  });

  it('pauseReconciliation delegates to service (ROK-969)', async () => {
    const result = await controller.pauseReconciliationForTest();
    expect(result).toMatchObject({ success: true });
    expect(mockService.pauseReconciliationForTest).toHaveBeenCalled();
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
});
