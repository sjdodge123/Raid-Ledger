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

describe('BindCommand — ROK-599 event bind — routing', () => {
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
        .mockReturnValueOnce(makeSelectChain([mockUpdatedEvent])) // re-fetch after update
        .mockReturnValueOnce(makeCountSelectChain([{ count: 3 }])); // signup count
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
        .mockReturnValueOnce(makeSelectChain([mockUpdatedEvent]))
        .mockReturnValueOnce(makeCountSelectChain([{ count: 0 }]));
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
        .mockReturnValueOnce(makeSelectChain([mockUpdatedEvent]))
        .mockReturnValueOnce(makeCountSelectChain([{ count: 0 }]));
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
});
