/**
 * Tests for ITAD HTTP utilities (ROK-773, ROK-1103).
 * Covers itadPost (batch POST) and itadFetch (GET) retry behaviour:
 * 429 + 5xx (incl. Cloudflare 521/522/524) + network errors are retried
 * with exponential backoff; final failure preserves the `T | null` contract.
 * Also covers the shared request pacer and 429 `Retry-After` handling.
 */
import {
  ITAD_BACKOFF_INITIAL_MS,
  ITAD_INTERACTIVE_FETCH,
  ITAD_MAX_RETRIES,
  ITAD_RATE_LIMIT_MS,
  ITAD_RETRY_AFTER_MAX_MS,
} from './itad.constants';

// Mock global fetch before importing
const mockFetch = jest.fn();
global.fetch = mockFetch;

interface HttpUtil {
  itadPost: <T>(
    path: string,
    params: Record<string, string>,
    body: unknown,
    opts?: { maxPauseWaitMs?: number },
  ) => Promise<T | null>;
  itadFetch: <T>(
    path: string,
    params: Record<string, string>,
    opts?: { throwOnExhausted?: boolean; maxPauseWaitMs?: number },
  ) => Promise<T | null>;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { itadPost, itadFetch } = require('./itad-http.util') as HttpUtil;

/** Build a fake fetch Response for a given status (+ optional headers). */
function res(
  status: number,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: () => Promise.resolve(body),
  };
}

/**
 * Run a retry-driving call with all `setTimeout` delays collapsed to zero so
 * the exponential backoff + rate-limit gaps resolve instantly. The util's
 * timers are fire-and-await via `await new Promise(setTimeout)`, so invoking
 * the callback on a 0ms real timer preserves ordering without the fake-timer
 * drain race (rate-limiter `Date.now()` math can skip scheduling a timer).
 */
async function runFast<T>(fn: () => Promise<T>): Promise<T> {
  const realSetTimeout = globalThis.setTimeout;
  const spy = jest
    .spyOn(globalThis, 'setTimeout')
    .mockImplementation((cb: (...args: unknown[]) => void) => {
      return realSetTimeout(cb, 0);
    });
  try {
    return await fn();
  } finally {
    spy.mockRestore();
  }
}

describe('itadPost', () => {
  beforeEach(() => {
    // mockReset (not clearAllMocks) so a prior test's persistent
    // mockResolvedValue default doesn't leak into the next test.
    mockFetch.mockReset();
  });

  it('sends a POST request with JSON body and query params', async () => {
    mockFetch.mockResolvedValueOnce(res(200, { result: 'ok' }));

    const result = await itadPost<{ result: string }>(
      '/lookup/shop/61/id/v1',
      { key: 'test-key' },
      ['game/012345'],
    );

    expect(result).toEqual({ result: 'ok' });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain('/lookup/shop/61/id/v1');
    expect(url).toContain('key=test-key');
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    expect(JSON.parse(options.body)).toEqual(['game/012345']);
  });

  it('returns null on a non-retriable non-OK response (404)', async () => {
    mockFetch.mockResolvedValueOnce(res(404));

    const result = await itadPost('/test', { key: 'k' }, {});

    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('itadPost retries', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('retries on 429 with backoff', async () => {
    mockFetch
      .mockResolvedValueOnce(res(429))
      .mockResolvedValueOnce(res(200, { retried: true }));

    const result = await runFast(() =>
      itadPost<{ retried: boolean }>('/test', { key: 'k' }, {}),
    );

    expect(result).toEqual({ retried: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('retries a Cloudflare 521 then succeeds on 200', async () => {
    mockFetch
      .mockResolvedValueOnce(res(521))
      .mockResolvedValueOnce(res(200, { ok: true }));

    const result = await runFast(() =>
      itadPost<{ ok: boolean }>('/test', { key: 'k' }, {}),
    );

    expect(result).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('retries 503 then 500 then succeeds on the third attempt', async () => {
    mockFetch
      .mockResolvedValueOnce(res(503))
      .mockResolvedValueOnce(res(500))
      .mockResolvedValueOnce(res(200, { ok: true }));

    const result = await runFast(() =>
      itadPost<{ ok: boolean }>('/test', { key: 'k' }, {}),
    );

    expect(result).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('retries on a network error then succeeds', async () => {
    mockFetch
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(res(200, { ok: true }));

    const result = await runFast(() =>
      itadPost<{ ok: boolean }>('/test', { key: 'k' }, {}),
    );

    expect(result).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('returns null after exhausting retries on persistent 521', async () => {
    mockFetch.mockResolvedValue(res(521));

    const result = await runFast(() => itadPost('/test', { key: 'k' }, {}));

    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(ITAD_MAX_RETRIES + 1);
  });

  it('returns null after exhausting retries on persistent network errors', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNRESET'));

    const result = await runFast(() => itadPost('/test', { key: 'k' }, {}));

    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(ITAD_MAX_RETRIES + 1);
  });

  it('rejects instead of resolving null after exhausting retries when throwOnExhausted is set', async () => {
    mockFetch.mockResolvedValue(res(524));

    const pending = runFast(() =>
      itadFetch('/games/info/v2', { key: 'k' }, { throwOnExhausted: true }),
    );

    await expect(pending).rejects.toThrow(
      'ITAD retries exhausted: /games/info/v2',
    );
    expect(mockFetch).toHaveBeenCalledTimes(ITAD_MAX_RETRIES + 1);
  });

  it('still resolves null on a non-retriable 404 when throwOnExhausted is set', async () => {
    mockFetch.mockResolvedValue(res(404));

    const result = await itadFetch(
      '/games/info/v2',
      { key: 'k' },
      { throwOnExhausted: true },
    );

    expect(result).toBeNull();
  });
});

describe('itadFetch', () => {
  beforeEach(() => {
    // mockReset (not clearAllMocks) so a prior test's persistent
    // mockResolvedValue default doesn't leak into the next test.
    mockFetch.mockReset();
  });

  it('returns parsed JSON on a 200 response', async () => {
    mockFetch.mockResolvedValueOnce(res(200, { found: true }));

    const result = await itadFetch<{ found: boolean }>('/lookup/id/v1', {
      key: 'k',
    });

    expect(result).toEqual({ found: true });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns null on a non-retriable non-OK response (404)', async () => {
    mockFetch.mockResolvedValueOnce(res(404));

    const result = await itadFetch('/lookup/id/v1', { key: 'k' });

    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries a Cloudflare 522 then succeeds on 200', async () => {
    mockFetch
      .mockResolvedValueOnce(res(522))
      .mockResolvedValueOnce(res(200, { found: true }));

    const result = await runFast(() =>
      itadFetch<{ found: boolean }>('/lookup/id/v1', { key: 'k' }),
    );

    expect(result).toEqual({ found: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('retries on a network error then succeeds', async () => {
    mockFetch
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(res(200, { found: true }));

    const result = await runFast(() =>
      itadFetch<{ found: boolean }>('/lookup/id/v1', { key: 'k' }),
    );

    expect(result).toEqual({ found: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('returns null after exhausting retries on persistent 524', async () => {
    mockFetch.mockResolvedValue(res(524));

    const result = await runFast(() =>
      itadFetch('/lookup/id/v1', { key: 'k' }),
    );

    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(ITAD_MAX_RETRIES + 1);
  });
});

/**
 * Timing tests. Each test gets a FRESH copy of the util (pacer state is
 * module-global) and fake timers pinned to T0, so every fetch start time can
 * be asserted as an exact offset from T0.
 */
const T0 = Date.parse('2026-09-29T12:00:00Z');

function loadFreshUtil(): HttpUtil {
  let util = {} as HttpUtil;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    util = require('./itad-http.util') as HttpUtil;
  });
  return util;
}

/**
 * Serve `responses` in order (then 200s) and record each fetch's start time
 * as an offset from T0.
 */
function scriptFetch(...responses: ReturnType<typeof res>[]): number[] {
  const offsets: number[] = [];
  mockFetch.mockImplementation(() => {
    offsets.push(Date.now() - T0);
    return Promise.resolve(responses.shift() ?? res(200, { ok: true }));
  });
  return offsets;
}

describe('ITAD request pacing', () => {
  let util: HttpUtil;

  beforeEach(() => {
    mockFetch.mockReset();
    jest.useFakeTimers({ now: T0 });
    util = loadFreshUtil();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('spaces 5 concurrent callers by ITAD_RATE_LIMIT_MS', async () => {
    const offsets = scriptFetch();

    const calls = [0, 1, 2, 3, 4].map((i) =>
      util.itadFetch('/games/info/v2', { key: 'k', id: `g${i}` }),
    );
    await jest.advanceTimersByTimeAsync(ITAD_RATE_LIMIT_MS * 5);
    await Promise.all(calls);

    expect(offsets).toEqual([0, 1, 2, 3, 4].map((i) => i * ITAD_RATE_LIMIT_MS));
  });

  it('a 429 holds every queued caller until Retry-After elapses', async () => {
    const offsets = scriptFetch(res(429, undefined, { 'Retry-After': '2' }));

    const first = util.itadFetch('/a', { key: 'k' });
    const second = util.itadFetch('/b', { key: 'k' });
    await jest.advanceTimersByTimeAsync(2_000 + ITAD_RATE_LIMIT_MS);
    await Promise.all([first, second]);

    const paths = mockFetch.mock.calls.map(
      ([url]) => new URL(url as string).pathname,
    );
    expect(paths).toEqual(['/a', '/b', '/a']);
    expect(offsets).toEqual([0, 2_000, 2_000 + ITAD_RATE_LIMIT_MS]);
  });
});

describe('ITAD 429 Retry-After', () => {
  let util: HttpUtil;

  beforeEach(() => {
    mockFetch.mockReset();
    jest.useFakeTimers({ now: T0 });
    util = loadFreshUtil();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /** One 429 with `headers`, then a 200; returns the fetch start offsets. */
  async function retryOffsets(
    headers: Record<string, string>,
    call: () => Promise<unknown> = () => util.itadFetch('/x', { key: 'k' }),
  ): Promise<number[]> {
    const offsets = scriptFetch(res(429, undefined, headers));
    const pending = call();
    await jest.advanceTimersByTimeAsync(ITAD_RETRY_AFTER_MAX_MS + 1_000);
    await expect(pending).resolves.toEqual({ ok: true });
    return offsets;
  }

  it('waits the delta-seconds value before retrying', async () => {
    expect(await retryOffsets({ 'Retry-After': '5' })).toEqual([0, 5_000]);
  });

  it('waits until an HTTP-date value before retrying', async () => {
    const at = new Date(T0 + 10_000).toUTCString();
    expect(await retryOffsets({ 'Retry-After': at })).toEqual([0, 10_000]);
  });

  it('caps a long Retry-After at ITAD_RETRY_AFTER_MAX_MS', async () => {
    expect(await retryOffsets({ 'Retry-After': '3600' })).toEqual([
      0,
      ITAD_RETRY_AFTER_MAX_MS,
    ]);
  });

  it('honours Retry-After on itadPost too', async () => {
    const post = () => util.itadPost('/lookup/shop/61/id/v1', { key: 'k' }, []);
    expect(await retryOffsets({ 'Retry-After': '3' }, post)).toEqual([
      0, 3_000,
    ]);
  });

  it.each([
    ['missing', {}],
    ['unparseable', { 'Retry-After': 'soon' }],
    ['a past HTTP-date', { 'Retry-After': new Date(T0 - 5_000).toUTCString() }],
  ])(
    'falls back to exponential backoff when the header is %s',
    async (_label, headers: Record<string, string>) => {
      expect(await retryOffsets(headers)).toEqual([0, ITAD_BACKOFF_INITIAL_MS]);
    },
  );
});

/** Observe a promise's outcome without awaiting it. */
function track<T>(p: Promise<T>): { settled: boolean; value?: T } {
  const state: { settled: boolean; value?: T } = { settled: false };
  void p.then((value) => {
    state.settled = true;
    state.value = value;
  });
  return state;
}

describe('ITAD interactive fail-fast (maxPauseWaitMs)', () => {
  let util: HttpUtil;

  beforeEach(() => {
    mockFetch.mockReset();
    jest.useFakeTimers({ now: T0 });
    util = loadFreshUtil();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const fetchedPaths = (): string[] =>
    mockFetch.mock.calls.map(([url]) => new URL(url as string).pathname);

  it("resolves null at once while another caller's long 429 pause is active", async () => {
    scriptFetch(res(429, undefined, { 'Retry-After': '30' }));
    const background = util.itadFetch('/bg', { key: 'k' });
    await jest.advanceTimersByTimeAsync(1);

    const search = track(
      util.itadFetch('/search', { key: 'k' }, ITAD_INTERACTIVE_FETCH),
    );
    await jest.advanceTimersByTimeAsync(ITAD_RATE_LIMIT_MS);

    expect(search).toEqual({ settled: true, value: null });
    expect(fetchedPaths()).toEqual(['/bg']);
    await jest.advanceTimersByTimeAsync(30_000);
    await background;
  });

  it('resolves null when a long pause starts while it is still queued', async () => {
    // '/slow' answers 429 at t=100ms, while '/bg' waits at the head of the
    // queue and the interactive call is queued behind it.
    mockFetch.mockImplementation((url: string) => {
      if (new URL(url).pathname !== '/slow') {
        return Promise.resolve(res(200, { ok: true }));
      }
      const limited = res(429, undefined, { 'Retry-After': '30' });
      return new Promise((r) => setTimeout(() => r(limited), 100));
    });
    const slow = util.itadFetch('/slow', { key: 'k' });
    const background = util.itadFetch('/bg', { key: 'k' });
    const search = track(
      util.itadFetch('/search', { key: 'k' }, ITAD_INTERACTIVE_FETCH),
    );
    await jest.advanceTimersByTimeAsync(ITAD_RATE_LIMIT_MS);

    expect(search).toEqual({ settled: true, value: null });
    expect(fetchedPaths()).toEqual(['/slow']);
    await jest.advanceTimersByTimeAsync(ITAD_RETRY_AFTER_MAX_MS * 5);
    await Promise.all([slow, background]);
  });

  it.each([
    [
      'itadFetch',
      () => util.itadFetch('/x', { key: 'k' }, ITAD_INTERACTIVE_FETCH),
    ],
    [
      'itadPost',
      () => util.itadPost('/x', { key: 'k' }, [], ITAD_INTERACTIVE_FETCH),
    ],
  ])(
    '%s resolves null after its own 429 when Retry-After exceeds the limit',
    async (_label, call: () => Promise<unknown>) => {
      scriptFetch(res(429, undefined, { 'Retry-After': '30' }));
      const pending = track(call());
      await jest.advanceTimersByTimeAsync(ITAD_RATE_LIMIT_MS);

      expect(pending).toEqual({ settled: true, value: null });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    },
  );

  it('still waits out a Retry-After shorter than the limit', async () => {
    const offsets = scriptFetch(res(429, undefined, { 'Retry-After': '2' }));
    const pending = util.itadFetch('/x', { key: 'k' }, ITAD_INTERACTIVE_FETCH);
    await jest.advanceTimersByTimeAsync(2_000);

    await expect(pending).resolves.toEqual({ ok: true });
    expect(offsets).toEqual([0, 2_000]);
  });
});

describe('ITAD final attempt', () => {
  /** Backoff slept between attempts: 500 + 1000 + 2000 with 3 retries. */
  const retryWindowMs = ITAD_BACKOFF_INITIAL_MS * (2 ** ITAD_MAX_RETRIES - 1);
  const attemptOffsets = [0, 1, 2, 3].map(
    (n) => ITAD_BACKOFF_INITIAL_MS * (2 ** n - 1),
  );

  beforeEach(() => {
    mockFetch.mockReset();
    jest.useFakeTimers({ now: T0 });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves null right after the last 5xx, with no backoff sleep after it', async () => {
    const util = loadFreshUtil();
    const offsets = scriptFetch(res(503), res(503), res(503), res(503));
    const pending = track(util.itadFetch('/x', { key: 'k' }));
    await jest.advanceTimersByTimeAsync(retryWindowMs);

    expect(offsets).toEqual(attemptOffsets);
    expect(pending).toEqual({ settled: true, value: null });
  });

  it('resolves null right after the last network error, with no sleep after it', async () => {
    const util = loadFreshUtil();
    const offsets: number[] = [];
    mockFetch.mockImplementation(() => {
      offsets.push(Date.now() - T0);
      return Promise.reject(new Error('ECONNRESET'));
    });
    const pending = track(util.itadFetch('/x', { key: 'k' }));
    await jest.advanceTimersByTimeAsync(retryWindowMs);

    expect(offsets).toEqual(attemptOffsets);
    expect(pending).toEqual({ settled: true, value: null });
  });
});
