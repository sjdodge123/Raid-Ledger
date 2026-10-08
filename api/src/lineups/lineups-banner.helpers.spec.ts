/**
 * Unit tests for lineup banner helpers (ROK-935).
 * Tests buildBannerResponse mapping and the two-key banner scope gate
 * (parseBannerScope + resolveBannerScope). The
 * findBannerLineup query itself is covered against a real database in
 * lineups-banner-scope.integration.spec.ts.
 */
import {
  buildBannerResponse,
  parseBannerScope,
  resolveBannerScope,
} from './lineups-banner.helpers';
import type { LineupBannerResponseDto } from '@raid-ledger/contract';

const NOW = new Date('2026-03-22T20:00:00Z');

const mockLineup = {
  id: 1,
  title: 'Test Lineup',
  description: null as string | null,
  status: 'building' as const,
  targetDate: NOW,
  decidedGameId: null as number | null,
  decidedGameName: null as string | null,
  createdBy: 10,
  votingDeadline: null as Date | null,
  createdAt: NOW,
  updatedAt: NOW,
  linkedEventId: null as number | null,
  visibility: 'public' as const,
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
      15,
    );

    expect(result).not.toBeNull();
    const banner = result as LineupBannerResponseDto;
    expect(banner.id).toBe(1);
    expect(banner.status).toBe('building');
    expect(banner.entryCount).toBe(2);
    expect(banner.totalVoters).toBe(0);
    expect(banner.totalMembers).toBe(15);
    // ROK-1348: public lineup — eligible pool == totalMembers.
    expect(banner.votingEligibleCount).toBe(15);
    expect(banner.entries).toHaveLength(2);
    expect(banner.entries[0]?.ownerCount).toBe(3);
    expect(banner.entries[1]?.ownerCount).toBe(0);
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
      15,
    );

    const banner = result as LineupBannerResponseDto;
    expect(banner.entries[0]?.voteCount).toBe(5);
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
      15,
    );

    const banner = result as LineupBannerResponseDto;
    expect(banner.status).toBe('decided');
    expect(banner.decidedGameName).toBe('Winner Game');
  });

  // ROK-1348: the people-denominator passes straight through; a private
  // lineup's eligible count (creator + invitees) must be surfaced verbatim,
  // distinct from the community-wide totalMembers.
  it('surfaces a private-lineup votingEligibleCount distinct from totalMembers', () => {
    const result = buildBannerResponse(
      { ...mockLineup, visibility: 'private' },
      [],
      new Map(),
      new Map(),
      0,
      15, // community totalMembers
      4, // creator + 3 invitees
    );

    const banner = result as LineupBannerResponseDto;
    expect(banner.totalMembers).toBe(15);
    expect(banner.votingEligibleCount).toBe(4);
  });
});

describe('parseBannerScope', () => {
  it('returns the id when DEMO_MODE is true and the value is a positive int', () => {
    expect(parseBannerScope('7', 'true')).toBe(7);
  });

  it('accepts the int4 upper bound', () => {
    expect(parseBannerScope('2147483647', 'true')).toBe(2147483647);
  });

  it('ignores the scope when DEMO_MODE is unset', () => {
    expect(parseBannerScope('7', undefined)).toBeUndefined();
  });

  it('ignores the scope when DEMO_MODE is false', () => {
    expect(parseBannerScope('7', 'false')).toBeUndefined();
  });

  it.each([
    ['zero', '0'],
    ['negative', '-1'],
    ['non-numeric', 'abc'],
    ['decimal', '1.5'],
    ['above int4', '99999999999'],
    ['just above int4', '2147483648'],
    ['empty', ''],
  ])('ignores a %s value', (_label, raw) => {
    expect(parseBannerScope(raw, 'true')).toBeUndefined();
  });

  it('ignores a repeated query param (array)', () => {
    expect(parseBannerScope(['7'], 'true')).toBeUndefined();
  });

  it('reads DEMO_MODE at call time when no override is passed', () => {
    const original = process.env.DEMO_MODE;
    try {
      process.env.DEMO_MODE = 'true';
      expect(parseBannerScope('7')).toBe(7);
      delete process.env.DEMO_MODE;
      expect(parseBannerScope('7')).toBeUndefined();
    } finally {
      if (original === undefined) delete process.env.DEMO_MODE;
      else process.env.DEMO_MODE = original;
    }
  });
});

describe('resolveBannerScope', () => {
  const settingsWith = (demoMode: boolean) => ({
    getDemoMode: jest.fn().mockResolvedValue(demoMode),
  });

  it('returns the id when env DEMO_MODE and the demo_mode setting are both on', async () => {
    await expect(
      resolveBannerScope('7', settingsWith(true), 'true'),
    ).resolves.toBe(7);
  });

  it('ignores the scope when the demo_mode setting is off even though env DEMO_MODE is true', async () => {
    await expect(
      resolveBannerScope('7', settingsWith(false), 'true'),
    ).resolves.toBeUndefined();
  });

  it('skips the settings read when env DEMO_MODE is off', async () => {
    const settings = settingsWith(true);
    await expect(
      resolveBannerScope('7', settings, undefined),
    ).resolves.toBeUndefined();
    expect(settings.getDemoMode).not.toHaveBeenCalled();
  });

  it('skips the settings read when no scope was sent', async () => {
    const settings = settingsWith(true);
    await expect(
      resolveBannerScope(undefined, settings, 'true'),
    ).resolves.toBeUndefined();
    expect(settings.getDemoMode).not.toHaveBeenCalled();
  });
});
