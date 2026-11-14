/**
 * VoiceAttendanceService periodic flush — interval ticks coalesce.
 *
 * Flushes are serialised, so a hung write would otherwise let every 30 s
 * tick enqueue another flush behind it without bound. A tick is skipped
 * while a periodic flush is already queued or in flight; explicit
 * `flushToDb()` calls always run, in order.
 */
import * as flushH from './voice-attendance-flush.helpers';
import { setupVoiceAttendanceTestModule } from './voice-attendance.service.spec-helpers';
import type { VoiceAttendanceService } from './voice-attendance.service';

jest.mock('./voice-attendance-flush.helpers', () => ({
  ...jest.requireActual('./voice-attendance-flush.helpers'),
  flushDirtySessions: jest.fn(),
}));

const mockFlushDirty = flushH.flushDirtySessions as jest.Mock;
const TICK_MS = 30_000;

function hungWrite(): { promise: Promise<void>; release: () => void } {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

const settle = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

describe('VoiceAttendanceService — periodic flush ticks coalesce', () => {
  let service: VoiceAttendanceService;

  beforeEach(async () => {
    mockFlushDirty.mockReset();
    ({ service } = await setupVoiceAttendanceTestModule());
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    service.onModuleInit();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('queues at most one periodic flush behind a hung write', async () => {
    const hung = hungWrite();
    mockFlushDirty
      .mockReturnValueOnce(hung.promise)
      .mockResolvedValue(undefined);

    const explicit = service.flushToDb();
    jest.advanceTimersByTime(TICK_MS * 5);
    await settle();
    expect(mockFlushDirty).toHaveBeenCalledTimes(1);

    hung.release();
    await explicit;
    for (let i = 0; i < 10; i++) await settle();
    // 1 hung explicit flush + 1 coalesced periodic flush, not 1 + 5.
    expect(mockFlushDirty).toHaveBeenCalledTimes(2);
  });

  it('ticks again once the pending periodic flush has settled', async () => {
    mockFlushDirty.mockResolvedValue(undefined);

    jest.advanceTimersByTime(TICK_MS);
    await settle();
    jest.advanceTimersByTime(TICK_MS);
    await settle();

    expect(mockFlushDirty).toHaveBeenCalledTimes(2);
  });

  it('always runs explicit flushes while a periodic flush is pending', async () => {
    const hung = hungWrite();
    mockFlushDirty
      .mockReturnValueOnce(hung.promise)
      .mockResolvedValue(undefined);

    jest.advanceTimersByTime(TICK_MS);
    await settle();
    const first = service.flushToDb();
    const second = service.flushToDb();
    hung.release();
    await Promise.all([first, second]);

    expect(mockFlushDirty).toHaveBeenCalledTimes(3);
  });
});
