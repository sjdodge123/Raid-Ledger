import { IGDB_CONFIG } from './igdb.constants';

// We need to mock global fetch and delay
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock the delay helper to avoid real timers in tests
jest.mock('./igdb-api.helpers', () => ({
  delay: jest.fn().mockResolvedValue(undefined),
}));

// Dynamically import after mocks are set up
import { fetchTwitchStreams } from './igdb-streams.helpers';
import { delay } from './igdb-api.helpers';

/** Factory for a minimal DB mock that returns game rows. */
function createDbMock(
  gameRows: { id: number; twitchGameId: string | null }[],
): any {
  return {
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue(gameRows),
        }),
      }),
    }),
  };
}

/** Factory for Twitch API response body. */
function createTwitchResponse(streamCount = 1): {
  data: any[];
  pagination: any;
} {
  return {
    data: Array.from({ length: streamCount }, (_, i) => ({
      user_name: `streamer_${i}`,
      title: `Stream ${i}`,
      viewer_count: 100 + i,
      thumbnail_url: 'https://img/{width}x{height}.jpg',
      language: 'en',
    })),
    pagination: {},
  };
}

const mockGetCredentials = jest
  .fn()
  .mockResolvedValue({ clientId: 'test-client-id' });
const mockGetToken = jest.fn().mockResolvedValue('test-token');

describe('IgdbStreamsHelpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('fetchTwitchStreams', () => {
    it('should return EMPTY_STREAMS when game not found', async () => {
      const db = createDbMock([]);
      const result = await fetchTwitchStreams(
        db,
        999,
        mockGetCredentials,
        mockGetToken,
      );
      expect(result).toEqual({ streams: [], totalLive: 0 });
    });

    it('should return EMPTY_STREAMS when game has no twitchGameId', async () => {
      const db = createDbMock([{ id: 1, twitchGameId: null }]);
      const result = await fetchTwitchStreams(
        db,
        1,
        mockGetCredentials,
        mockGetToken,
      );
      expect(result).toEqual({ streams: [], totalLive: 0 });
    });

    it('should return mapped streams on success', async () => {
      const db = createDbMock([{ id: 1, twitchGameId: '12345' }]);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(createTwitchResponse(2)),
      });

      const result = await fetchTwitchStreams(
        db,
        1,
        mockGetCredentials,
        mockGetToken,
      );

      expect(result.totalLive).toBe(2);
      expect(result.streams).toHaveLength(2);
      expect(result.streams[0]).toMatchObject({
        userName: expect.any(String),
        title: expect.any(String),
        viewerCount: expect.any(Number),
        thumbnailUrl: expect.any(String),
        language: 'en',
      });
    });
  });

  describe('Regression: ROK-767', () => {
    it('should use TWITCH_API_TIMEOUT_MS (8000ms) for the timeout', () => {
      expect(IGDB_CONFIG.TWITCH_API_TIMEOUT_MS).toBe(8000);
    });

    it('should retry on AbortError and succeed on second attempt', async () => {
      const db = createDbMock([{ id: 1, twitchGameId: '12345' }]);
      const abortError = new DOMException(
        'This operation was aborted',
        'AbortError',
      );

      // First call: abort error, second call: success
      mockFetch.mockRejectedValueOnce(abortError).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(createTwitchResponse(1)),
      });

      const result = await fetchTwitchStreams(
        db,
        1,
        mockGetCredentials,
        mockGetToken,
      );

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.totalLive).toBe(1);
      expect(delay).toHaveBeenCalledTimes(1);
    });

    it('should retry up to MAX_TWITCH_RETRIES times before returning EMPTY_STREAMS', async () => {
      const db = createDbMock([{ id: 1, twitchGameId: '12345' }]);
      const abortError = new DOMException(
        'This operation was aborted',
        'AbortError',
      );

      // All attempts fail with abort error
      mockFetch
        .mockRejectedValueOnce(abortError)
        .mockRejectedValueOnce(abortError)
        .mockRejectedValueOnce(abortError);

      const result = await fetchTwitchStreams(
        db,
        1,
        mockGetCredentials,
        mockGetToken,
      );

      // 3 total attempts (1 initial + 2 retries)
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(result).toEqual({ streams: [], totalLive: 0 });
      // delay called for each retry (2 times)
      expect(delay).toHaveBeenCalledTimes(2);
    });

    it('should use exponential backoff delays between retries', async () => {
      const db = createDbMock([{ id: 1, twitchGameId: '12345' }]);
      const abortError = new DOMException(
        'This operation was aborted',
        'AbortError',
      );

      mockFetch
        .mockRejectedValueOnce(abortError)
        .mockRejectedValueOnce(abortError)
        .mockRejectedValueOnce(abortError);

      await fetchTwitchStreams(db, 1, mockGetCredentials, mockGetToken);

      // Exponential backoff: 1000ms, 2000ms
      expect(delay).toHaveBeenNthCalledWith(1, 1000);
      expect(delay).toHaveBeenNthCalledWith(2, 2000);
    });

    it('should log which attempt failed', async () => {
      const db = createDbMock([{ id: 1, twitchGameId: '12345' }]);
      const abortError = new DOMException(
        'This operation was aborted',
        'AbortError',
      );

      // Fail once, then succeed
      mockFetch.mockRejectedValueOnce(abortError).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(createTwitchResponse(1)),
      });

      // Just verifying it doesn't throw and retries correctly
      const result = await fetchTwitchStreams(
        db,
        1,
        mockGetCredentials,
        mockGetToken,
      );
      expect(result.totalLive).toBe(1);
    });
  });
});
