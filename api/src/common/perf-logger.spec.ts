import { Logger } from '@nestjs/common';
import { formatDurationMs, isPerfEnabled, perfLog } from './perf-logger';

describe('formatDurationMs', () => {
  it('clamps zero/negative to 0ms', () => {
    expect(formatDurationMs(0)).toBe('0ms');
    expect(formatDurationMs(-5)).toBe('0ms');
  });

  it('keeps two decimals for sub-ms durations (so cached lookups differ from 0)', () => {
    expect(formatDurationMs(0.4)).toBe('0.40ms');
    expect(formatDurationMs(0.123)).toBe('0.12ms');
    expect(formatDurationMs(0.999)).toBe('1.00ms');
  });

  it('rounds to integer ms for >= 1ms', () => {
    expect(formatDurationMs(1)).toBe('1ms');
    expect(formatDurationMs(50)).toBe('50ms');
    expect(formatDurationMs(50.4)).toBe('50ms');
    expect(formatDurationMs(50.6)).toBe('51ms');
    expect(formatDurationMs(1500)).toBe('1500ms');
  });

  it('returns 0ms for non-finite input', () => {
    expect(formatDurationMs(NaN)).toBe('0ms');
    expect(formatDurationMs(Infinity)).toBe('0ms');
  });
});

describe('isPerfEnabled', () => {
  const originalDebug = process.env.DEBUG;
  afterEach(() => {
    process.env.DEBUG = originalDebug;
  });

  it('returns true only when DEBUG is exactly "true"', () => {
    process.env.DEBUG = 'true';
    expect(isPerfEnabled()).toBe(true);
    process.env.DEBUG = 'false';
    expect(isPerfEnabled()).toBe(false);
    process.env.DEBUG = '1';
    expect(isPerfEnabled()).toBe(false);
    delete process.env.DEBUG;
    expect(isPerfEnabled()).toBe(false);
  });
});

describe('perfLog', () => {
  const originalDebug = process.env.DEBUG;
  let debugSpy: jest.SpyInstance;

  beforeEach(() => {
    debugSpy = jest
      .spyOn(Logger.prototype, 'debug')
      .mockImplementation(() => {});
  });

  afterEach(() => {
    debugSpy.mockRestore();
    process.env.DEBUG = originalDebug;
  });

  it('emits nothing when DEBUG is not "true"', () => {
    process.env.DEBUG = 'false';
    perfLog('DB', 'query', 12.4);
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it('emits a sub-ms-aware [PERF] DB line for sub-ms durations', () => {
    process.env.DEBUG = 'true';
    perfLog('DB', 'query', 0.42, { table: 'users' });
    expect(debugSpy).toHaveBeenCalledTimes(1);
    const line = debugSpy.mock.calls[0][0] as string;
    expect(line).toBe('[PERF] DB | query | 0.42ms | table=users');
  });

  it('emits an integer-ms [PERF] HTTP line for >= 1ms durations (no regression for HTTP/CRON)', () => {
    process.env.DEBUG = 'true';
    perfLog('HTTP', 'GET /api/events', 50, { status: 200, userId: 7 });
    const line = debugSpy.mock.calls[0][0] as string;
    expect(line).toBe(
      '[PERF] HTTP | GET /api/events | 50ms | status=200 userId=7',
    );
  });

  it('emits 1500ms for a slow CRON job (no regression for CRON)', () => {
    process.env.DEBUG = 'true';
    perfLog('CRON', 'reminder-sweep', 1500, { status: 'ok' });
    const line = debugSpy.mock.calls[0][0] as string;
    expect(line).toBe('[PERF] CRON | reminder-sweep | 1500ms | status=ok');
  });

  it('skips empty meta values', () => {
    process.env.DEBUG = 'true';
    perfLog('DB', 'query', 0.5, {
      table: 'users',
      userId: undefined,
      foo: null,
    });
    const line = debugSpy.mock.calls[0][0] as string;
    expect(line).toBe('[PERF] DB | query | 0.50ms | table=users');
  });
});
