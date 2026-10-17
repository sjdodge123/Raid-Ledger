/**
 * Shared mock data factories for frontend tests.
 *
 * These return objects matching the contract DTO shapes (API responses),
 * not raw database rows. Promoted from ad-hoc factories in event-card.test.tsx
 * and other component tests.
 */
import type { EventResponseDto } from '@raid-ledger/contract';

export function createMockEvent(
    overrides: Partial<EventResponseDto> = {},
): EventResponseDto {
    return {
        id: 1,
        title: 'Test Raid Night',
        description: 'Weekly raid session',
        startTime: '2026-02-10T20:00:00Z',
        endTime: '2026-02-10T23:00:00Z',
        creator: {
            id: 1,
            username: 'TestUser',
            avatar: null,
        },
        game: {
            id: 1,
            name: 'World of Warcraft',
            slug: 'world-of-warcraft',
            coverUrl: 'https://example.com/cover.jpg',
        },
        signupCount: 3,
        createdAt: '2026-02-01T00:00:00Z',
        updatedAt: '2026-02-01T00:00:00Z',
        ...overrides,
    };
}

export function createMockUser(overrides: Record<string, unknown> = {}) {
    return {
        id: 1,
        username: 'TestUser',
        displayName: null,
        avatar: null,
        discordId: '123456789',
        customAvatarUrl: null,
        role: 'member' as const,
        onboardingCompletedAt: null,
        createdAt: '2026-01-01T00:00:00Z',
        characters: [],
        ...overrides,
    };
}
