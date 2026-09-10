/**
 * Per-phase reminder timing (ROK-1201).
 *
 * The point of this helper is that a 3.7s cron run tells you WHICH phase was
 * slow. Two properties carry that: the phase name reaches the PERF line, and a
 * phase that throws is still timed — a slow failing phase is exactly the one
 * worth a duration, and it is the case a naive `await` + log after would lose.
 */
import { perfLog } from '../common/perf-logger';
import { timedPhase } from './event-reminder-timing.helpers';

jest.mock('../common/perf-logger', () => ({ perfLog: jest.fn() }));

const perfLogMock = perfLog as jest.MockedFunction<typeof perfLog>;

describe('timedPhase', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the phase result untouched', async () => {
    const result = await timedPhase('fetchCandidateEvents', {}, () =>
      Promise.resolve([1, 2, 3]),
    );

    expect(result).toEqual([1, 2, 3]);
  });

  it('emits a CRON line namespaced to the service', async () => {
    await timedPhase('fetchCandidateEvents', {}, () => Promise.resolve(null));

    expect(perfLogMock).toHaveBeenCalledTimes(1);
    const [category, operation] = perfLogMock.mock.calls[0];
    expect(category).toBe('CRON');
    // Must match the existing EventReminderService_handleReminders line so the
    // phases group with the total they break down.
    expect(operation).toBe('EventReminderService_fetchCandidateEvents');
  });

  it('passes phase metadata through to the log line', async () => {
    await timedPhase('window_24hour', { events: 3 }, () =>
      Promise.resolve(undefined),
    );

    expect(perfLogMock.mock.calls[0][3]).toEqual({ events: 3 });
  });

  it('reports a non-negative duration', async () => {
    await timedPhase('loadSettings', {}, () => Promise.resolve('UTC'));

    expect(perfLogMock.mock.calls[0][2]).toBeGreaterThanOrEqual(0);
  });

  it('still times a phase that throws, and re-throws it', async () => {
    const boom = new Error('query timed out');

    await expect(
      timedPhase('fetchCandidateEvents', {}, () => Promise.reject(boom)),
    ).rejects.toThrow('query timed out');

    // The failure must not swallow its own duration.
    expect(perfLogMock).toHaveBeenCalledTimes(1);
    expect(perfLogMock.mock.calls[0][1]).toBe(
      'EventReminderService_fetchCandidateEvents',
    );
  });
});
