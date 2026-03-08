/**
 * Adversarial tests for ad-hoc notification helpers (ROK-680).
 *
 * Covers edge cases not handled by the dev-written tests:
 * - empty participant arrays
 * - all-left participants (signupCount = 0)
 * - active participants do NOT have a `status` property at all
 * - extendedUntil override on endTime
 * - voiceChannelId inclusion
 * - buildEmbedEventData returns null when event not found
 * - toActiveParticipants / toInactiveParticipants with multiple + empty arrays
 * - resolveNotificationChannel fallback chain
 * - buildContext shape
 */
import {
  buildEmbedEventData,
  buildContext,
  resolveNotificationChannel,
  toActiveParticipants,
  toInactiveParticipants,
  type AdHocNotificationDeps,
  type AdHocParticipant,
} from './ad-hoc-notification.helpers';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';

function createMockDeps(mockDb: MockDb): AdHocNotificationDeps {
  return {
    db: mockDb as unknown as AdHocNotificationDeps['db'],
    channelBindingsService: {
      getBindingById: jest.fn(),
      getBindings: jest.fn().mockResolvedValue([]),
    } as unknown as AdHocNotificationDeps['channelBindingsService'],
    channelResolver: {
      resolveVoiceChannelForScheduledEvent: jest.fn().mockResolvedValue(null),
    } as unknown as AdHocNotificationDeps['channelResolver'],
    settingsService: {
      getBranding: jest.fn().mockResolvedValue({ communityName: 'Test Guild' }),
      getClientUrl: jest.fn().mockResolvedValue('http://localhost'),
      getDefaultTimezone: jest.fn().mockResolvedValue('UTC'),
      getDiscordBotDefaultChannel: jest.fn().mockResolvedValue('default-ch'),
    } as unknown as AdHocNotificationDeps['settingsService'],
  };
}

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    title: 'Quick Play',
    gameId: 10,
    duration: [
      new Date('2026-01-01T18:00:00Z'),
      new Date('2026-01-01T20:00:00Z'),
    ],
    extendedUntil: null,
    maxAttendees: null,
    slotConfig: null,
    notificationChannelOverride: null,
    recurrenceGroupId: null,
    ...overrides,
  };
}

function mockEventAndGame(
  mockDb: MockDb,
  eventOverrides: Record<string, unknown> = {},
  game: { name: string; coverUrl?: string | null } | null = {
    name: 'Test Game',
    coverUrl: null,
  },
): void {
  mockDb.limit.mockResolvedValueOnce([makeEvent(eventOverrides)]);
  if (game) {
    mockDb.limit.mockResolvedValueOnce([game]);
  } else {
    mockDb.limit.mockResolvedValueOnce([]);
  }
}

// ─── buildEmbedEventData edge cases ─────────────────────────

describe('buildEmbedEventData — edge cases (ROK-680)', () => {
  let mockDb: MockDb;
  let deps: AdHocNotificationDeps;

  beforeEach(() => {
    mockDb = createDrizzleMock();
    deps = createMockDeps(mockDb);
  });

  it('returns null when event is not found in DB', async () => {
    mockDb.limit.mockResolvedValueOnce([]);
    const result = await buildEmbedEventData(deps, 999, []);
    expect(result).toBeNull();
  });

  it('handles empty participants array', async () => {
    mockEventAndGame(mockDb);
    const result = await buildEmbedEventData(deps, 1, []);
    expect(result).not.toBeNull();
    expect(result!.signupMentions).toEqual([]);
    expect(result!.signupCount).toBe(0);
  });

  it('signupCount is 0 when all participants have left', async () => {
    mockEventAndGame(mockDb);
    const participants: AdHocParticipant[] = [
      { discordUserId: 'u1', discordUsername: 'P1', isActive: false },
      { discordUserId: 'u2', discordUsername: 'P2', isActive: false },
      { discordUserId: 'u3', discordUsername: 'P3', isActive: false },
    ];
    const result = await buildEmbedEventData(deps, 1, participants);
    expect(result).not.toBeNull();
    expect(result!.signupCount).toBe(0);
    expect(result!.signupMentions).toHaveLength(3);
    for (const mention of result!.signupMentions!) {
      expect(mention.status).toBe('left');
    }
  });

  it('active participants do NOT have status property', async () => {
    mockEventAndGame(mockDb);
    const participants: AdHocParticipant[] = [
      { discordUserId: 'u1', discordUsername: 'Active', isActive: true },
    ];
    const result = await buildEmbedEventData(deps, 1, participants);
    const mention = result!.signupMentions![0];
    expect(mention).not.toHaveProperty('status');
  });

  it('uses extendedUntil as endTime when present', async () => {
    const extendedDate = new Date('2026-01-01T22:00:00Z');
    mockEventAndGame(mockDb, { extendedUntil: extendedDate });
    const result = await buildEmbedEventData(deps, 1, []);
    expect(result!.endTime).toBe(extendedDate.toISOString());
  });

  it('uses duration[1] as endTime when extendedUntil is null', async () => {
    mockEventAndGame(mockDb);
    const result = await buildEmbedEventData(deps, 1, []);
    expect(result!.endTime).toBe('2026-01-01T20:00:00.000Z');
  });

  it('includes voiceChannelId when event has override', async () => {
    mockEventAndGame(mockDb, {
      notificationChannelOverride: 'voice-ch-99',
    });
    const result = await buildEmbedEventData(deps, 1, []);
    expect(result!.voiceChannelId).toBe('voice-ch-99');
  });

  it('omits voiceChannelId when no override and resolver returns null', async () => {
    mockEventAndGame(mockDb);
    const result = await buildEmbedEventData(deps, 1, []);
    expect(result!.voiceChannelId).toBeUndefined();
  });

  it('handles event with null gameId (no game)', async () => {
    mockDb.limit.mockResolvedValueOnce([makeEvent({ gameId: null })]);
    const result = await buildEmbedEventData(deps, 1, []);
    expect(result).not.toBeNull();
    expect(result!.game).toBeUndefined();
  });

  it('includes game cover URL when present', async () => {
    mockEventAndGame(
      mockDb,
      {},
      {
        name: 'WoW',
        coverUrl: 'https://example.com/wow.jpg',
      },
    );
    const result = await buildEmbedEventData(deps, 1, []);
    expect(result!.game).toEqual({
      name: 'WoW',
      coverUrl: 'https://example.com/wow.jpg',
    });
  });

  it('preserves participant ordering (active then left)', async () => {
    mockEventAndGame(mockDb);
    const participants: AdHocParticipant[] = [
      { discordUserId: 'first', discordUsername: 'P1', isActive: true },
      { discordUserId: 'second', discordUsername: 'P2', isActive: false },
      { discordUserId: 'third', discordUsername: 'P3', isActive: true },
    ];
    const result = await buildEmbedEventData(deps, 1, participants);
    const ids = result!.signupMentions!.map((m) => m.discordId);
    expect(ids).toEqual(['first', 'second', 'third']);
  });

  it('maps role and preferredRoles to null for all participants', async () => {
    mockEventAndGame(mockDb);
    const participants: AdHocParticipant[] = [
      { discordUserId: 'u1', discordUsername: 'P1', isActive: true },
      { discordUserId: 'u2', discordUsername: 'P2', isActive: false },
    ];
    const result = await buildEmbedEventData(deps, 1, participants);
    for (const mention of result!.signupMentions!) {
      expect(mention.role).toBeNull();
      expect(mention.preferredRoles).toBeNull();
    }
  });
});

// ─── toActiveParticipants / toInactiveParticipants edge cases ────

describe('toActiveParticipants — edge cases', () => {
  it('returns empty array for empty input', () => {
    expect(toActiveParticipants([])).toEqual([]);
  });

  it('marks multiple participants as active', () => {
    const input = [
      { discordUserId: 'u1', discordUsername: 'P1' },
      { discordUserId: 'u2', discordUsername: 'P2' },
      { discordUserId: 'u3', discordUsername: 'P3' },
    ];
    const result = toActiveParticipants(input);
    expect(result).toHaveLength(3);
    for (const p of result) {
      expect(p.isActive).toBe(true);
    }
  });

  it('preserves discordUserId and discordUsername exactly', () => {
    const result = toActiveParticipants([
      { discordUserId: 'special-id-123', discordUsername: 'Name With Spaces' },
    ]);
    expect(result[0]).toEqual({
      discordUserId: 'special-id-123',
      discordUsername: 'Name With Spaces',
      isActive: true,
    });
  });
});

describe('toInactiveParticipants — edge cases', () => {
  it('returns empty array for empty input', () => {
    expect(toInactiveParticipants([])).toEqual([]);
  });

  it('marks multiple participants as inactive', () => {
    const input = [
      { discordUserId: 'u1', discordUsername: 'P1' },
      { discordUserId: 'u2', discordUsername: 'P2' },
    ];
    const result = toInactiveParticipants(input);
    expect(result).toHaveLength(2);
    for (const p of result) {
      expect(p.isActive).toBe(false);
    }
  });
});

// ─── resolveNotificationChannel edge cases ──────────────────

describe('resolveNotificationChannel — fallback chain', () => {
  let mockDb: MockDb;
  let deps: AdHocNotificationDeps;

  beforeEach(() => {
    mockDb = createDrizzleMock();
    deps = createMockDeps(mockDb);
  });

  it('returns null when binding is not found', async () => {
    (deps.channelBindingsService.getBindingById as jest.Mock).mockResolvedValue(
      null,
    );
    const result = await resolveNotificationChannel(deps, 'missing');
    expect(result).toBeNull();
  });

  it('returns config channel when present', async () => {
    (deps.channelBindingsService.getBindingById as jest.Mock).mockResolvedValue(
      {
        id: 'b1',
        config: { notificationChannelId: 'config-ch' },
      },
    );
    const result = await resolveNotificationChannel(deps, 'b1');
    expect(result).toBe('config-ch');
  });

  it('falls back to game-announcements binding', async () => {
    (deps.channelBindingsService.getBindingById as jest.Mock).mockResolvedValue(
      {
        id: 'b1',
        config: {},
        gameId: 5,
        guildId: 'guild-1',
      },
    );
    (deps.channelBindingsService.getBindings as jest.Mock).mockResolvedValue([
      {
        bindingPurpose: 'game-announcements',
        gameId: 5,
        channelId: 'announce-ch',
      },
    ]);
    const result = await resolveNotificationChannel(deps, 'b1');
    expect(result).toBe('announce-ch');
  });

  it('falls back to default bot channel when no announcement binding', async () => {
    (deps.channelBindingsService.getBindingById as jest.Mock).mockResolvedValue(
      {
        id: 'b1',
        config: {},
        gameId: 5,
        guildId: 'guild-1',
      },
    );
    (deps.channelBindingsService.getBindings as jest.Mock).mockResolvedValue([
      {
        bindingPurpose: 'voice-lobby',
        gameId: 5,
        channelId: 'lobby-ch',
      },
    ]);
    const result = await resolveNotificationChannel(deps, 'b1');
    expect(result).toBe('default-ch');
  });

  it('falls back to default when binding has null gameId', async () => {
    (deps.channelBindingsService.getBindingById as jest.Mock).mockResolvedValue(
      {
        id: 'b1',
        config: {},
        gameId: null,
        guildId: 'guild-1',
      },
    );
    const result = await resolveNotificationChannel(deps, 'b1');
    expect(result).toBe('default-ch');
  });
});

// ─── buildContext ────────────────────────────────────────────

describe('buildContext', () => {
  it('returns context with communityName, clientUrl, timezone', async () => {
    const mockDb = createDrizzleMock();
    const deps = createMockDeps(mockDb);
    const ctx = await buildContext(deps);
    expect(ctx).toEqual({
      communityName: 'Test Guild',
      clientUrl: 'http://localhost',
      timezone: 'UTC',
    });
  });
});
