/**
 * Tests for ITAD HTTP utilities (ROK-773, ROK-1103).
 * Covers itadPost (batch POST) and itadFetch (GET) retry behaviour:
 * 429 + 5xx (incl. Cloudflare 521/522/524) + network errors are retried
 * with exponential backoff; final failure preserves the `T | null` contract.
 */
import { ITAD_MAX_RETRIES } from './itad.constants';

// Mock global fetch before importing
const mockFetch = jest.fn();
global.fetch = mockFetch;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { itadPost, itadFetch } = require('./itad-http.util') as {
  itadPost: <T>(
    path: string,
    params: Record<string, string>,
    body: unknown,
  ) => Promise<T | null>;
  itadFetch: <T>(
    path: string,
    params: Record<string, string>,
  ) => Promise<T | null>;
};

/** Build a fake fetch Response for a given status. */
function res(status: number, body?: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
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
