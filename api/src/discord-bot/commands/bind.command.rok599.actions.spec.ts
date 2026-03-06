/**
 * ROK-599: Tests for BindCommand — per-event bind operations.
 * Covers notification channel override, game reassignment, permission checks,
 * and autocomplete for the new 'event' option.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BindCommand } from './bind.command';
import { ChannelBindingsService } from '../services/channel-bindings.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { ChannelType } from 'discord.js';
import { APP_EVENT_EVENTS } from '../discord-bot.constants';

describe('BindCommand — ROK-599 event bind — actions', () => {
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

  /** Select chain that resolves at .where() (no .limit()) — for count queries. */
  const makeCountSelectChain = (rows: unknown[] = []) => {
    const chain: Record<string, jest.Mock> = {};
    chain.from = jest.fn().mockReturnValue(chain);
    chain.where = jest.fn().mockResolvedValue(rows);
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
  describe('notification channel override (AC Part 1)', () => {
    it('updates notificationChannelOverride on the event when channel option is provided', async () => {
      const updateChain = makeUpdateChain();
      mockDb.select = jest
        .fn()
        .mockReturnValueOnce(makeSelectChain([mockEvent]))
        .mockReturnValueOnce(makeSelectChain([mockCreatorUser]))
        .mockReturnValueOnce(makeSelectChain([mockUpdatedEvent]))
        .mockReturnValueOnce(makeCountSelectChain([{ count: 3 }]));
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
        .mockReturnValueOnce(makeSelectChain([mockUpdatedEvent]))
        .mockReturnValueOnce(makeCountSelectChain([{ count: 0 }]));
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
        .mockReturnValueOnce(makeSelectChain([updatedEventWithOverride]))
        .mockReturnValueOnce(makeCountSelectChain([{ count: 5 }]));
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
        .mockReturnValueOnce(makeSelectChain([mockUpdatedEvent]))
        .mockReturnValueOnce(makeCountSelectChain([{ count: 0 }]));
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
        )
        .mockReturnValueOnce(makeCountSelectChain([{ count: 0 }]));
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
        )
        .mockReturnValueOnce(makeCountSelectChain([{ count: 0 }]));
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
        .mockReturnValueOnce(makeSelectChain([updatedNoGame]))
        .mockReturnValueOnce(makeCountSelectChain([{ count: 0 }]));
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
        )
        .mockReturnValueOnce(makeCountSelectChain([{ count: 2 }])); // signup count
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
        )
        .mockReturnValueOnce(makeCountSelectChain([{ count: 4 }]));
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
        .mockReturnValueOnce(makeSelectChain([updatedNoGame]))
        .mockReturnValueOnce(makeCountSelectChain([{ count: 0 }]));
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
        .mockReturnValueOnce(makeSelectChain([updatedNoGame]))
        .mockReturnValueOnce(makeCountSelectChain([{ count: 0 }]));
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
        .mockReturnValueOnce(makeSelectChain([combinedUpdatedEvent]))
        .mockReturnValueOnce(makeCountSelectChain([{ count: 3 }]));

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
        .mockReturnValueOnce(makeSelectChain([combinedUpdatedEvent]))
        .mockReturnValueOnce(makeCountSelectChain([{ count: 1 }]));

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
});
