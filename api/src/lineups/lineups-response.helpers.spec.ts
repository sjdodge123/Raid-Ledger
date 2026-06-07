/**
 * Unit tests for lineups-response.helpers (ROK-935).
 * Tests that buildDetailResponse wires enrichment data into entries.
 */
import { NotFoundException } from '@nestjs/common';
import { buildDetailResponse } from './lineups-response.helpers';

const NOW = new Date('2026-03-22T20:00:00Z');

const mockLineup = {
  id: 1,
  status: 'building',
  targetDate: null as Date | null,
  decidedGameId: null as number | null,
  linkedEventId: null as number | null,
  createdBy: 10,
  votingDeadline: null as Date | null,
  createdAt: NOW,
  updatedAt: NOW,
  visibility: 'public' as 'public' | 'private',
  channelOverrideId: null as string | null,
};

const mockEntry = {
  id: 100,
  gameId: 42,
  gameName: 'Test Game',
  gameCoverUrl: 'https://example.com/cover.jpg',
  nominatedById: 10,
  nominatedByName: 'TestUser',
  note: null as string | null,
  carriedOverFrom: null as number | null,
  createdAt: NOW,
};

const mockUser = { id: 10, displayName: 'TestUser' };

/**
 * Build a thenable that mimics Drizzle's query builder result.
 * Can be awaited directly (resolves to `data`) or chained.
 */
function thenable(data: unknown[]) {
  return {
    then: (resolve: (v: unknown[]) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(data).then(resolve, reject),
    limit: jest.fn().mockImplementation(() => thenable(data)),
    groupBy: jest.fn().mockImplementation(() => thenable(data)),
    orderBy: jest.fn().mockImplementation(() => thenable(data)),
  };
}

function makeSelectChain(overrides: {
  whereResult?: unknown[];
  limitResult?: unknown[];
  groupByResult?: unknown[];
}) {
  const defaultData = overrides.whereResult ?? [];
  const limitData = overrides.limitResult ?? defaultData;
  const groupByData = overrides.groupByResult ?? defaultData;

  const where = jest.fn().mockImplementation(() => {
    const t = thenable(defaultData);
    t.limit = jest.fn().mockImplementation(() => thenable(limitData));
    t.groupBy = jest.fn().mockImplementation(() => thenable(groupByData));
    return t;
  });

  const innerJoin2 = jest.fn().mockReturnValue({ where });
  const innerJoin1 = jest
    .fn()
    .mockReturnValue({ where, innerJoin: innerJoin2 });

  const fromResult = {
    then: thenable(defaultData).then,
    where,
    innerJoin: innerJoin1,
    orderBy: jest.fn().mockImplementation(() => thenable(defaultData)),
    limit: jest.fn().mockImplementation(() => thenable(limitData)),
    groupBy: jest.fn().mockImplementation(() => thenable(groupByData)),
  };
  const from = jest.fn().mockReturnValue(fromResult);

  return { from };
}

describe('buildDetailResponse', () => {
  it('throws NotFoundException when lineup not found', async () => {
    const mockDb = {
      select: jest.fn(),
      execute: jest
        .fn()
        .mockResolvedValue([{ count: 0, id: 1, display_name: 'User' }]),
    };
    mockDb.select.mockReturnValueOnce(makeSelectChain({ limitResult: [] }));

    await expect(buildDetailResponse(mockDb as any, 999)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('returns detail with enrichment fields on entries', async () => {
    const mockDb = {
      select: jest.fn(),
      execute: jest
        .fn()
        .mockResolvedValue([{ count: 0, id: 1, display_name: 'User' }]),
    };

    // 1. findLineupById
    mockDb.select.mockReturnValueOnce(
      makeSelectChain({ limitResult: [mockLineup] }),
    );
    // 2. findEntriesWithGames
    mockDb.select.mockReturnValueOnce(
      makeSelectChain({ whereResult: [mockEntry] }),
    );
    // 3. countVotesPerGame
    mockDb.select.mockReturnValueOnce(
      makeSelectChain({ groupByResult: [{ gameId: 42, voteCount: 3 }] }),
    );
    // 4. countDistinctVoters
    mockDb.select.mockReturnValueOnce(
      makeSelectChain({ whereResult: [{ total: 5 }] }),
    );
    // 5. findUserById (creator)
    mockDb.select.mockReturnValueOnce(
      makeSelectChain({ limitResult: [mockUser] }),
    );
    // 6. listInviteesWithProfile (ROK-1065 / ROK-1252 — pulled into the
    //    parallel batch so the audience is available for fetchEnrichment).
    mockDb.select.mockReturnValueOnce(makeSelectChain({ whereResult: [] }));
    // 7. countOwnersPerGame
    mockDb.select.mockReturnValueOnce(
      makeSelectChain({ groupByResult: [{ gameId: 42, count: 8 }] }),
    );
    // 8. countWishlistPerGame
    mockDb.select.mockReturnValueOnce(
      makeSelectChain({ groupByResult: [{ gameId: 42, count: 2 }] }),
    );
    // 9. fetchPricingMetadata
    mockDb.select.mockReturnValueOnce(
      makeSelectChain({
        whereResult: [
          {
            id: 42,
            itadCurrentPrice: '14.99',
            itadCurrentCut: 25,
            itadCurrentShop: 'Steam',
            itadCurrentUrl: 'https://store.example.com',
          },
        ],
      }),
    );
    // 10. countTotalMembers
    mockDb.select.mockReturnValueOnce(
      makeSelectChain({ whereResult: [{ count: 15 }] }),
    );

    const result = await buildDetailResponse(mockDb as any, 1);

    expect(result.id).toBe(1);
    expect(result.totalMembers).toBe(15);
    expect(result.entries).toHaveLength(1);

    const entry = result.entries[0];
    expect(entry.gameId).toBe(42);
    expect(entry.ownerCount).toBe(8);
    expect(entry.totalMembers).toBe(15);
    expect(entry.nonOwnerCount).toBe(7);
    expect(entry.wishlistCount).toBe(2);
    expect(entry.voteCount).toBe(3);
    expect(entry.itadCurrentPrice).toBe(14.99);
    expect(entry.itadCurrentCut).toBe(25);
    expect(entry.itadCurrentShop).toBe('Steam');
    expect(entry.itadCurrentUrl).toBe('https://store.example.com');
  });

  it('defaults enrichment fields to 0/null when no data', async () => {
    const mockDb = {
      select: jest.fn(),
      execute: jest
        .fn()
        .mockResolvedValue([{ count: 0, id: 1, display_name: 'User' }]),
    };

    // 1. findLineupById
    mockDb.select.mockReturnValueOnce(
      makeSelectChain({ limitResult: [mockLineup] }),
    );
    // 2. findEntriesWithGames
    mockDb.select.mockReturnValueOnce(
      makeSelectChain({ whereResult: [mockEntry] }),
    );
    // 3. countVotesPerGame
    mockDb.select.mockReturnValueOnce(makeSelectChain({ groupByResult: [] }));
    // 4. countDistinctVoters
    mockDb.select.mockReturnValueOnce(
      makeSelectChain({ whereResult: [{ total: 0 }] }),
    );
    // 5. findUserById (creator)
    mockDb.select.mockReturnValueOnce(
      makeSelectChain({ limitResult: [mockUser] }),
    );
    // 6. listInviteesWithProfile (ROK-1065 / ROK-1252 — pulled into the
    //    parallel batch so the audience is available for fetchEnrichment).
    mockDb.select.mockReturnValueOnce(makeSelectChain({ whereResult: [] }));
    // 7. countOwnersPerGame — empty
    mockDb.select.mockReturnValueOnce(makeSelectChain({ groupByResult: [] }));
    // 8. countWishlistPerGame — empty
    mockDb.select.mockReturnValueOnce(makeSelectChain({ groupByResult: [] }));
    // 9. fetchPricingMetadata — no pricing
    mockDb.select.mockReturnValueOnce(makeSelectChain({ whereResult: [] }));
    // 10. countTotalMembers
    mockDb.select.mockReturnValueOnce(
      makeSelectChain({ whereResult: [{ count: 10 }] }),
    );

    const result = await buildDetailResponse(mockDb as any, 1);

    const entry = result.entries[0];
    expect(entry.ownerCount).toBe(0);
    expect(entry.totalMembers).toBe(10);
    expect(entry.nonOwnerCount).toBe(10);
    expect(entry.wishlistCount).toBe(0);
    expect(entry.itadCurrentPrice).toBeNull();
    expect(entry.itadCurrentCut).toBeNull();
    expect(entry.itadCurrentShop).toBeNull();
    expect(entry.itadCurrentUrl).toBeNull();
    expect(result.totalMembers).toBe(10);
  });

  // ROK-1348: a private lineup measures non-owners against the eligible pool
  // (creator + invitees), NOT the community-wide totalMembers. When every
  // eligible member owns the game, nonOwnerCount must clamp to 0 — not show
  // "13 don't own" because totalMembers happens to be 13.
  it('uses the eligible pool (creator + invitees) as the non-owner denominator for private lineups', async () => {
    const mockDb = {
      select: jest.fn(),
      execute: jest
        .fn()
        .mockResolvedValue([{ count: 0, id: 1, display_name: 'User' }]),
    };

    // 1. findLineupById — private lineup
    mockDb.select.mockReturnValueOnce(
      makeSelectChain({
        limitResult: [{ ...mockLineup, visibility: 'private' }],
      }),
    );
    // 2. findEntriesWithGames
    mockDb.select.mockReturnValueOnce(
      makeSelectChain({ whereResult: [mockEntry] }),
    );
    // 3. countVotesPerGame
    mockDb.select.mockReturnValueOnce(makeSelectChain({ groupByResult: [] }));
    // 4. countDistinctVoters
    mockDb.select.mockReturnValueOnce(
      makeSelectChain({ whereResult: [{ total: 0 }] }),
    );
    // 5. findUserById (creator)
    mockDb.select.mockReturnValueOnce(
      makeSelectChain({ limitResult: [mockUser] }),
    );
    // 6. listInviteesWithProfile — 2 invitees → eligible = creator + 2 = 3
    mockDb.select.mockReturnValueOnce(
      makeSelectChain({
        whereResult: [
          { id: 20, display_name: 'Inv A', steamId: null },
          { id: 21, display_name: 'Inv B', steamId: 'steam:1' },
        ],
      }),
    );
    // 7. countOwnersPerGame (community-wide) — 8 community members own it
    mockDb.select.mockReturnValueOnce(
      makeSelectChain({ groupByResult: [{ gameId: 42, count: 8 }] }),
    );
    // 7b. countOwnersPerGame (audience-scoped, Codex P2) — all 3 eligible own
    mockDb.select.mockReturnValueOnce(
      makeSelectChain({ groupByResult: [{ gameId: 42, count: 3 }] }),
    );
    // 8. countWishlistPerGame
    mockDb.select.mockReturnValueOnce(makeSelectChain({ groupByResult: [] }));
    // 9. fetchPricingMetadata
    mockDb.select.mockReturnValueOnce(makeSelectChain({ whereResult: [] }));
    // 10. countTotalMembers — community is much larger
    mockDb.select.mockReturnValueOnce(
      makeSelectChain({ whereResult: [{ count: 13 }] }),
    );
    // 11. countUnlinkedSteamMembers — private audience uses db.select
    //     (the public branch uses db.execute, so the public tests above
    //     don't need these two extra mocks).
    mockDb.select.mockReturnValueOnce(
      makeSelectChain({ whereResult: [{ count: 0 }] }),
    );
    // 12. findUnlinkedSteamMembers — private audience uses db.select
    mockDb.select.mockReturnValueOnce(makeSelectChain({ whereResult: [] }));

    const result = await buildDetailResponse(mockDb as any, 1);

    const entry = result.entries[0];
    // Displayed ownerCount stays community-wide.
    expect(entry.ownerCount).toBe(8);
    // eligible pool = 3 (creator + 2 invitees); all 3 own → 0 non-owners.
    expect(entry.nonOwnerCount).toBe(0);
    // votingEligibleCount reflects the eligible pool, not totalMembers.
    expect(result.votingEligibleCount).toBe(3);
    // totalMembers is still the community-wide count.
    expect(result.totalMembers).toBe(13);
  });

  // Codex P2 (fix/batch-2026-06-06): owners must be counted in the SAME pool
  // as the denominator. 10 community members owning a game that NO invitee
  // owns must yield nonOwnerCount = eligible pool size, not clamp to 0.
  it('does not let community-wide owners zero out nonOwnerCount on a private lineup', async () => {
    const mockDb = {
      select: jest.fn(),
      execute: jest
        .fn()
        .mockResolvedValue([{ count: 0, id: 1, display_name: 'User' }]),
    };

    mockDb.select.mockReturnValueOnce(
      makeSelectChain({
        limitResult: [{ ...mockLineup, visibility: 'private' }],
      }),
    );
    mockDb.select.mockReturnValueOnce(
      makeSelectChain({ whereResult: [mockEntry] }),
    );
    mockDb.select.mockReturnValueOnce(makeSelectChain({ groupByResult: [] }));
    mockDb.select.mockReturnValueOnce(
      makeSelectChain({ whereResult: [{ total: 0 }] }),
    );
    mockDb.select.mockReturnValueOnce(
      makeSelectChain({ limitResult: [mockUser] }),
    );
    // 2 invitees → eligible = 3
    mockDb.select.mockReturnValueOnce(
      makeSelectChain({
        whereResult: [
          { id: 20, display_name: 'Inv A', steamId: null },
          { id: 21, display_name: 'Inv B', steamId: 'steam:1' },
        ],
      }),
    );
    // community-wide owners: 10 (> eligible pool of 3)
    mockDb.select.mockReturnValueOnce(
      makeSelectChain({ groupByResult: [{ gameId: 42, count: 10 }] }),
    );
    // audience-scoped owners: ZERO invitees own it
    mockDb.select.mockReturnValueOnce(makeSelectChain({ groupByResult: [] }));
    mockDb.select.mockReturnValueOnce(makeSelectChain({ groupByResult: [] }));
    mockDb.select.mockReturnValueOnce(makeSelectChain({ whereResult: [] }));
    mockDb.select.mockReturnValueOnce(
      makeSelectChain({ whereResult: [{ count: 13 }] }),
    );
    mockDb.select.mockReturnValueOnce(
      makeSelectChain({ whereResult: [{ count: 0 }] }),
    );
    mockDb.select.mockReturnValueOnce(makeSelectChain({ whereResult: [] }));

    const result = await buildDetailResponse(mockDb as any, 1);

    const entry = result.entries[0];
    expect(entry.ownerCount).toBe(10);
    // Pre-fix this clamped to max(0, 3 - 10) = 0; correct value is 3.
    expect(entry.nonOwnerCount).toBe(3);
  });
});
