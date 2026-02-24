/**
 * Shared mock data factories for backend tests.
 *
 * These replace the ad-hoc mock objects duplicated across 20+ spec files.
 * Each factory returns a plain object matching the Drizzle row shape
 * (database columns, not API response DTOs).
 */

export function createMockUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    username: 'testuser',
    displayName: null,
    avatar: null,
    discordId: '123456789',
    customAvatarUrl: null,
    role: 'member' as const,
    onboardingCompletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

export function createMockEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    title: 'Test Event',
    description: 'Test description',
    gameId: 1,
    creatorId: 1,
    duration: [
      new Date('2026-02-10T18:00:00Z'),
      new Date('2026-02-10T20:00:00Z'),
    ] as [Date, Date],
    maxAttendees: null,
    slotConfig: null,
    autoUnbench: false,
    contentInstances: null,
    recurrenceGroupId: null,
    recurrenceRule: null,
    reminder15min: true,
    reminder1hour: false,
    reminder24hour: false,
    cancelledAt: null,
    cancellationReason: null,
    createdAt: new Date('2026-01-15T00:00:00Z'),
    updatedAt: new Date('2026-01-15T00:00:00Z'),
    ...overrides,
  };
}

export function createMockSignup(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    eventId: 1,
    userId: 1,
    note: null,
    signedUpAt: new Date('2026-02-01T12:00:00Z'),
    characterId: null,
    confirmationStatus: 'pending' as const,
    status: 'signed_up' as const,
    preferredRoles: null,
    isAnonymous: false,
    discordUserId: null,
    discordUsername: null,
    discordAvatarHash: null,
    ...overrides,
  };
}

export function createMockGame(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    igdbId: 1234,
    name: 'World of Warcraft',
    slug: 'world-of-warcraft',
    coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/abc.jpg',
    ...overrides,
  };
}
