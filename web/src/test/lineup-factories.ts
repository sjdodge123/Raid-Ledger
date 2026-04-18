/**
 * Test factories for Community Lineup data (ROK-935).
 * Produces mock DTOs matching the contract schema shapes.
 */
import type {
    LineupBannerResponseDto,
    LineupDetailResponseDto,
    LineupEntryResponseDto,
} from '@raid-ledger/contract';

/** Create a mock lineup banner response. */
export function createMockBanner(
    overrides: Partial<LineupBannerResponseDto> = {},
): LineupBannerResponseDto {
    return {
        id: 1,
        title: 'Test Lineup',
        description: null,
        status: 'building',
        targetDate: '2026-03-28',
        entryCount: 3,
        totalVoters: 5,
        totalMembers: 10,
        decidedGameName: null,
        entries: [
            { gameId: 1, gameName: 'Valheim', gameCoverUrl: '/cover1.jpg', ownerCount: 6, voteCount: 3 },
            { gameId: 2, gameName: 'Elden Ring', gameCoverUrl: '/cover2.jpg', ownerCount: 4, voteCount: 2 },
        ],
        ...overrides,
    } as LineupBannerResponseDto;
}

/** Create a mock lineup entry response. */
export function createMockEntry(
    overrides: Partial<LineupEntryResponseDto> = {},
): LineupEntryResponseDto {
    return {
        id: 1,
        gameId: 42,
        gameName: 'Valheim',
        gameCoverUrl: '/cover.jpg',
        nominatedBy: { id: 1, displayName: 'TestUser' },
        note: null,
        carriedOver: false,
        voteCount: 3,
        createdAt: '2026-03-20T00:00:00Z',
        ownerCount: 6,
        totalMembers: 10,
        nonOwnerCount: 4,
        wishlistCount: 2,
        itadCurrentPrice: 14.99,
        itadCurrentCut: 25,
        itadCurrentShop: 'Steam',
        itadCurrentUrl: 'https://store.steampowered.com/app/892970',
        ...overrides,
    };
}

/** Create a mock lineup detail response. */
export function createMockLineupDetail(
    overrides: Partial<LineupDetailResponseDto> = {},
): LineupDetailResponseDto {
    return {
        id: 1,
        title: 'Test Lineup',
        description: null,
        status: 'building',
        targetDate: '2026-03-28',
        decidedGameId: null,
        decidedGameName: null,
        linkedEventId: null,
        createdBy: { id: 1, displayName: 'Admin' },
        votingDeadline: null,
        maxVotesPerPlayer: 3,
        entries: [createMockEntry()],
        totalVoters: 5,
        totalMembers: 10,
        createdAt: '2026-03-20T00:00:00Z',
        updatedAt: '2026-03-20T00:00:00Z',
        ...overrides,
    } as LineupDetailResponseDto;
}
