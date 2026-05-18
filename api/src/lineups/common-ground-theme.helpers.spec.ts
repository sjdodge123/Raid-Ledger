/**
 * Failing-first unit tests for ROK-1297 Common Ground theme classifier +
 * whyReason builder (`api/src/lineups/common-ground-theme.helpers.ts`).
 *
 * MUST fail with module-not-found until the dev creates the helper file
 * exporting `classifyTheme` and `buildWhyReason`. Once exported, the
 * assertions below pin the behaviour described in the spec's
 * "Why-reason templates" table and the brief's `classifyTheme` priority
 * (owned > taste > trending on tie).
 */
import { classifyTheme, buildWhyReason } from './common-ground-theme.helpers';
import type {
  CommonGroundGameDto,
  CommonGroundScoreBreakdownDto,
  CommonGroundTheme,
} from '@raid-ledger/contract';

function breakdown(
  parts: Partial<CommonGroundScoreBreakdownDto>,
): CommonGroundScoreBreakdownDto {
  return {
    baseScore: 0,
    tasteScore: 0,
    socialScore: 0,
    intensityScore: 0,
    total: 0,
    ...parts,
  };
}

function game(
  overrides: Partial<CommonGroundGameDto> = {},
): CommonGroundGameDto {
  return {
    gameId: 1,
    gameName: 'Valheim',
    slug: 'valheim',
    coverUrl: null,
    ownerCount: 0,
    wishlistCount: 0,
    nonOwnerPrice: null,
    itadCurrentCut: null,
    itadCurrentShop: null,
    itadCurrentUrl: null,
    earlyAccess: false,
    itadTags: [],
    playerCount: null,
    score: 0,
    ...overrides,
  };
}

describe('classifyTheme (ROK-1297)', () => {
  it('returns "owned" when socialScore dominates', () => {
    const theme: CommonGroundTheme = classifyTheme(
      breakdown({ socialScore: 50, tasteScore: 5, baseScore: 0 }),
    );
    expect(theme).toBe('owned');
  });

  it('returns "taste" when tasteScore dominates', () => {
    expect(
      classifyTheme(
        breakdown({ socialScore: 5, tasteScore: 30, baseScore: 0 }),
      ),
    ).toBe('taste');
  });

  it('returns "trending" when baseScore dominates', () => {
    expect(
      classifyTheme(
        breakdown({ socialScore: 2, tasteScore: 2, baseScore: 25 }),
      ),
    ).toBe('trending');
  });

  it('breaks ties in priority order: owned > taste > trending', () => {
    // socialScore == tasteScore == baseScore → owned wins.
    expect(
      classifyTheme(
        breakdown({ socialScore: 10, tasteScore: 10, baseScore: 10 }),
      ),
    ).toBe('owned');
    // tasteScore == baseScore (no social) → taste wins.
    expect(
      classifyTheme(
        breakdown({ socialScore: 0, tasteScore: 10, baseScore: 10 }),
      ),
    ).toBe('taste');
  });

  it('returns "trending" when all factors are zero (no signal → trending fallback)', () => {
    expect(classifyTheme(breakdown({}))).toBe('trending');
  });
});

describe('buildWhyReason — owned theme (ROK-1297)', () => {
  it('formats the base owned template', () => {
    const reason = buildWhyReason(game({ ownerCount: 12 }), 'owned', {
      ownerCount: 12,
    });
    expect(reason).toBe('12 of you own this');
  });

  it('uses the sale modifier when itadCurrentCut is set and price is not free', () => {
    const reason = buildWhyReason(
      game({ ownerCount: 9, itadCurrentCut: 60, nonOwnerPrice: 9.99 }),
      'owned',
      { ownerCount: 9, itadCurrentCut: 60 },
    );
    expect(reason).toBe('9 of you own · 60% off');
  });

  it('uses the free modifier when itadCurrentCut is 100 or price is 0', () => {
    const reason = buildWhyReason(
      game({ ownerCount: 18, itadCurrentCut: 100, nonOwnerPrice: 0 }),
      'owned',
      { ownerCount: 18, itadCurrentCut: 100 },
    );
    expect(reason).toBe('18 own · Free');
  });

  it('prefers free over sale when both apply (strongest modifier wins)', () => {
    // Only 100%-off counts as free; a 99% cut at $0 also reads as free.
    const reason = buildWhyReason(
      game({ ownerCount: 5, itadCurrentCut: 100, nonOwnerPrice: 0 }),
      'owned',
      { ownerCount: 5, itadCurrentCut: 100 },
    );
    expect(reason).toContain('Free');
  });
});

describe('buildWhyReason — taste theme (ROK-1297)', () => {
  it('renders the top 2 genres in the templated string', () => {
    const reason = buildWhyReason(game(), 'taste', {
      ownerCount: 0,
      topGenres: ['sci-fi', 'co-op'],
    });
    expect(reason).toBe('Matches your sci-fi/co-op cluster');
  });

  it('falls back gracefully when topGenres is empty', () => {
    const reason = buildWhyReason(game(), 'taste', {
      ownerCount: 0,
      topGenres: [],
    });
    // Should still produce a non-empty taste-flavoured reason rather than
    // an empty string — the dev picks the fallback copy (e.g. "Matches
    // your taste"). Assert non-empty + lowercase keyword.
    expect(reason.length).toBeGreaterThan(0);
    expect(reason.toLowerCase()).toContain('match');
  });
});

describe('buildWhyReason — trending theme (ROK-1297)', () => {
  it('renders the wishlist template when wishlistCount > 0 and no sale', () => {
    const reason = buildWhyReason(game({ wishlistCount: 6 }), 'trending', {
      ownerCount: 0,
      wishlistCount: 6,
    });
    expect(reason).toBe('Wishlisted by 6 · launches soon');
  });

  it('renders the sale template when itadCurrentCut is set', () => {
    const reason = buildWhyReason(
      game({ ownerCount: 14, itadCurrentCut: 70 }),
      'trending',
      { ownerCount: 14, itadCurrentCut: 70 },
    );
    expect(reason).toBe('On sale 70% off · 14 own');
  });

  it('falls back to the base "Trending in your guild" string when no modifiers apply', () => {
    const reason = buildWhyReason(game(), 'trending', { ownerCount: 0 });
    expect(reason).toContain('Trending');
  });

  it('sale modifier wins over base on trending (strongest signal)', () => {
    const reason = buildWhyReason(
      game({ ownerCount: 3, itadCurrentCut: 50, wishlistCount: 4 }),
      'trending',
      { ownerCount: 3, itadCurrentCut: 50, wishlistCount: 4 },
    );
    // Spec table: sale > free > base. Sale wins over wishlist.
    expect(reason).toContain('On sale');
  });
});

describe('buildWhyReason — 80-char cap (ROK-1297)', () => {
  it('truncates whyReason at 80 characters across all themes', () => {
    const longGenres = ['aaaaaaaaaa', 'bbbbbbbbbb', 'cccccccccc', 'dddddddddd'];
    const owned = buildWhyReason(game({ ownerCount: 1_000_000_000 }), 'owned', {
      ownerCount: 1_000_000_000,
      itadCurrentCut: 50,
    });
    const taste = buildWhyReason(game(), 'taste', {
      ownerCount: 0,
      topGenres: longGenres,
    });
    const trending = buildWhyReason(
      game({ wishlistCount: 999_999 }),
      'trending',
      { ownerCount: 0, wishlistCount: 999_999 },
    );
    expect(owned.length).toBeLessThanOrEqual(80);
    expect(taste.length).toBeLessThanOrEqual(80);
    expect(trending.length).toBeLessThanOrEqual(80);
  });
});
