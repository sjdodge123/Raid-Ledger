/**
 * Tests for IGDB token management helpers (ROK-773).
 * Covers token caching, expiry, concurrent requests, and clear behavior.
 */
import {
  createTokenState,
  clearToken,
  getAccessToken,
  type TokenState,
} from './igdb-token.helpers';

// Mock the API helpers to avoid real Twitch calls
jest.mock('./igdb-api.helpers', () => ({
  fetchTwitchToken: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { fetchTwitchToken } = require('./igdb-api.helpers') as {
  fetchTwitchToken: jest.Mock;
};

describe('createTokenState', () => {
  it('returns a fresh state with all null values', () => {
    const state = createTokenState();

    expect(state.accessToken).toBeNull();
    expect(state.tokenExpiry).toBeNull();
    expect(state.tokenFetchPromise).toBeNull();
  });
});

describe('clearToken', () => {
  it('resets all token state fields to null', () => {
    const state: TokenState = {
      accessToken: 'some-token',
      tokenExpiry: new Date(),
      tokenFetchPromise: Promise.resolve('x'),
    };

    clearToken(state);

    expect(state.accessToken).toBeNull();
    expect(state.tokenExpiry).toBeNull();
    expect(state.tokenFetchPromise).toBeNull();
  });
});

describe('getAccessToken', () => {
  const mockCredentials = jest
    .fn()
    .mockResolvedValue({ clientId: 'cid', clientSecret: 'csecret' });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns cached token when not expired', async () => {
    const futureDate = new Date(Date.now() + 60_000);
    const state: TokenState = {
      accessToken: 'cached-token',
      tokenExpiry: futureDate,
      tokenFetchPromise: null,
    };

    const token = await getAccessToken(state, mockCredentials);

    expect(token).toBe('cached-token');
    expect(fetchTwitchToken).not.toHaveBeenCalled();
  });

  it('fetches new token when cached token is expired', async () => {
    const pastDate = new Date(Date.now() - 60_000);
    const state: TokenState = {
      accessToken: 'expired-token',
      tokenExpiry: pastDate,
      tokenFetchPromise: null,
    };

    fetchTwitchToken.mockResolvedValue({
      token: 'new-token',
      expiry: new Date(Date.now() + 300_000),
    });

    const token = await getAccessToken(state, mockCredentials);

    expect(token).toBe('new-token');
    expect(state.accessToken).toBe('new-token');
    expect(fetchTwitchToken).toHaveBeenCalledWith('cid', 'csecret');
  });

  it('fetches new token when no token exists', async () => {
    const state = createTokenState();

    fetchTwitchToken.mockResolvedValue({
      token: 'fresh-token',
      expiry: new Date(Date.now() + 300_000),
    });

    const token = await getAccessToken(state, mockCredentials);

    expect(token).toBe('fresh-token');
  });

  it('deduplicates concurrent token fetches', async () => {
    const state = createTokenState();

    fetchTwitchToken.mockResolvedValue({
      token: 'dedup-token',
      expiry: new Date(Date.now() + 300_000),
    });

    // Fire two concurrent requests
    const [t1, t2] = await Promise.all([
      getAccessToken(state, mockCredentials),
      getAccessToken(state, mockCredentials),
    ]);

    expect(t1).toBe('dedup-token');
    expect(t2).toBe('dedup-token');
    expect(fetchTwitchToken).toHaveBeenCalledTimes(1);
  });

  it('clears tokenFetchPromise after fetch completes', async () => {
    const state = createTokenState();

    fetchTwitchToken.mockResolvedValue({
      token: 'done-token',
      expiry: new Date(Date.now() + 300_000),
    });

    await getAccessToken(state, mockCredentials);

    expect(state.tokenFetchPromise).toBeNull();
  });

  it('clears tokenFetchPromise even when fetch fails', async () => {
    const state = createTokenState();

    fetchTwitchToken.mockRejectedValue(new Error('Twitch down'));

    await expect(getAccessToken(state, mockCredentials)).rejects.toThrow(
      'Twitch down',
    );

    expect(state.tokenFetchPromise).toBeNull();
  });
});
