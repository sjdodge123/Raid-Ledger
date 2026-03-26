/**
 * Tests for lineups-api toggleVote function (ROK-936).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetchApi before importing the module under test
vi.mock('./fetch-api', () => ({
  fetchApi: vi.fn(),
}));

import { toggleVote } from './lineups-api';
import { fetchApi } from './fetch-api';

const mockFetchApi = vi.mocked(fetchApi);

describe('toggleVote', () => {
  beforeEach(() => {
    mockFetchApi.mockReset();
  });

  it('calls POST /lineups/:id/vote with gameId', async () => {
    const mockResponse = { id: 1, status: 'voting', entries: [], myVotes: [42] };
    mockFetchApi.mockResolvedValueOnce(mockResponse);

    await toggleVote(1, 42);

    expect(mockFetchApi).toHaveBeenCalledWith('/lineups/1/vote', {
      method: 'POST',
      body: JSON.stringify({ gameId: 42 }),
    });
  });

  it('returns the lineup detail response', async () => {
    const mockResponse = { id: 5, status: 'voting', entries: [], myVotes: [10] };
    mockFetchApi.mockResolvedValueOnce(mockResponse);

    const result = await toggleVote(5, 10);

    expect(result).toEqual(mockResponse);
  });

  it('propagates errors from fetchApi', async () => {
    mockFetchApi.mockRejectedValueOnce(new Error('Vote limit reached'));

    await expect(toggleVote(1, 99)).rejects.toThrow('Vote limit reached');
  });
});
