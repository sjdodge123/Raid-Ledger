import { PerfMemoryMonitor } from './perf-memory-monitor';

// Capture the real memoryUsage before mocking
const realMemoryUsage = process.memoryUsage.bind(process);

describe('PerfMemoryMonitor', () => {
  let monitor: PerfMemoryMonitor;
  let exitSpy: jest.SpyInstance;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.useFakeTimers();
    // Prevent actual process exit in tests
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {
      return undefined as never;
    });
  });

  afterEach(() => {
    monitor?.onModuleDestroy();
    jest.useRealTimers();
    jest.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  function createMonitor(): PerfMemoryMonitor {
    // Constructor reads env vars, so set them before instantiation
    monitor = new PerfMemoryMonitor();
    return monitor;
  }

  describe('RSS restart guard', () => {
    it('does not exit when RSS is below threshold', () => {
      process.env.MEMORY_RESTART_THRESHOLD_MB = '512';
      process.env.DEBUG = 'true';

      // Mock RSS at 100MB — well below 512MB threshold
      jest.spyOn(process, 'memoryUsage').mockReturnValue({
        ...realMemoryUsage(),
        rss: 100 * 1024 * 1024,
      });

      createMonitor();
      monitor.onModuleInit();

      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('triggers process.exit(0) when RSS exceeds threshold', () => {
      process.env.MEMORY_RESTART_THRESHOLD_MB = '200';
      process.env.DEBUG = 'true';

      // Mock RSS at 250MB — above 200MB threshold
      jest.spyOn(process, 'memoryUsage').mockReturnValue({
        ...realMemoryUsage(),
        rss: 250 * 1024 * 1024,
      });

      createMonitor();
      monitor.onModuleInit();

      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it('checks RSS on each interval tick', () => {
      process.env.MEMORY_RESTART_THRESHOLD_MB = '200';
      process.env.DEBUG = 'true';

      const memSpy = jest.spyOn(process, 'memoryUsage');
      // Initial: under threshold
      memSpy.mockReturnValue({
        ...realMemoryUsage(),
        rss: 100 * 1024 * 1024,
      });

      createMonitor();
      monitor.onModuleInit();
      expect(exitSpy).not.toHaveBeenCalled();

      // Simulate RSS growth above threshold on next tick
      memSpy.mockReturnValue({
        ...realMemoryUsage(),
        rss: 250 * 1024 * 1024,
      });

      jest.advanceTimersByTime(5 * 60 * 1000);
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it('does nothing when MEMORY_RESTART_THRESHOLD_MB is not set', () => {
      delete process.env.MEMORY_RESTART_THRESHOLD_MB;
      process.env.DEBUG = 'true';

      // Mock very high RSS — should not trigger exit without threshold
      jest.spyOn(process, 'memoryUsage').mockReturnValue({
        ...realMemoryUsage(),
        rss: 2000 * 1024 * 1024,
      });

      createMonitor();
      monitor.onModuleInit();

      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('ignores invalid MEMORY_RESTART_THRESHOLD_MB values', () => {
      process.env.MEMORY_RESTART_THRESHOLD_MB = 'not-a-number';
      process.env.DEBUG = 'true';

      jest.spyOn(process, 'memoryUsage').mockReturnValue({
        ...realMemoryUsage(),
        rss: 2000 * 1024 * 1024,
      });

      createMonitor();
      monitor.onModuleInit();

      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('starts the interval when only RSS guard is active (DEBUG=false)', () => {
      process.env.MEMORY_RESTART_THRESHOLD_MB = '200';
      process.env.DEBUG = 'false';

      const memSpy = jest.spyOn(process, 'memoryUsage');
      memSpy.mockReturnValue({
        ...realMemoryUsage(),
        rss: 100 * 1024 * 1024,
      });

      createMonitor();
      monitor.onModuleInit();

      // Should still check on interval even without DEBUG
      memSpy.mockReturnValue({
        ...realMemoryUsage(),
        rss: 250 * 1024 * 1024,
      });

      jest.advanceTimersByTime(5 * 60 * 1000);
      expect(exitSpy).toHaveBeenCalledWith(0);
    });
  });

  describe('interval lifecycle', () => {
    it('does not start interval when both DEBUG and threshold are disabled', () => {
      delete process.env.MEMORY_RESTART_THRESHOLD_MB;
      process.env.DEBUG = 'false';

      const memSpy = jest.spyOn(process, 'memoryUsage');

      createMonitor();
      monitor.onModuleInit();

      // Advance time — memoryUsage should not be called (no interval)
      memSpy.mockClear();
      jest.advanceTimersByTime(5 * 60 * 1000);
      expect(memSpy).not.toHaveBeenCalled();
    });

    it('cleans up interval on module destroy', () => {
      process.env.DEBUG = 'true';

      createMonitor();
      monitor.onModuleInit();

      const memSpy = jest.spyOn(process, 'memoryUsage');
      memSpy.mockClear();

      monitor.onModuleDestroy();

      jest.advanceTimersByTime(5 * 60 * 1000);
      expect(memSpy).not.toHaveBeenCalled();
    });
  });
});
