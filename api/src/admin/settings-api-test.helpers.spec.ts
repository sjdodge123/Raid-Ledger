/**
 * Tests for the admin "Test Connection" ITAD helper (ROK-2117).
 * A `?key=` URL lands verbatim in Sentry's fetch breadcrumbs, so the ITAD
 * key travels only in the `ITAD-API-Key` header ITAD documents.
 */
import { testItadApiKey } from './settings-api-test.helpers';

type FetchCall = [string, RequestInit & { headers: Record<string, string> }];

const originalFetch = global.fetch;

/** Install a fetch mock resolving to a Response-like with the given status. */
function mockFetchStatus(status: number): jest.Mock {
  const mock = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
  });
  global.fetch = mock;
  return mock;
}

/** The single fetch call the helper made. */
function onlyCall(mock: jest.Mock): FetchCall {
  expect(mock).toHaveBeenCalledTimes(1);
  const call = mock.mock.calls[0] as FetchCall | undefined;
  if (!call) throw new Error('fetch was not called');
  return call;
}

describe('testItadApiKey', () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('sends the key as ITAD-API-Key and keeps it out of the URL', async () => {
    const mock = mockFetchStatus(200);

    await testItadApiKey('secret-key');

    const [url, init] = onlyCall(mock);
    expect(init.headers['ITAD-API-Key']).toBe('secret-key');
    expect(url).not.toContain('key=');
    expect(url).not.toContain('secret-key');
    expect(url).toBe('https://api.isthereanydeal.com/games/lookup/v1?appid=440');
  });

  it('reports a valid key on 200', async () => {
    mockFetchStatus(200);

    await expect(testItadApiKey('k')).resolves.toEqual({
      success: true,
      message: 'ITAD API key is valid!',
    });
  });

  it.each([401, 403])('reports an invalid key on %i', async (status) => {
    mockFetchStatus(status);

    await expect(testItadApiKey('k')).resolves.toEqual({
      success: false,
      message: 'Invalid ITAD API key',
    });
  });

  it('reports other HTTP failures with their status', async () => {
    mockFetchStatus(500);

    await expect(testItadApiKey('k')).resolves.toEqual({
      success: false,
      message: 'ITAD API returned HTTP 500',
    });
  });

  it('reports a network failure without throwing', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNRESET'));

    await expect(testItadApiKey('k')).resolves.toEqual({
      success: false,
      message: 'Failed to connect to ITAD API. Please check your network.',
    });
  });
});
