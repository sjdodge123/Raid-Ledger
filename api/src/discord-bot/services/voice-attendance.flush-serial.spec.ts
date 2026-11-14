/**
 * VoiceAttendanceService.flushToDb — flushes are serialised.
 *
 * An interval flush still writing when `runClassification` runs `handleLeave`
 * + its own flush must not commit its older (pre-leave) row after the newer
 * flush: a flush only starts once the previous one has finished.
 */
import * as flushH from './voice-attendance-flush.helpers';
import { setupVoiceAttendanceTestModule } from './voice-attendance.service.spec-helpers';
import type { VoiceAttendanceService } from './voice-attendance.service';

jest.mock('./voice-attendance-flush.helpers', () => ({
  ...jest.requireActual('./voice-attendance-flush.helpers'),
  flushDirtySessions: jest.fn(),
}));

const mockFlushDirty = flushH.flushDirtySessions as jest.Mock;

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
}

function deferred(): Deferred {
  let resolve: () => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const settle = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

describe('VoiceAttendanceService — serialised flushes', () => {
  let service: VoiceAttendanceService;

  beforeEach(async () => {
    mockFlushDirty.mockReset();
    ({ service } = await setupVoiceAttendanceTestModule());
  });

  it('does not start a second flush until the first one has finished', async () => {
    const first = deferred();
    mockFlushDirty
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(undefined);

    const intervalFlush = service.flushToDb();
    const classifyFlush = service.flushToDb();
    await settle();
    expect(mockFlushDirty).toHaveBeenCalledTimes(1);

    first.resolve();
    await Promise.all([intervalFlush, classifyFlush]);
    expect(mockFlushDirty).toHaveBeenCalledTimes(2);
  });

  it('rejects only the failing caller and still runs the next flush', async () => {
    const first = deferred();
    mockFlushDirty
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(undefined);

    const failing = service.flushToDb();
    const next = service.flushToDb();
    first.reject(new Error('db down'));

    await expect(failing).rejects.toThrow('db down');
    await expect(next).resolves.toBeUndefined();
    expect(mockFlushDirty).toHaveBeenCalledTimes(2);
  });
});
