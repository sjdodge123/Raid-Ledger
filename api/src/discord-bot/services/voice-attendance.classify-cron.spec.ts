import { VoiceAttendanceService } from './voice-attendance.service';
import type { MockDb } from '../../common/testing/drizzle-mock';
import * as flushH from './voice-attendance-flush.helpers';
import * as classifyH from './voice-attendance-classify.helpers';
import { setupVoiceAttendanceTestModule } from './voice-attendance.service.spec-helpers';

jest.mock('./voice-attendance-flush.helpers', () => ({
  ...jest.requireActual('./voice-attendance-flush.helpers'),
  queryActiveEvents: jest.fn().mockResolvedValue([]),
  findActiveEventsForChannel: jest.fn().mockResolvedValue([]),
  fetchEndedEvents: jest.fn().mockResolvedValue([]),
  flushSingleSession: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('./voice-attendance-classify.helpers', () => ({
  ...jest.requireActual('./voice-attendance-classify.helpers'),
  shouldClassifyEvent: jest.fn().mockResolvedValue(true),
  classifyEventSessions: jest.fn().mockResolvedValue(undefined),
  autoPopulateAttendance: jest.fn().mockResolvedValue(undefined),
}));

const mockFetchEndedEvents = flushH.fetchEndedEvents as jest.Mock;
const mockShouldClassify = classifyH.shouldClassifyEvent as jest.Mock;
const mockClassifyEventSessions = classifyH.classifyEventSessions as jest.Mock;
const mockAutoPopulate = classifyH.autoPopulateAttendance as jest.Mock;

/** Build a minimal fake event row for testing. */
function fakeEvent(
  id: number,
  startHoursAgo: number,
  durationHours: number,
): { id: number; duration: [Date, Date] } {
  const now = Date.now();
  const start = new Date(now - startHoursAgo * 3_600_000);
  const end = new Date(start.getTime() + durationHours * 3_600_000);
  return { id, duration: [start, end] } as never;
}

describe('VoiceAttendanceService — classification cron', () => {
  let service: VoiceAttendanceService;
  let mockDb: MockDb;

  beforeEach(async () => {
    const mocks = await setupVoiceAttendanceTestModule();
    service = mocks.service;
    mockDb = mocks.mockDb;

    mockFetchEndedEvents.mockReset().mockResolvedValue([]);
    mockShouldClassify.mockReset().mockResolvedValue(true);
    mockClassifyEventSessions.mockReset().mockResolvedValue(undefined);
    mockAutoPopulate.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('skips already-classified events on subsequent runs', async () => {
    const event = fakeEvent(105, 1, 2);
    mockFetchEndedEvents.mockResolvedValue([event]);
    mockShouldClassify.mockResolvedValue(true);

    // First run — should classify event 105
    await service.classifyCompletedEvents();
    expect(mockClassifyEventSessions).toHaveBeenCalledTimes(1);

    mockClassifyEventSessions.mockClear();
    mockAutoPopulate.mockClear();
    mockShouldClassify.mockClear();

    // Second run — event 105 should be skipped (already classified)
    mockFetchEndedEvents.mockResolvedValue([event]);
    await service.classifyCompletedEvents();
    expect(mockClassifyEventSessions).not.toHaveBeenCalled();
  });

  it('adds event ID to classified set after successful classification', async () => {
    const event = fakeEvent(42, 1, 2);
    mockFetchEndedEvents.mockResolvedValue([event]);
    mockShouldClassify.mockResolvedValue(true);

    await service.classifyCompletedEvents();

    expect(mockClassifyEventSessions).toHaveBeenCalledTimes(1);
    expect(mockAutoPopulate).toHaveBeenCalledTimes(1);

    // Verify event is now skipped on next run
    mockClassifyEventSessions.mockClear();
    mockFetchEndedEvents.mockResolvedValue([event]);
    await service.classifyCompletedEvents();
    expect(mockClassifyEventSessions).not.toHaveBeenCalled();
  });

  it('does not mark event as classified when shouldClassifyEvent returns false', async () => {
    const event = fakeEvent(99, 1, 2);
    mockFetchEndedEvents.mockResolvedValue([event]);
    mockShouldClassify.mockResolvedValue(false);

    await service.classifyCompletedEvents();

    // shouldClassifyEvent returned false, so classify was never called
    expect(mockClassifyEventSessions).not.toHaveBeenCalled();

    // On next run, shouldClassify now returns true — event should be processed
    mockShouldClassify.mockResolvedValue(true);
    mockFetchEndedEvents.mockResolvedValue([event]);
    await service.classifyCompletedEvents();
    expect(mockClassifyEventSessions).toHaveBeenCalledTimes(1);
  });

  it('still classifies non-classified events when some are already classified', async () => {
    const event1 = fakeEvent(10, 1, 2);
    const event2 = fakeEvent(20, 1, 2);

    // First run — classify event 10 only
    mockFetchEndedEvents.mockResolvedValue([event1]);
    await service.classifyCompletedEvents();
    expect(mockClassifyEventSessions).toHaveBeenCalledTimes(1);

    mockClassifyEventSessions.mockClear();
    mockAutoPopulate.mockClear();

    // Second run — both events returned, but event 10 should be skipped
    mockFetchEndedEvents.mockResolvedValue([event1, event2]);
    await service.classifyCompletedEvents();
    expect(mockClassifyEventSessions).toHaveBeenCalledTimes(1);
    expect(mockClassifyEventSessions).toHaveBeenCalledWith(
      mockDb,
      20,
      event2,
      expect.any(Number),
      expect.anything(),
    );
  });

  it('uses a 2-hour lookback window instead of 24-hour', async () => {
    mockFetchEndedEvents.mockResolvedValue([]);

    await service.classifyCompletedEvents();

    expect(mockFetchEndedEvents).toHaveBeenCalledWith(
      mockDb,
      expect.any(Date),
      7_200_000,
    );
  });
});
