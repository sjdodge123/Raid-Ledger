/**
 * Tests for ITAD HTTP utilities (ROK-773).
 * Covers itadPost for batch POST requests.
 */

// Mock global fetch before importing
const mockFetch = jest.fn();
global.fetch = mockFetch;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { itadPost } = require('./itad-http.util') as {
  itadPost: <T>(
    path: string,
    params: Record<string, string>,
    body: unknown,
  ) => Promise<T | null>;
};

describe('itadPost', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sends a POST request with JSON body and query params', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ result: 'ok' }),
    });

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
    expect(JSON.parse(options.body)).toEqual(['game/012345']);
  });

  it('returns null on non-OK response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    const result = await itadPost('/test', { key: 'k' }, {});

    expect(result).toBeNull();
  });

  it('retries on 429 with backoff', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ retried: true }),
      });

    const result = await itadPost<{ retried: boolean }>(
      '/test',
      { key: 'k' },
      {},
    );

    expect(result).toEqual({ retried: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('returns null on fetch error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network error'));

    const result = await itadPost('/test', { key: 'k' }, {});

    expect(result).toBeNull();
  });
});
