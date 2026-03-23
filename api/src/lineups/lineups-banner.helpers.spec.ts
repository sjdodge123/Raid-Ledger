/**
 * Unit tests for lineup banner helpers (ROK-935).
 * Tests findBannerLineup query and buildBannerResponse mapping.
 */
import { buildBannerResponse } from './lineups-banner.helpers';
import type { LineupBannerResponseDto } from '@raid-ledger/contract';

const NOW = new Date('2026-03-22T20:00:00Z');

const mockLineup = {
  id: 1,
  status: 'building' as const,
  targetDate: NOW,
  decidedGameId: null as number | null,
  decidedGameName: null as string | null,
  createdBy: 10,
  votingDeadline: null as Date | null,
  createdAt: NOW,
  updatedAt: NOW,
  linkedEventId: null as number | null,
};

describe('buildBannerResponse', () => {
  it('returns null for archived lineup', () => {
    const result = buildBannerResponse(
      { ...mockLineup, status: 'archived' },
      [],
      new Map(),
      new Map(),
      0,
      15,
    );

    expect(result).toBeNull();
  });

  it('returns banner data for building lineup', () => {
    const entries = [
      { gameId: 10, gameName: 'Game A', gameCoverUrl: 'url-a' },
      { gameId: 20, gameName: 'Game B', gameCoverUrl: null },
    ];

    const result = buildBannerResponse(
      mockLineup,
      entries,
      new Map([[10, 3]]),
      new Map([
        [10, 2],
        [20, 1],
      ]),
      0,
      15,
    );

    expect(result).not.toBeNull();
    const banner = result as LineupBannerResponseDto;
    expect(banner.id).toBe(1);
    expect(banner.status).toBe('building');
    expect(banner.entryCount).toBe(2);
    expect(banner.totalVoters).toBe(0);
    expect(banner.totalMembers).toBe(15);
    expect(banner.entries).toHaveLength(2);
    expect(banner.entries[0].ownerCount).toBe(3);
    expect(banner.entries[1].ownerCount).toBe(0);
  });

  it('includes voteCount per entry', () => {
    const entries = [{ gameId: 10, gameName: 'Game A', gameCoverUrl: null }];
    const voteMap = new Map([[10, 5]]);

    const result = buildBannerResponse(
      { ...mockLineup, status: 'voting' },
      entries,
      new Map(),
      voteMap,
      3,
      15,
    );

    const banner = result as LineupBannerResponseDto;
    expect(banner.entries[0].voteCount).toBe(5);
    expect(banner.totalVoters).toBe(3);
  });

  it('includes decidedGameName for decided lineup', () => {
    const result = buildBannerResponse(
      {
        ...mockLineup,
        status: 'decided',
        decidedGameId: 10,
        decidedGameName: 'Winner Game',
      },
      [],
      new Map(),
      new Map(),
      0,
      15,
    );

    const banner = result as LineupBannerResponseDto;
    expect(banner.status).toBe('decided');
    expect(banner.decidedGameName).toBe('Winner Game');
  });
});
