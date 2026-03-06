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

describe('BindCommand — ROK-599 event bind — misc', () => {
  let command: BindCommand;

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

  // Default user row: the event creator
  const mockCreatorUser = { id: 10, role: 'member' };
  const mockAdminUser = { id: 99, role: 'admin' };

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
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================
  // handleEventBind — invalid event ID (NaN)
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
