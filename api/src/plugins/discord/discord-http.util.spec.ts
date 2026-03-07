const mockFetch = jest.fn();
global.fetch = mockFetch;

import { discordFetch } from './discord-http.util';

function make429Headers(entries: [string, string][]) {
  const map = new Map(entries);
  return { get: (h: string) => map.get(h.toLowerCase()) ?? null };
}

const noRetryHeaders = { get: () => null };

async function testRetryWithHeader() {
  const headers429 = make429Headers([['retry-after', '2']]);
  mockFetch
    .mockResolvedValueOnce({ status: 429, ok: false, headers: headers429 })
    .mockResolvedValueOnce({ status: 200, ok: true });

  const promise = discordFetch('https://discord.com/api/test');
  await jest.advanceTimersByTimeAsync(2_000);
  const result = await promise;

  expect(result.status).toBe(200);
  expect(mockFetch).toHaveBeenCalledTimes(2);
}

async function testRetryWithRateLimitHeader() {
  const headers429 = make429Headers([['x-ratelimit-reset-after', '1.5']]);
  mockFetch
    .mockResolvedValueOnce({ status: 429, ok: false, headers: headers429 })
    .mockResolvedValueOnce({ status: 200, ok: true });

  const promise = discordFetch('https://discord.com/api/test');
  await jest.advanceTimersByTimeAsync(1_500);
  const result = await promise;

  expect(result.status).toBe(200);
  expect(mockFetch).toHaveBeenCalledTimes(2);
}

async function testExponentialBackoff() {
  mockFetch
    .mockResolvedValueOnce({ status: 429, ok: false, headers: noRetryHeaders })
    .mockResolvedValueOnce({ status: 429, ok: false, headers: noRetryHeaders })
    .mockResolvedValueOnce({ status: 200, ok: true });

  const promise = discordFetch('https://discord.com/api/test');

  // First retry: 1s backoff (1000 * 2^0)
  await jest.advanceTimersByTimeAsync(1_000);
  // Second retry: 2s backoff (1000 * 2^1)
  await jest.advanceTimersByTimeAsync(2_000);

  const result = await promise;
  expect(result.status).toBe(200);
  expect(mockFetch).toHaveBeenCalledTimes(3);
}

async function testExhaustedRetries() {
  mockFetch.mockResolvedValue({
    status: 429,
    ok: false,
    headers: noRetryHeaders,
  });

  const promise = discordFetch('https://discord.com/api/test');
  // Advance through all backoff periods: 1s + 2s + 4s
  await jest.advanceTimersByTimeAsync(1_000);
  await jest.advanceTimersByTimeAsync(2_000);
  await jest.advanceTimersByTimeAsync(4_000);

  const result = await promise;
  expect(result.status).toBe(429);
  // initial + 3 retries = 4 calls
  expect(mockFetch).toHaveBeenCalledTimes(4);
}

async function testCustomMaxRetries() {
  mockFetch.mockResolvedValue({
    status: 429,
    ok: false,
    headers: noRetryHeaders,
  });

  const promise = discordFetch('https://discord.com/api/test', undefined, {
    maxRetries: 1,
  });
  await jest.advanceTimersByTimeAsync(1_000);

  const result = await promise;
  expect(result.status).toBe(429);
  // initial + 1 retry = 2 calls
  expect(mockFetch).toHaveBeenCalledTimes(2);
}

describe('discordFetch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('success and non-retryable responses', () => {
    it('should return response directly on success', async () => {
      const mockResponse = { status: 200, ok: true };
      mockFetch.mockResolvedValueOnce(mockResponse);

      const result = await discordFetch('https://discord.com/api/test');

      expect(result).toBe(mockResponse);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should return non-429 error responses without retry', async () => {
      const mockResponse = { status: 500, ok: false };
      mockFetch.mockResolvedValueOnce(mockResponse);

      const result = await discordFetch('https://discord.com/api/test');

      expect(result).toBe(mockResponse);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should pass through request init options', async () => {
      mockFetch.mockResolvedValueOnce({ status: 200, ok: true });

      const init: RequestInit = {
        method: 'POST',
        headers: { Authorization: 'Bearer token' },
      };

      await discordFetch('https://discord.com/api/test', init);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://discord.com/api/test',
        init,
      );
    });
  });

  describe('rate limit retry behaviour', () => {
    it('should retry on 429 with Retry-After header', () =>
      testRetryWithHeader());

    it('should use x-ratelimit-reset-after header when retry-after is absent', () =>
      testRetryWithRateLimitHeader());

    it('should use exponential backoff when no retry headers present', () =>
      testExponentialBackoff());

    it('should return 429 after exhausting all retries', () =>
      testExhaustedRetries());

    it('should respect custom maxRetries option', () => testCustomMaxRetries());
  });
});
