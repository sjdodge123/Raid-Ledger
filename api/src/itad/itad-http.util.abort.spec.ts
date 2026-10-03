/**
 * Tests for cancelling an ITAD call through `ItadFetchOptions.signal`.
 * An aborted call must stop at once: no network-error backoff sleep, no
 * further attempt, and the same null / `ItadRetriesExhaustedError` outcome as
 * any other exhausted call. A call without a signal is unchanged.
 */
import { at } from '../common/testing/narrow';
import { ITAD_BACKOFF_INITIAL_MS, ITAD_MAX_RETRIES } from './itad.constants';
import type * as HttpUtilModule from './itad-http.util';

// Mock global fetch before importing
const mockFetch = jest.fn();
global.fetch = mockFetch;

type HttpUtil = typeof HttpUtilModule;

const T0 = Date.parse('2026-10-02T04:00:00Z');
/** Every backoff sleep a call could take across all of its retries. */
const retryWindowMs = ITAD_BACKOFF_INITIAL_MS * (2 ** ITAD_MAX_RETRIES - 1);

/** Fresh util per test: the pacer's state is module-global. */
function loadFreshUtil(): HttpUtil {
  let util = {} as HttpUtil;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    util = require('./itad-http.util') as HttpUtil;
  });
  return util;
}

/** Build a fake fetch Response for a given status. */
function res(status: number, body?: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: () => Promise.resolve(body),
  };
}

/** Record whether (and how) a promise has settled, without awaiting it. */
function track<T>(p: Promise<T>) {
  const state: { settled: boolean; value?: T; error?: unknown } = {
    settled: false,
  };
  p.then(
    (value) => Object.assign(state, { settled: true, value }),
    (error: unknown) => Object.assign(state, { settled: true, error }),
  );
  return state;
}

/** fetch that aborts the caller's controller, then rejects like undici does. */
function abortingFetch(controller: AbortController): void {
  mockFetch.mockImplementation(() => {
    controller.abort();
    return Promise.reject(new DOMException('aborted', 'AbortError'));
  });
}

let util: HttpUtil;

beforeEach(() => {
  mockFetch.mockReset();
  jest.useFakeTimers({ now: T0 });
  util = loadFreshUtil();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('itadFetch — aborted mid-call', () => {
  it('stops after an aborted fetch: one call, no backoff sleep, resolves null', async () => {
    const controller = new AbortController();
    abortingFetch(controller);

    const pending = track(
      util.itadFetch(
        '/games/info/v2',
        { key: 'k' },
        {
          signal: controller.signal,
        },
      ),
    );
    await jest.advanceTimersByTimeAsync(0);

    expect(pending).toEqual({ settled: true, value: null });
    await jest.advanceTimersByTimeAsync(retryWindowMs);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('rejects ItadRetriesExhaustedError for an aborted call with throwOnExhausted', async () => {
    const controller = new AbortController();
    abortingFetch(controller);

    const pending = track(
      util.itadFetch(
        '/games/info/v2',
        { key: 'k' },
        {
          signal: controller.signal,
          throwOnExhausted: true,
        },
      ),
    );
    await jest.advanceTimersByTimeAsync(0);

    expect(pending.settled).toBe(true);
    expect(pending.error).toBeInstanceOf(util.ItadRetriesExhaustedError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('itadFetch — signal plumbing', () => {
  it('never calls fetch when the signal is already aborted', async () => {
    mockFetch.mockResolvedValue(res(200, { found: true }));
    const controller = new AbortController();
    controller.abort();

    const result = await util.itadFetch(
      '/games/info/v2',
      { key: 'k' },
      {
        signal: controller.signal,
      },
    );

    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("passes the caller's signal to fetch", async () => {
    mockFetch.mockResolvedValue(res(200, { found: true }));
    const controller = new AbortController();

    await util.itadFetch(
      '/games/info/v2',
      { key: 'k' },
      {
        signal: controller.signal,
      },
    );

    const init = at(at(mockFetch.mock.calls, 0) as unknown[], 1) as RequestInit;
    expect(init.signal).toBe(controller.signal);
  });

  it('leaves the request init without a signal key when none is given', async () => {
    mockFetch.mockResolvedValue(res(200, { found: true }));

    await util.itadFetch('/games/info/v2', { key: 'k' });

    const init = at(at(mockFetch.mock.calls, 0) as unknown[], 1);
    expect(init).not.toHaveProperty('signal');
  });
});
