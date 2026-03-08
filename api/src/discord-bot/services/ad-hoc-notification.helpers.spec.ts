/**
 * Tests for ad-hoc notification helper functions (ROK-680).
 *
 * Verifies that buildEmbedEventData includes all participants
 * (both active and left) in the signupMentions array.
 */
import {
  buildEmbedEventData,
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
      getBindings: jest.fn(),
    } as unknown as AdHocNotificationDeps['channelBindingsService'],
    channelResolver: {
      resolveVoiceChannelForScheduledEvent: jest.fn().mockResolvedValue(null),
    } as unknown as AdHocNotificationDeps['channelResolver'],
    settingsService: {
      getBranding: jest.fn().mockResolvedValue({ communityName: 'Test' }),
      getClientUrl: jest.fn().mockResolvedValue('http://localhost'),
      getDefaultTimezone: jest.fn().mockResolvedValue('UTC'),
      getDiscordBotDefaultChannel: jest.fn().mockResolvedValue('ch-1'),
    } as unknown as AdHocNotificationDeps['settingsService'],
  };
}

function mockEventAndGame(mockDb: MockDb): void {
  mockDb.limit.mockResolvedValueOnce([
    {
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
    },
  ]);
  mockDb.limit.mockResolvedValueOnce([{ name: 'Test Game', coverUrl: null }]);
}

describe('buildEmbedEventData — participant inclusion (ROK-680)', () => {
  let mockDb: MockDb;
  let deps: AdHocNotificationDeps;

  beforeEach(() => {
    mockDb = createDrizzleMock();
    deps = createMockDeps(mockDb);
  });

  it('includes active participants in signupMentions', async () => {
    mockEventAndGame(mockDb);
    const participants: AdHocParticipant[] = [
      { discordUserId: 'u1', discordUsername: 'Player1', isActive: true },
    ];
    const result = await buildEmbedEventData(deps, 1, participants);
    expect(result).not.toBeNull();
    expect(result!.signupMentions).toEqual([
      expect.objectContaining({ discordId: 'u1', username: 'Player1' }),
    ]);
  });

  it('includes left participants in signupMentions with status "left"', async () => {
    mockEventAndGame(mockDb);
    const participants: AdHocParticipant[] = [
      { discordUserId: 'u1', discordUsername: 'Player1', isActive: false },
    ];
    const result = await buildEmbedEventData(deps, 1, participants);
    expect(result).not.toBeNull();
    expect(result!.signupMentions).toEqual([
      expect.objectContaining({
        discordId: 'u1',
        username: 'Player1',
        status: 'left',
      }),
    ]);
  });

  it('includes both active and left participants', async () => {
    mockEventAndGame(mockDb);
    const participants: AdHocParticipant[] = [
      { discordUserId: 'u1', discordUsername: 'ActiveP', isActive: true },
      { discordUserId: 'u2', discordUsername: 'LeftP', isActive: false },
    ];
    const result = await buildEmbedEventData(deps, 1, participants);
    expect(result).not.toBeNull();
    expect(result!.signupMentions).toHaveLength(2);
    const activeEntry = result!.signupMentions!.find(
      (m) => m.discordId === 'u1',
    );
    const leftEntry = result!.signupMentions!.find((m) => m.discordId === 'u2');
    expect(activeEntry).toBeDefined();
    expect(activeEntry!.status).toBeUndefined();
    expect(leftEntry).toBeDefined();
    expect(leftEntry!.status).toBe('left');
  });

  it('sets signupCount to number of active participants only', async () => {
    mockEventAndGame(mockDb);
    const participants: AdHocParticipant[] = [
      { discordUserId: 'u1', discordUsername: 'Active', isActive: true },
      { discordUserId: 'u2', discordUsername: 'Left', isActive: false },
      { discordUserId: 'u3', discordUsername: 'Active2', isActive: true },
    ];
    const result = await buildEmbedEventData(deps, 1, participants);
    expect(result).not.toBeNull();
    expect(result!.signupCount).toBe(2);
  });
});

describe('toActiveParticipants', () => {
  it('marks all participants as active', () => {
    const result = toActiveParticipants([
      { discordUserId: 'u1', discordUsername: 'P1' },
    ]);
    expect(result).toEqual([
      { discordUserId: 'u1', discordUsername: 'P1', isActive: true },
    ]);
  });
});

describe('toInactiveParticipants', () => {
  it('marks all participants as inactive', () => {
    const result = toInactiveParticipants([
      { discordUserId: 'u1', discordUsername: 'P1' },
    ]);
    expect(result).toEqual([
      { discordUserId: 'u1', discordUsername: 'P1', isActive: false },
    ]);
  });
});
