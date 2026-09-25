/**
 * ROK-1527 — the startup version check must not outlive the module.
 *
 * An un-cleared `onModuleInit` timeout fired after `app.close()` and its
 * GitHub fetch pinned the finished integration spec's Jest realm.
 */
import {
  INITIAL_CHECK_DELAY_MS,
  VersionCheckService,
} from './version-check.service';

type Ctor = ConstructorParameters<typeof VersionCheckService>;

function createService(): VersionCheckService {
  const settings = { set: jest.fn().mockResolvedValue(undefined) };
  const cron = { executeWithTracking: jest.fn() };
  return new VersionCheckService(
    settings as unknown as Ctor[0],
    cron as unknown as Ctor[1],
  );
}

describe('VersionCheckService — startup timer lifecycle (ROK-1527)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('runs the initial check once the startup delay elapses', () => {
    const service = createService();
    const check = jest
      .spyOn(service, 'checkForUpdates')
      .mockResolvedValue(undefined);
    service.onModuleInit();
    jest.advanceTimersByTime(INITIAL_CHECK_DELAY_MS);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('never runs the initial check after onModuleDestroy', () => {
    const service = createService();
    const check = jest
      .spyOn(service, 'checkForUpdates')
      .mockResolvedValue(undefined);
    service.onModuleInit();
    service.onModuleDestroy();
    jest.advanceTimersByTime(INITIAL_CHECK_DELAY_MS * 2);
    expect(check).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not keep the event loop alive for the startup check', () => {
    const service = createService();
    const unref = jest.fn();
    const realSetTimeout = global.setTimeout;
    const spy = jest.spyOn(global, 'setTimeout').mockImplementation(((
      fn: () => void,
      ms?: number,
    ) => {
      const handle = realSetTimeout(fn, ms);
      handle.unref = unref.mockReturnValue(handle);
      return handle;
    }) as unknown as typeof setTimeout);
    service.onModuleInit();
    spy.mockRestore();
    service.onModuleDestroy();
    expect(unref).toHaveBeenCalledTimes(1);
  });
});
