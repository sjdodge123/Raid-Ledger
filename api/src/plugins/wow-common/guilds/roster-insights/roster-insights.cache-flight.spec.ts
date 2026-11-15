/**
 * ROK-2178 delta review MINOR-A — `InsightsFlights.close()` must not hang
 * shutdown: a compute superseded while closing is not re-run against a pool
 * that is about to end, and the wait on running computes is capped.
 */
import type { WowRosterInsightsDto } from '@raid-ledger/contract';
import {
  CLOSE_WAIT_MS,
  InsightsFlights,
  MAX_COMPUTE_ATTEMPTS,
  type FlightHooks,
} from './roster-insights.cache-flight';

const dto = (tag: string): WowRosterInsightsDto =>
  ({ classes: [{ class: tag, count: 1 }] }) as unknown as WowRosterInsightsDto;

function makeHooks(): jest.Mocked<FlightHooks> {
  return {
    store: jest.fn<void, [string, WowRosterInsightsDto]>(),
    isCached: jest.fn<boolean, [string]>(() => false),
  };
}

describe('InsightsFlights.close', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not re-run a compute superseded during shutdown', async () => {
    const hooks = makeHooks();
    const flights = new InsightsFlights(hooks);
    let release: (v: WowRosterInsightsDto) => void = () => undefined;
    const first = new Promise<WowRosterInsightsDto>((res) => {
      release = res;
    });
    const compute = jest
      .fn<Promise<WowRosterInsightsDto>, []>()
      .mockReturnValueOnce(first)
      .mockResolvedValue(dto('rerun'));
    const flight = flights.run('k', compute);
    flights.bumpPrefix('k');
    const closing = flights.close();
    release(dto('old'));
    const outcome = await flight;
    await closing;
    expect(compute).toHaveBeenCalledTimes(1);
    expect(outcome.current).toBe(false);
    expect(hooks.store).not.toHaveBeenCalled();
  });

  it('resolves within the cap when a compute never settles', async () => {
    jest.useFakeTimers();
    const flights = new InsightsFlights(makeHooks());
    void flights.run('k', () => new Promise<WowRosterInsightsDto>(() => {}));
    let done = false;
    void flights.close().then(() => {
      done = true;
    });
    await jest.advanceTimersByTimeAsync(CLOSE_WAIT_MS - 1);
    expect(done).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('clears its cap timer when every compute settles first', async () => {
    jest.useFakeTimers();
    const flights = new InsightsFlights(makeHooks());
    void flights.run('k', () => Promise.resolve(dto('new')));
    await flights.close();
    expect(jest.getTimerCount()).toBe(0);
  });
});

/**
 * TECH-DEBT td8 — a warm asked for while the key is in flight is replayed
 * when that compute exhausts its attempts without storing (every attempt
 * superseded), so the key is not left cold for the next reader.
 */
describe('InsightsFlights.scheduleWarm while in flight', () => {
  it('re-warms a key whose in-flight compute exhausts its attempts', async () => {
    const hooks = makeHooks();
    const flights = new InsightsFlights(hooks);
    const compute = jest.fn(() => {
      flights.bumpPrefix('k');
      return Promise.resolve(dto('stale'));
    });
    const warm = jest.fn(() => Promise.resolve(dto('warm')));
    const flight = flights.run('k', compute);
    flights.scheduleWarm('k', warm);
    const outcome = await flight;
    // close() waits for the replayed warm, which is already running.
    await flights.close();
    expect(compute).toHaveBeenCalledTimes(MAX_COMPUTE_ATTEMPTS);
    expect(outcome.current).toBe(false);
    expect(warm).toHaveBeenCalledTimes(1);
    expect(hooks.store).toHaveBeenCalledWith('k', dto('warm'));
  });

  it('replays a mark once — the replayed warm takes no mark of its own', async () => {
    const hooks = makeHooks();
    const flights = new InsightsFlights(hooks);
    const superseded = jest.fn(() => {
      flights.bumpPrefix('k');
      return Promise.resolve(dto('stale'));
    });
    // Every warm attempt asks for another warm and is superseded; the cap
    // only keeps a regression (self-re-marking replay) from spinning forever.
    const warm = jest.fn(async () => {
      await Promise.resolve();
      if (warm.mock.calls.length < 10) flights.scheduleWarm('k', warm);
      flights.bumpPrefix('k');
      return dto('stale');
    });
    const flight = flights.run('k', superseded);
    flights.scheduleWarm('k', warm);
    await flight;
    expect(flights.isRunning('k')).toBe(true);
    const unused = jest.fn(() => Promise.resolve(dto('unused')));
    expect((await flights.run('k', unused)).current).toBe(false);
    expect(warm).toHaveBeenCalledTimes(MAX_COMPUTE_ATTEMPTS);
    expect(flights.isRunning('k')).toBe(false);
    expect(unused).not.toHaveBeenCalled();
    expect(hooks.store).not.toHaveBeenCalled();
    await flights.close();
  });

  it('drops the warm mark when the in-flight compute stores', async () => {
    const hooks = makeHooks();
    const flights = new InsightsFlights(hooks);
    const warm = jest.fn(() => Promise.resolve(dto('warm')));
    const flight = flights.run('k', () => Promise.resolve(dto('fresh')));
    flights.scheduleWarm('k', warm);
    expect((await flight).current).toBe(true);
    await flights.close();
    expect(warm).not.toHaveBeenCalled();
    expect(hooks.store).toHaveBeenCalledTimes(1);
    expect(hooks.store).toHaveBeenCalledWith('k', dto('fresh'));
  });
});
