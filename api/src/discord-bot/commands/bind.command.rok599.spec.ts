/**
 * ROK-599: Tests for BindCommand — per-event bind operations.
 * Covers notification channel override, game reassignment, permission checks,
 * and autocomplete for the new 'event' option.
 */
/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BindCommand } from './bind.command';
import { ChannelBindingsService } from '../services/channel-bindings.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { ChannelType } from 'discord.js';
import { APP_EVENT_EVENTS } from '../discord-bot.constants';

describe('BindCommand — ROK-599 event bind', () => {
  let command: BindCommand;
  let eventEmitter: jest.Mocked<EventEmitter2>;

  /**
   * Build a chainable Drizzle select mock.
   * resolvedValues is an array of arrays — each call to the chain
   * resolves the next array in the list.
   */
  const makeSelectChain = (rows: unknown[] = []) => {
    const chain: Record<string, jest.Mock> = {};
    chain.from = jest.fn().mockReturnValue(chain);
    chain.where = jest.fn().mockReturnValue(chain);
    chain.limit = jest.fn().mockResolvedValue(rows);
    chain.leftJoin = jest.fn().mockReturnValue(chain);
    chain.orderBy = jest.fn().mockResolvedValue(rows);
    return chain;
  };

  const makeUpdateChain = () => {
    const chain: Record<string, jest.Mock> = {};
    chain.set = jest.fn().mockReturnValue(chain);
    chain.where = jest.fn().mockResolvedValue(undefined);
    return chain;
  };

  // Default event row returned from DB for event lookup
  const mockEvent = {
    id: 42,
    title: 'Raid Night',
    creatorId: 10,
    gameId: 5,
    recurrenceGroupId: 'rec-uuid-123',
    notificationChannelOverride: null,
    duration: [
      new Date('2026-04-01T20:00:00Z'),
      new Date('2026-04-01T23:00:00Z'),
    ],
  };

  // Default user row: the event creator
  const mockCreatorUser = { id: 10, role: 'member' };
  const mockAdminUser = { id: 99, role: 'admin' };
  const mockOperatorUser = { id: 88, role: 'operator' };

  // Updated event (after save) with joined game
  const mockUpdatedEvent = {
    events: {
      id: 42,
      title: 'Raid Night',
      description: null,
      creatorId: 10,
      gameId: 5,
      recurrenceGroupId: 'rec-uuid-123',
      notificationChannelOverride: 'channel-override-id',
      duration: [
        new Date('2026-04-01T20:00:00Z'),
        new Date('2026-04-01T23:00:00Z'),
      ],
      maxAttendees: null,
      slotConfig: null,
    },
    games: {
      name: 'World of Warcraft',
      coverUrl: 'https://example.com/art.jpg',
    },
  };

  let mockDb: {
    select: jest.Mock;
    update: jest.Mock;
  };

  const buildMockDb = (selectCalls: unknown[][]) => {
    let callIndex = 0;
    const selectFn = jest.fn().mockImplementation(() => {
      const rows = selectCalls[callIndex] ?? [];
      callIndex++;
      return makeSelectChain(rows);
    });
    const updateFn = jest.fn().mockReturnValue(makeUpdateChain());
    return { select: selectFn, update: updateFn };
  };

  /** Build a mock interaction that calls the event bind path */
  const mockEventBindInteraction = (
    overrides: {
      guildId?: string | null;
      discordUserId?: string;
      eventValue?: string | null;
      channelOption?: object | null;
      gameOption?: string | null;
    } = {},
  ) => {
    const {
      guildId = 'guild-123',
      discordUserId = 'discord-user-100',
      eventValue = '42',
      channelOption = null,
      gameOption = null,
    } = overrides;

    return {
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      guildId,
      user: { id: discordUserId },
      channel: {
        id: 'channel-456',
        name: 'general',
        type: ChannelType.GuildText,
      },
      options: {
        getString: jest.fn().mockImplementation((name: string) => {
          if (name === 'event') return eventValue;
          if (name === 'game') return gameOption;
          if (name === 'series') return null;
          return null;
        }),
        getChannel: jest.fn().mockReturnValue(channelOption),
      },
    };
  };

  beforeEach(async () => {
    // Will be overridden per test via mockDb
    mockDb = buildMockDb([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BindCommand,
        {
          provide: ChannelBindingsService,
          useValue: {
            bind: jest
              .fn()
              .mockResolvedValue({ binding: {}, replacedChannelIds: [] }),
            detectBehavior: jest.fn().mockReturnValue('game-announcements'),
          },
        },
        {
          provide: DrizzleAsyncProvider,
          useValue: mockDb,
        },
        {
          provide: EventEmitter2,
          useValue: { emit: jest.fn() },
        },
      ],
    }).compile();

    command = module.get(BindCommand);
    eventEmitter = module.get(EventEmitter2);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================
  // handleEventBind — invalid event ID (NaN)
  // ============================================================
  describe('event option routing', () => {
    it('rejects a non-numeric event ID with a helpful message', async () => {
      mockDb.select = buildMockDb([]).select; // won't be called
      const interaction = mockEventBindInteraction({
        eventValue: 'not-a-number',
      });

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.stringMatching(/invalid event/i),
      );
    });

    it('routes to event bind when event option is provided', async () => {
      // Event not found → early return (tests routing without full setup)
      mockDb.select = jest.fn().mockReturnValue(makeSelectChain([]));
      const interaction = mockEventBindInteraction({ eventValue: '42' });

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      // Should not fall through to regular bind (which calls ChannelBindingsService.bind)
      const channelBindingsService = command[
        'channelBindingsService'
      ] as jest.Mocked<ChannelBindingsService>;
      expect(channelBindingsService.bind).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // handleEventBind — event not found
  // ============================================================
  describe('event not found', () => {
    it('replies with not-found message when event does not exist', async () => {
      mockDb.select = jest.fn().mockReturnValue(makeSelectChain([]));
      const interaction = mockEventBindInteraction();

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.stringMatching(/event not found/i),
      );
    });
  });

  // ============================================================
  // handleEventBind — user not found (no Raid Ledger account)
  // ============================================================
  describe('user not found', () => {
    it('replies with account-required message when Discord user has no Raid Ledger account', async () => {
      // First select: event found; Second select: user not found
      mockDb.select = jest
        .fn()
        .mockReturnValueOnce(makeSelectChain([mockEvent]))
        .mockReturnValueOnce(makeSelectChain([]));

      const interaction = mockEventBindInteraction();

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.stringMatching(/raid ledger account/i),
      );
    });
  });

  // ============================================================
  // Permission checks
  // ============================================================
  describe('permission checks', () => {
    it('rejects non-creator regular user who tries to bind an event they did not create', async () => {
      const nonCreatorUser = { id: 55, role: 'member' }; // not the creator (creatorId=10)
      mockDb.select = jest
        .fn()
        .mockReturnValueOnce(makeSelectChain([mockEvent]))
        .mockReturnValueOnce(makeSelectChain([nonCreatorUser]));

      const interaction = mockEventBindInteraction({
        channelOption: {
          id: 'ch-999',
          name: 'raids',
          type: ChannelType.GuildText,
        },
      });

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.stringMatching(/only modify events you created/i),
      );
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('allows the event creator to bind', async () => {
      mockDb.select = jest
        .fn()
        .mockReturnValueOnce(makeSelectChain([mockEvent])) // event lookup
        .mockReturnValueOnce(makeSelectChain([mockCreatorUser])) // user lookup
        .mockReturnValueOnce(makeSelectChain([mockUpdatedEvent])); // re-fetch after update
      mockDb.update = jest.fn().mockReturnValue(makeUpdateChain());

      const interaction = mockEventBindInteraction({
        channelOption: {
          id: 'ch-999',
          name: 'raids',
          type: ChannelType.GuildText,
        },
      });

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(mockDb.update).toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([expect.anything()]) as unknown,
        }),
      );
    });

    it('allows an admin to bind any event', async () => {
      mockDb.select = jest
        .fn()
        .mockReturnValueOnce(makeSelectChain([mockEvent]))
        .mockReturnValueOnce(makeSelectChain([mockAdminUser]))
        .mockReturnValueOnce(makeSelectChain([mockUpdatedEvent]));
      mockDb.update = jest.fn().mockReturnValue(makeUpdateChain());

      const interaction = mockEventBindInteraction({
        discordUserId: 'admin-discord-id',
        channelOption: {
          id: 'ch-999',
          name: 'raids',
          type: ChannelType.GuildText,
        },
      });

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(mockDb.update).toHaveBeenCalled();
    });

    it('allows an operator to bind any event', async () => {
      mockDb.select = jest
        .fn()
        .mockReturnValueOnce(makeSelectChain([mockEvent]))
        .mockReturnValueOnce(makeSelectChain([mockOperatorUser]))
        .mockReturnValueOnce(makeSelectChain([mockUpdatedEvent]));
      mockDb.update = jest.fn().mockReturnValue(makeUpdateChain());

      const interaction = mockEventBindInteraction({
        discordUserId: 'operator-discord-id',
        channelOption: {
          id: 'ch-999',
          name: 'raids',
          type: ChannelType.GuildText,
        },
      });

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  // ============================================================
  // Validation: must provide channel or game
  // ============================================================
  describe('missing channel and game options', () => {
    it('replies with usage hint when neither channel nor game is provided', async () => {
      mockDb.select = jest
        .fn()
        .mockReturnValueOnce(makeSelectChain([mockEvent]))
        .mockReturnValueOnce(makeSelectChain([mockCreatorUser]));

      const interaction = mockEventBindInteraction({
        channelOption: null,
        gameOption: null,
      });

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.stringMatching(/provide.*channel.*game/i),
      );
      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // Part 1: Notification channel override
  // ============================================================
  describe('notification channel override (AC Part 1)', () => {
    it('updates notificationChannelOverride on the event when channel option is provided', async () => {
      const updateChain = makeUpdateChain();
      mockDb.select = jest
        .fn()
        .mockReturnValueOnce(makeSelectChain([mockEvent]))
        .mockReturnValueOnce(makeSelectChain([mockCreatorUser]))
        .mockReturnValueOnce(makeSelectChain([mockUpdatedEvent]));
      mockDb.update = jest.fn().mockReturnValue(updateChain);

      const channelOption = {
        id: 'override-channel-999',
        name: 'raid-announcements',
        type: ChannelType.GuildText,
      };

      const interaction = mockEventBindInteraction({ channelOption });

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(mockDb.update).toHaveBeenCalled();
      // The set call should include notificationChannelOverride
      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({
          notificationChannelOverride: 'override-channel-999',
        }),
      );
    });

    it('includes the channel name in the success reply', async () => {
      const updateChain = makeUpdateChain();
      mockDb.select = jest
        .fn()
        .mockReturnValueOnce(makeSelectChain([mockEvent]))
        .mockReturnValueOnce(makeSelectChain([mockCreatorUser]))
        .mockReturnValueOnce(makeSelectChain([mockUpdatedEvent]));
      mockDb.update = jest.fn().mockReturnValue(updateChain);

      const channelOption = {
        id: 'override-channel-999',
        name: 'raid-announcements',
        type: ChannelType.GuildText,
      };

      const interaction = mockEventBindInteraction({ channelOption });

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const replyArg = (
        interaction.editReply.mock.calls as unknown[][]
      )[0][0] as {
        embeds: { data: { description: string } }[];
      };
      const description = replyArg.embeds[0].data.description ?? '';
      expect(description).toContain('raid-announcements');
    });

    it('emits event.updated with notificationChannelOverride after channel override', async () => {
      const updatedEventWithOverride = {
        ...mockUpdatedEvent,
        events: {
          ...mockUpdatedEvent.events,
          notificationChannelOverride: 'override-channel-999',
        },
      };
      mockDb.select = jest
        .fn()
        .mockReturnValueOnce(makeSelectChain([mockEvent]))
        .mockReturnValueOnce(makeSelectChain([mockCreatorUser]))
        .mockReturnValueOnce(makeSelectChain([updatedEventWithOverride]));
      mockDb.update = jest.fn().mockReturnValue(makeUpdateChain());

      const channelOption = {
        id: 'override-channel-999',
        name: 'raid-announcements',
        type: ChannelType.GuildText,
      };

      const interaction = mockEventBindInteraction({ channelOption });

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        APP_EVENT_EVENTS.UPDATED,
        expect.objectContaining({
          eventId: 42,
          notificationChannelOverride: 'override-channel-999',
        }),
      );
    });

    it('replies with success embed after channel override', async () => {
      mockDb.select = jest
        .fn()
        .mockReturnValueOnce(makeSelectChain([mockEvent]))
        .mockReturnValueOnce(makeSelectChain([mockCreatorUser]))
        .mockReturnValueOnce(makeSelectChain([mockUpdatedEvent]));
      mockDb.update = jest.fn().mockReturnValue(makeUpdateChain());

      const channelOption = {
        id: 'override-channel-999',
        name: 'raid-announcements',
        type: ChannelType.GuildText,
      };

      const interaction = mockEventBindInteraction({ channelOption });

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([expect.anything()]) as unknown,
        }),
      );
    });
  });

  // ============================================================
  // Part 2: Game reassignment
  // ============================================================
  describe('game reassignment (AC Part 2)', () => {
    it('sets gameId to null when game is "none"', async () => {
      const updateChain = makeUpdateChain();
      mockDb.select = jest
        .fn()
        .mockReturnValueOnce(makeSelectChain([mockEvent]))
        .mockReturnValueOnce(makeSelectChain([mockCreatorUser]))
        .mockReturnValueOnce(
          makeSelectChain([
            {
              ...mockUpdatedEvent,
              events: { ...mockUpdatedEvent.events, gameId: null },
            },
          ]),
        );
      mockDb.update = jest.fn().mockReturnValue(updateChain);

      const interaction = mockEventBindInteraction({ gameOption: 'none' });

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({ gameId: null }),
      );
    });

    it('sets gameId to null when game is "general" (case-insensitive)', async () => {
      const updateChain = makeUpdateChain();
      mockDb.select = jest
        .fn()
        .mockReturnValueOnce(makeSelectChain([mockEvent]))
        .mockReturnValueOnce(makeSelectChain([mockCreatorUser]))
        .mockReturnValueOnce(
          makeSelectChain([
            {
              ...mockUpdatedEvent,
              events: { ...mockUpdatedEvent.events, gameId: null },
            },
          ]),
        );
      mockDb.update = jest.fn().mockReturnValue(updateChain);

      const interaction = mockEventBindInteraction({ gameOption: 'General' });

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({ gameId: null }),
      );
    });

    it('replies with game-removed message when game is set to "none"', async () => {
      const updatedNoGame = {
        events: { ...mockUpdatedEvent.events, gameId: null },
        games: null,
      };
      mockDb.select = jest
        .fn()
        .mockReturnValueOnce(makeSelectChain([mockEvent]))
        .mockReturnValueOnce(makeSelectChain([mockCreatorUser]))
        .mockReturnValueOnce(makeSelectChain([updatedNoGame]));
      mockDb.update = jest.fn().mockReturnValue(makeUpdateChain());

      const interaction = mockEventBindInteraction({ gameOption: 'none' });

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const replyArg = (
        interaction.editReply.mock.calls as unknown[][]
      )[0][0] as {
        embeds: { data: { description: string } }[];
      };
      const description = replyArg.embeds[0].data.description ?? '';
      expect(description.toLowerCase()).toContain('general');
    });

    it('updates gameId when a valid game name is provided', async () => {
      const mockGame = { id: 7, name: 'Final Fantasy XIV' };
      const updateChain = makeUpdateChain();
      mockDb.select = jest
        .fn()
        .mockReturnValueOnce(makeSelectChain([mockEvent])) // event lookup
        .mockReturnValueOnce(makeSelectChain([mockCreatorUser])) // user lookup
        .mockReturnValueOnce(makeSelectChain([mockGame])) // game lookup
        .mockReturnValueOnce(
          makeSelectChain([
            {
              // re-fetch after update
              events: { ...mockUpdatedEvent.events, gameId: 7 },
              games: { name: 'Final Fantasy XIV', coverUrl: null },
            },
          ]),
        );
      mockDb.update = jest.fn().mockReturnValue(updateChain);

      const interaction = mockEventBindInteraction({
        gameOption: 'Final Fantasy XIV',
      });

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({ gameId: 7 }),
      );
    });

    it('replies with game-not-found message when game name does not match', async () => {
      mockDb.select = jest
        .fn()
        .mockReturnValueOnce(makeSelectChain([mockEvent]))
        .mockReturnValueOnce(makeSelectChain([mockCreatorUser]))
        .mockReturnValueOnce(makeSelectChain([])); // game not found

      const interaction = mockEventBindInteraction({
        gameOption: 'Unknown Game XYZ',
      });

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.stringMatching(/not found/i),
      );
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('emits event.updated with new gameId after game reassignment', async () => {
      const mockGame = { id: 7, name: 'Final Fantasy XIV' };
      mockDb.select = jest
        .fn()
        .mockReturnValueOnce(makeSelectChain([mockEvent]))
        .mockReturnValueOnce(makeSelectChain([mockCreatorUser]))
        .mockReturnValueOnce(makeSelectChain([mockGame]))
        .mockReturnValueOnce(
          makeSelectChain([
            {
              events: {
                ...mockUpdatedEvent.events,
                gameId: 7,
                notificationChannelOverride: null,
              },
              games: { name: 'Final Fantasy XIV', coverUrl: null },
            },
          ]),
        );
      mockDb.update = jest.fn().mockReturnValue(makeUpdateChain());

      const interaction = mockEventBindInteraction({
        gameOption: 'Final Fantasy XIV',
      });

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        APP_EVENT_EVENTS.UPDATED,
        expect.objectContaining({
          eventId: 42,
          gameId: 7,
        }),
      );
    });

    it('emits event.updated with null gameId when game removed', async () => {
      const updatedNoGame = {
        events: {
          ...mockUpdatedEvent.events,
          gameId: null,
          notificationChannelOverride: null,
        },
        games: null,
      };
      mockDb.select = jest
        .fn()
        .mockReturnValueOnce(makeSelectChain([mockEvent]))
        .mockReturnValueOnce(makeSelectChain([mockCreatorUser]))
        .mockReturnValueOnce(makeSelectChain([updatedNoGame]));
      mockDb.update = jest.fn().mockReturnValue(makeUpdateChain());

      const interaction = mockEventBindInteraction({ gameOption: 'none' });

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        APP_EVENT_EVENTS.UPDATED,
        expect.objectContaining({
          eventId: 42,
          gameId: null,
        }),
      );
    });

    it('emits null game in event payload when game is removed', async () => {
      const updatedNoGame = {
        events: {
          ...mockUpdatedEvent.events,
          gameId: null,
          notificationChannelOverride: null,
        },
        games: null,
      };
      mockDb.select = jest
        .fn()
        .mockReturnValueOnce(makeSelectChain([mockEvent]))
        .mockReturnValueOnce(makeSelectChain([mockCreatorUser]))
        .mockReturnValueOnce(makeSelectChain([updatedNoGame]));
      mockDb.update = jest.fn().mockReturnValue(makeUpdateChain());

      const interaction = mockEventBindInteraction({ gameOption: 'none' });

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        APP_EVENT_EVENTS.UPDATED,
        expect.objectContaining({
          event: expect.objectContaining({ game: null }) as unknown,
        }),
      );
    });
  });

  // ============================================================
  // Combined: channel override + game reassignment
  // ============================================================
  describe('combined channel override + game reassignment', () => {
    it('applies both channel override and game change when both options are provided', async () => {
      const mockGame = { id: 7, name: 'Final Fantasy XIV' };
      const combinedUpdatedEvent = {
        events: {
          ...mockUpdatedEvent.events,
          gameId: 7,
          notificationChannelOverride: 'override-channel-999',
        },
        games: { name: 'Final Fantasy XIV', coverUrl: null },
      };

      const updateCalls: Array<ReturnType<typeof makeUpdateChain>> = [];
      mockDb.update = jest.fn().mockImplementation(() => {
        const chain = makeUpdateChain();
        updateCalls.push(chain);
        return chain;
      });

      mockDb.select = jest
        .fn()
        .mockReturnValueOnce(makeSelectChain([mockEvent]))
        .mockReturnValueOnce(makeSelectChain([mockCreatorUser]))
        .mockReturnValueOnce(makeSelectChain([mockGame]))
        .mockReturnValueOnce(makeSelectChain([combinedUpdatedEvent]));

      const channelOption = {
        id: 'override-channel-999',
        name: 'raid-announcements',
        type: ChannelType.GuildText,
      };

      const interaction = mockEventBindInteraction({
        channelOption,
        gameOption: 'Final Fantasy XIV',
      });

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      // Two updates should happen: channel override + game reassignment
      expect(mockDb.update).toHaveBeenCalledTimes(2);

      // The emitted event should carry both changes
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        APP_EVENT_EVENTS.UPDATED,
        expect.objectContaining({
          gameId: 7,
          notificationChannelOverride: 'override-channel-999',
        }),
      );
    });

    it('includes both changes in the reply embed description', async () => {
      const mockGame = { id: 7, name: 'Final Fantasy XIV' };
      const combinedUpdatedEvent = {
        events: {
          ...mockUpdatedEvent.events,
          gameId: 7,
          notificationChannelOverride: 'override-channel-999',
        },
        games: { name: 'Final Fantasy XIV', coverUrl: null },
      };

      mockDb.update = jest.fn().mockReturnValue(makeUpdateChain());
      mockDb.select = jest
        .fn()
        .mockReturnValueOnce(makeSelectChain([mockEvent]))
        .mockReturnValueOnce(makeSelectChain([mockCreatorUser]))
        .mockReturnValueOnce(makeSelectChain([mockGame]))
        .mockReturnValueOnce(makeSelectChain([combinedUpdatedEvent]));

      const channelOption = {
        id: 'override-channel-999',
        name: 'raid-announcements',
        type: ChannelType.GuildText,
      };

      const interaction = mockEventBindInteraction({
        channelOption,
        gameOption: 'Final Fantasy XIV',
      });

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const replyArg = (
        interaction.editReply.mock.calls as unknown[][]
      )[0][0] as {
        embeds: { data: { description: string } }[];
      };
      const description = replyArg.embeds[0].data.description ?? '';
      expect(description).toContain('raid-announcements');
      expect(description).toContain('Final Fantasy XIV');
    });
  });

  // ============================================================
  // DM rejection (guild guard)
  // ============================================================
  describe('guild guard', () => {
    it('rejects event bind when used outside a guild (DM context)', async () => {
      const interaction = mockEventBindInteraction({ guildId: null });

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(interaction.editReply).toHaveBeenCalledWith(
        'This command can only be used in a server.',
      );
    });
  });

  // ============================================================
  // getDefinition includes event option
  // ============================================================
  describe('getDefinition', () => {
    it('includes an "event" option in the command definition', () => {
      const definition = command.getDefinition();
      const options = definition.options as
        | Array<{ name: string; autocomplete?: boolean }>
        | undefined;
      const eventOption = options?.find((o) => o.name === 'event');
      expect(eventOption).toBeDefined();
      expect(eventOption?.autocomplete).toBe(true);
    });
  });

  // ============================================================
  // handleAutocomplete — event option
  // ============================================================
  describe('handleAutocomplete — event option', () => {
    const makeAutocompleteInteraction = (
      overrides: {
        focusedName?: string;
        focusedValue?: string;
        discordUserId?: string;
      } = {},
    ) => {
      const {
        focusedName = 'event',
        focusedValue = '',
        discordUserId = 'discord-user-100',
      } = overrides;

      return {
        options: {
          getFocused: jest
            .fn()
            .mockReturnValue({ name: focusedName, value: focusedValue }),
        },
        user: { id: discordUserId },
        respond: jest.fn().mockResolvedValue(undefined),
      };
    };

    /** Build a chain for the events autocomplete query: .from().where().orderBy().limit() */
    const makeEventsAutocompleteChain = (rows: unknown[]) => ({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          orderBy: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue(rows),
          }),
        }),
      }),
    });

    it('responds with upcoming events for admin user (no creator filter)', async () => {
      const mockEvents = [
        {
          id: 1,
          title: 'Raid Alpha',
          duration: [
            new Date('2026-04-01T20:00:00Z'),
            new Date('2026-04-01T23:00:00Z'),
          ],
        },
        {
          id: 2,
          title: 'Raid Beta',
          duration: [
            new Date('2026-04-08T20:00:00Z'),
            new Date('2026-04-08T23:00:00Z'),
          ],
        },
      ];

      mockDb.select = jest
        .fn()
        .mockReturnValueOnce(makeSelectChain([mockAdminUser]))
        .mockReturnValueOnce(makeEventsAutocompleteChain(mockEvents));

      const interaction = makeAutocompleteInteraction({
        discordUserId: 'admin-discord-id',
      });

      await command.handleAutocomplete(
        interaction as unknown as Parameters<
          typeof command.handleAutocomplete
        >[0],
      );

      expect(interaction.respond).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            name: expect.stringContaining('Raid Alpha') as unknown,
            value: '1',
          }),
        ]),
      );
    });

    it('responds with only own events for non-admin user', async () => {
      const regularUser = { id: 10, role: 'member' };
      const ownEvents = [
        {
          id: 42,
          title: 'My Event',
          duration: [
            new Date('2026-04-01T20:00:00Z'),
            new Date('2026-04-01T23:00:00Z'),
          ],
        },
      ];

      mockDb.select = jest
        .fn()
        .mockReturnValueOnce(makeSelectChain([regularUser]))
        .mockReturnValueOnce(makeEventsAutocompleteChain(ownEvents));

      const interaction = makeAutocompleteInteraction({
        discordUserId: 'member-discord-id',
      });

      await command.handleAutocomplete(
        interaction as unknown as Parameters<
          typeof command.handleAutocomplete
        >[0],
      );

      expect(interaction.respond).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ value: '42' })]),
      );
    });

    it('formats autocomplete result as "Title (Month Day)"', async () => {
      const mockEvents = [
        {
          id: 42,
          title: 'Summer Raid',
          duration: [
            new Date('2026-06-15T20:00:00Z'),
            new Date('2026-06-15T23:00:00Z'),
          ],
        },
      ];

      mockDb.select = jest
        .fn()
        .mockReturnValueOnce(makeSelectChain([mockAdminUser]))
        .mockReturnValueOnce(makeEventsAutocompleteChain(mockEvents));

      const interaction = makeAutocompleteInteraction();

      await command.handleAutocomplete(
        interaction as unknown as Parameters<
          typeof command.handleAutocomplete
        >[0],
      );

      const respondArg = (
        interaction.respond.mock.calls as unknown[][]
      )[0][0] as Array<{
        name: string;
        value: string;
      }>;
      expect(respondArg[0].name).toMatch(/Summer Raid/);
      expect(respondArg[0].name).toMatch(/Jun.*15|June.*15/i);
      expect(respondArg[0].value).toBe('42');
    });

    it('responds with empty array when user has no accessible events', async () => {
      mockDb.select = jest
        .fn()
        .mockReturnValueOnce(makeSelectChain([mockCreatorUser]))
        .mockReturnValueOnce(makeEventsAutocompleteChain([]));

      const interaction = makeAutocompleteInteraction();

      await command.handleAutocomplete(
        interaction as unknown as Parameters<
          typeof command.handleAutocomplete
        >[0],
      );

      expect(interaction.respond).toHaveBeenCalledWith([]);
    });
  });
});
