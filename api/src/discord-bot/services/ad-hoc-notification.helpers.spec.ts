/**
 * Tests for ad-hoc notification helper functions (ROK-680).
 *
 * Verifies that buildEmbedEventData includes all participants
 * (both active and left) in the signupMentions array.
 */
import {
  buildEmbedEventData,
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
      getBindings: jest.fn(),
    } as unknown as AdHocNotificationDeps['channelBindingsService'],
    channelResolver: {
      // ROK-1389: resolveVoice routes through the shared entry. With no guild
      // cache the guard uses a set override optimistically, else tiered (null).
      resolveVoiceChannelHonoringOverride: jest
        .fn()
        .mockImplementation((_g, _r, _e, override) =>
          Promise.resolve(override ?? null),
        ),
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
    // Ad-hoc rosters render the stored username and drop discordId so ex-guild
    // members don't leak raw <@id> tokens in the embed (ROK).
    expect(result!.signupMentions).toEqual([
      expect.objectContaining({ discordId: null, username: 'Player1' }),
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
        discordId: null,
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
      (m) => m.username === 'ActiveP',
    );
    const leftEntry = result!.signupMentions!.find(
      (m) => m.username === 'LeftP',
    );
    expect(activeEntry).toBeDefined();
    expect(activeEntry!.status).toBeUndefined();
    expect(leftEntry).toBeDefined();
    expect(leftEntry!.status).toBe('left');
  });

  it('sets signupCount to cumulative participants (ROK-1243)', async () => {
    mockEventAndGame(mockDb);
    const participants: AdHocParticipant[] = [
      { discordUserId: 'u1', discordUsername: 'Active', isActive: true },
      { discordUserId: 'u2', discordUsername: 'Left', isActive: false },
      { discordUserId: 'u3', discordUsername: 'Active2', isActive: true },
    ];
    const result = await buildEmbedEventData(deps, 1, participants);
    expect(result).not.toBeNull();
    // ROSTER must reflect cumulative participation, not currently-active.
    expect(result!.signupCount).toBe(3);
  });

  it('keeps signupCount 0 for empty participants (defensive)', async () => {
    mockEventAndGame(mockDb);
    const result = await buildEmbedEventData(deps, 1, []);
    expect(result).not.toBeNull();
    expect(result!.signupCount).toBe(0);
    expect(result!.signupMentions).toEqual([]);
  });

  it('mention length always equals participants length', async () => {
    mockEventAndGame(mockDb);
    const participants: AdHocParticipant[] = [
      { discordUserId: 'u1', discordUsername: 'A', isActive: true },
      { discordUserId: 'u2', discordUsername: 'B', isActive: false },
      { discordUserId: 'u3', discordUsername: 'C', isActive: false },
      { discordUserId: 'u4', discordUsername: 'D', isActive: true },
    ];
    const result = await buildEmbedEventData(deps, 1, participants);
    expect(result).not.toBeNull();
    expect(result!.signupMentions).toHaveLength(participants.length);
  });

  it('status is "left" iff isActive is false', async () => {
    mockEventAndGame(mockDb);
    const participants: AdHocParticipant[] = [
      { discordUserId: 'u1', discordUsername: 'A', isActive: true },
      { discordUserId: 'u2', discordUsername: 'B', isActive: false },
    ];
    const result = await buildEmbedEventData(deps, 1, participants);
    expect(result).not.toBeNull();
    const byName = new Map(result!.signupMentions!.map((m) => [m.username, m]));
    expect(byName.get('A')!.status).toBeUndefined();
    expect(byName.get('B')!.status).toBe('left');
  });
});

describe('resolveNotificationChannel — routing priority (ROK-1390)', () => {
  /** A game-announcements sibling binding row for getBindings(). */
  type AnnounceBinding = {
    bindingPurpose: string;
    gameId: number | null;
    channelId: string;
  };

  function makeDeps(opts: {
    binding: unknown;
    seriesChannel?: string | null;
    guildBindings?: AnnounceBinding[];
    defaultChannel?: string | null;
  }): AdHocNotificationDeps {
    return {
      db: {} as AdHocNotificationDeps['db'],
      channelBindingsService: {
        getBindingById: jest.fn().mockResolvedValue(opts.binding),
        getBindings: jest.fn().mockResolvedValue(opts.guildBindings ?? []),
        getChannelForSeries: jest
          .fn()
          .mockResolvedValue(opts.seriesChannel ?? null),
      } as unknown as AdHocNotificationDeps['channelBindingsService'],
      channelResolver: {} as AdHocNotificationDeps['channelResolver'],
      settingsService: {
        getDiscordBotDefaultChannel: jest
          .fn()
          .mockResolvedValue(opts.defaultChannel ?? 'default-ch'),
      } as unknown as AdHocNotificationDeps['settingsService'],
    };
  }

  const seriesMock = (deps: AdHocNotificationDeps): jest.Mock =>
    deps.channelBindingsService.getChannelForSeries as unknown as jest.Mock;

  it('routes a series-linked quick-play to the series announce slot over game/default (RED)', async () => {
    const deps = makeDeps({
      binding: {
        id: 'b1',
        guildId: 'g1',
        gameId: 10,
        recurrenceGroupId: 'series-1',
        config: null,
      },
      seriesChannel: 'series-ch',
      guildBindings: [
        {
          bindingPurpose: 'game-announcements',
          gameId: 10,
          channelId: 'game-ch',
        },
      ],
      defaultChannel: 'default-ch',
    });

    const result = await resolveNotificationChannel(deps, 'b1');

    // Series announce tier must win over the game-announcements/default channels.
    expect(result).toBe('series-ch');
  });

  it('keeps an explicit config.notificationChannelId ahead of the series slot (GREEN pin)', async () => {
    const deps = makeDeps({
      binding: {
        id: 'b1',
        guildId: 'g1',
        gameId: 10,
        recurrenceGroupId: 'series-1',
        config: { notificationChannelId: 'cfg-ch' },
      },
      seriesChannel: 'series-ch',
    });

    const result = await resolveNotificationChannel(deps, 'b1');

    expect(result).toBe('cfg-ch');
    expect(seriesMock(deps)).not.toHaveBeenCalled();
  });

  it('falls through to game-announcements when the series has no announce slot bound', async () => {
    const deps = makeDeps({
      binding: {
        id: 'b1',
        guildId: 'g1',
        gameId: 10,
        recurrenceGroupId: 'series-1',
        config: null,
      },
      seriesChannel: null, // no series announce slot → graceful fallthrough
      guildBindings: [
        {
          bindingPurpose: 'game-announcements',
          gameId: 10,
          channelId: 'game-ch',
        },
      ],
      defaultChannel: 'default-ch',
    });

    const result = await resolveNotificationChannel(deps, 'b1');

    expect(result).toBe('game-ch');
  });

  it('resolves the game-announcements tier using the event EFFECTIVE gameId, not the binding gameId (RED)', async () => {
    // Binding is bound to game 10, but the live event effectively resolved to
    // game 99 (runtime game fallback). Announce routing must follow the event's
    // effective game. Cast bridges the pre-fix 2-arg signature (dev adds param).
    const deps = makeDeps({
      binding: {
        id: 'b1',
        guildId: 'g1',
        gameId: 10,
        recurrenceGroupId: null,
        config: null,
      },
      seriesChannel: null,
      guildBindings: [
        {
          bindingPurpose: 'game-announcements',
          gameId: 99,
          channelId: 'ann-99-ch',
        },
      ],
      defaultChannel: 'default-ch',
    });

    // The current 2-arg signature is structurally assignable to the target
    // 3-arg form (the dev adds the optional effectiveGameId param). No assertion
    // needed — under current code the extra arg is ignored (uses binding.gameId).
    const resolveWithEffective: (
      d: AdHocNotificationDeps,
      bindingId: string,
      effectiveGameId?: number | null,
    ) => Promise<string | null> = resolveNotificationChannel;

    const result = await resolveWithEffective(deps, 'b1', 99);

    expect(result).toBe('ann-99-ch');
  });

  it('falls back to the binding gameId for the announce tier when no effective gameId is supplied (GREEN pin)', async () => {
    const deps = makeDeps({
      binding: {
        id: 'b1',
        guildId: 'g1',
        gameId: 10,
        recurrenceGroupId: null,
        config: null,
      },
      seriesChannel: null,
      guildBindings: [
        {
          bindingPurpose: 'game-announcements',
          gameId: 10,
          channelId: 'ann-10-ch',
        },
      ],
      defaultChannel: 'default-ch',
    });

    const result = await resolveNotificationChannel(deps, 'b1');

    expect(result).toBe('ann-10-ch');
  });

  it('ROK-1394: a deliberate null effectiveGameId does NOT resurrect the bind game-announcements channel (non-series → default)', async () => {
    // The degrade-to-null spawn path passes effectiveGameId === null. `?? binding.gameId`
    // would wrongly route an Untitled session to the sticky game's #announcements
    // channel (#general); null must stay distinct from undefined and fall through.
    const deps = makeDeps({
      binding: {
        id: 'b1',
        guildId: 'g1',
        gameId: 10,
        recurrenceGroupId: null,
        config: null,
      },
      seriesChannel: null,
      guildBindings: [
        {
          bindingPurpose: 'game-announcements',
          gameId: 10,
          channelId: 'game-ch',
        },
      ],
      defaultChannel: 'default-ch',
    });

    const result = await resolveNotificationChannel(deps, 'b1', null);

    // Must NOT be the sticky game's announcements channel — falls to default.
    expect(result).not.toBe('game-ch');
    expect(result).toBe('default-ch');
  });

  it('ROK-1394: a null effectiveGameId series bind still routes to the series announce slot (not #general)', async () => {
    const deps = makeDeps({
      binding: {
        id: 'b1',
        guildId: 'g1',
        gameId: 10,
        recurrenceGroupId: 'series-1',
        config: null,
      },
      seriesChannel: 'series-ch',
      guildBindings: [
        {
          bindingPurpose: 'game-announcements',
          gameId: 10,
          channelId: 'game-ch',
        },
      ],
      defaultChannel: 'default-ch',
    });

    const result = await resolveNotificationChannel(deps, 'b1', null);

    // Series announce tier precedes the game-announcements tier, so a null-game
    // Untitled series session posts to the series channel, never the bind game's.
    expect(result).toBe('series-ch');
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
