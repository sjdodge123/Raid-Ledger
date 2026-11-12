/**
 * ROK-2178 delta review MINOR-A — `InsightsFlights.close()` must not hang
 * shutdown: a compute superseded while closing is not re-run against a pool
 * that is about to end, and the wait on running computes is capped.
 */
import type { WowRosterInsightsDto } from '@raid-ledger/contract';
import {
  CLOSE_WAIT_MS,
  InsightsFlights,
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
