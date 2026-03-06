/**
 * ROK-599: Tests for UnbindCommand — clearing the per-event notification channel override.
 * Covers the handleEventUnbind path: event lookup, permission checks,
 * clearing the override, emitting event.updated, and autocomplete.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UnbindCommand } from './unbind.command';
import { ChannelBindingsService } from '../services/channel-bindings.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { ChannelType } from 'discord.js';
import { APP_EVENT_EVENTS } from '../discord-bot.constants';

describe('UnbindCommand — ROK-599 event unbind', () => {
  let command: UnbindCommand;
  let eventEmitter: jest.Mocked<EventEmitter2>;

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

  // Event that has an override set
  const mockEventWithOverride = {
    id: 42,
    title: 'Raid Night',
    creatorId: 10,
    gameId: 5,
    recurrenceGroupId: 'rec-uuid-123',
    notificationChannelOverride: 'override-channel-id',
    duration: [
      new Date('2026-04-01T20:00:00Z'),
      new Date('2026-04-01T23:00:00Z'),
    ],
  };

  // Event with no override
  const mockEventWithoutOverride = {
    ...mockEventWithOverride,
    notificationChannelOverride: null,
  };

  const mockCreatorUser = { id: 10, role: 'member' };
  const mockAdminUser = { id: 99, role: 'admin' };
  const mockOperatorUser = { id: 88, role: 'operator' };
  const mockOtherUser = { id: 55, role: 'member' };

  // Re-fetched event (after clearing override)
  const mockUpdatedEvent = {
    events: {
      id: 42,
      title: 'Raid Night',
      description: null,
      gameId: 5,
      recurrenceGroupId: 'rec-uuid-123',
      notificationChannelOverride: null,
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

  /** Build a mock interaction for the event unbind path */
  const mockEventUnbindInteraction = (
    overrides: {
      guildId?: string | null;
      discordUserId?: string;
      eventValue?: string | null;
    } = {},
  ) => {
    const {
      guildId = 'guild-123',
      discordUserId = 'discord-user-100',
      eventValue = '42',
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
          if (name === 'series') return null;
          return null;
        }),
        getChannel: jest.fn().mockReturnValue(null),
      },
    };
  };

  beforeEach(async () => {
    mockDb = {
      select: jest.fn(),
      update: jest.fn().mockReturnValue(makeUpdateChain()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UnbindCommand,
        {
          provide: ChannelBindingsService,
          useValue: {
            unbind: jest.fn().mockResolvedValue(true),
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

    command = module.get(UnbindCommand);
    eventEmitter = module.get(EventEmitter2);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================
  // Guild guard
  // ============================================================
  describe('guild guard', () => {
    it('rejects event unbind when used outside a guild', async () => {
      const interaction = mockEventUnbindInteraction({ guildId: null });

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
  // Invalid event ID
  // ============================================================
  describe('invalid event ID', () => {
    it('rejects a non-numeric event ID', async () => {
      const interaction = mockEventUnbindInteraction({
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
      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // Event not found
  // ============================================================
  describe('event not found', () => {
    it('replies with not-found message when event does not exist in DB', async () => {
      mockDb.select = jest.fn().mockReturnValue(makeSelectChain([]));
      const interaction = mockEventUnbindInteraction();

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.stringMatching(/event not found/i),
      );
      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // User not found
  // ============================================================
  describe('user not found', () => {
    it('replies with account-required message when Discord user has no Raid Ledger account', async () => {
      mockDb.select = jest
        .fn()
        .mockReturnValueOnce(makeSelectChain([mockEventWithOverride]))
        .mockReturnValueOnce(makeSelectChain([]));

      const interaction = mockEventUnbindInteraction();

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
    it('rejects non-creator member who did not create the event', async () => {
      mockDb.select = jest
        .fn()
        .mockReturnValueOnce(makeSelectChain([mockEventWithOverride]))
        .mockReturnValueOnce(makeSelectChain([mockOtherUser]));

      const interaction = mockEventUnbindInteraction({
        discordUserId: 'other-user-discord',
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

    it('allows the event creator to clear the override', async () => {
      mockDb.select = jest
        .fn()
        .mockReturnValueOnce(makeSelectChain([mockEventWithOverride]))
        .mockReturnValueOnce(makeSelectChain([mockCreatorUser]))
        .mockReturnValueOnce(makeSelectChain([mockUpdatedEvent]));
      mockDb.update = jest.fn().mockReturnValue(makeUpdateChain());

      const interaction = mockEventUnbindInteraction();

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(mockDb.update).toHaveBeenCalled();
    });

    it('allows an admin to clear the override on any event', async () => {
      mockDb.select = jest
        .fn()
        .mockReturnValueOnce(makeSelectChain([mockEventWithOverride]))
        .mockReturnValueOnce(makeSelectChain([mockAdminUser]))
        .mockReturnValueOnce(makeSelectChain([mockUpdatedEvent]));
      mockDb.update = jest.fn().mockReturnValue(makeUpdateChain());

      const interaction = mockEventUnbindInteraction({
        discordUserId: 'admin-discord-id',
      });

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(mockDb.update).toHaveBeenCalled();
    });

    it('allows an operator to clear the override on any event', async () => {
      mockDb.select = jest
        .fn()
        .mockReturnValueOnce(makeSelectChain([mockEventWithOverride]))
        .mockReturnValueOnce(makeSelectChain([mockOperatorUser]))
        .mockReturnValueOnce(makeSelectChain([mockUpdatedEvent]));
      mockDb.update = jest.fn().mockReturnValue(makeUpdateChain());

      const interaction = mockEventUnbindInteraction({
        discordUserId: 'operator-discord-id',
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
  // No override to clear
  // ============================================================
  describe('no override present', () => {
    it('replies with "no override to clear" message when event has no override', async () => {
      mockDb.select = jest
        .fn()
        .mockReturnValueOnce(makeSelectChain([mockEventWithoutOverride]))
        .mockReturnValueOnce(makeSelectChain([mockCreatorUser]));

      const interaction = mockEventUnbindInteraction();

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.stringMatching(/no notification channel override/i),
      );
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('includes the event title in the "no override" message', async () => {
      mockDb.select = jest
        .fn()
        .mockReturnValueOnce(makeSelectChain([mockEventWithoutOverride]))
        .mockReturnValueOnce(makeSelectChain([mockCreatorUser]));

      const interaction = mockEventUnbindInteraction();

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const replyArg = (
        interaction.editReply.mock.calls as unknown[][]
      )[0][0] as string;
      expect(replyArg).toContain('Raid Night');
    });
  });

  // ============================================================
  // Clearing the override
  // ============================================================
  describe('clearing the override', () => {
    it('sets notificationChannelOverride to null in the DB', async () => {
      const updateChain = makeUpdateChain();
      mockDb.select = jest
        .fn()
        .mockReturnValueOnce(makeSelectChain([mockEventWithOverride]))
        .mockReturnValueOnce(makeSelectChain([mockCreatorUser]))
        .mockReturnValueOnce(makeSelectChain([mockUpdatedEvent]));
      mockDb.update = jest.fn().mockReturnValue(updateChain);

      const interaction = mockEventUnbindInteraction();

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({ notificationChannelOverride: null }),
      );
    });

    it('emits event.updated with null notificationChannelOverride after clearing', async () => {
      mockDb.select = jest
        .fn()
        .mockReturnValueOnce(makeSelectChain([mockEventWithOverride]))
        .mockReturnValueOnce(makeSelectChain([mockCreatorUser]))
        .mockReturnValueOnce(makeSelectChain([mockUpdatedEvent]));
      mockDb.update = jest.fn().mockReturnValue(makeUpdateChain());

      const interaction = mockEventUnbindInteraction();

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        APP_EVENT_EVENTS.UPDATED,
        expect.objectContaining({
          eventId: 42,
          notificationChannelOverride: null,
        }),
      );
    });

    it('emits event.updated with the event game data intact', async () => {
      mockDb.select = jest
        .fn()
        .mockReturnValueOnce(makeSelectChain([mockEventWithOverride]))
        .mockReturnValueOnce(makeSelectChain([mockCreatorUser]))
        .mockReturnValueOnce(makeSelectChain([mockUpdatedEvent]));
      mockDb.update = jest.fn().mockReturnValue(makeUpdateChain());

      const interaction = mockEventUnbindInteraction();

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        APP_EVENT_EVENTS.UPDATED,
        expect.objectContaining({
          event: expect.objectContaining({
            game: expect.objectContaining({
              name: 'World of Warcraft',
            }) as unknown,
          }) as unknown,
        }),
      );
    });

    it('emits event.updated with the recurrenceGroupId intact', async () => {
      mockDb.select = jest
        .fn()
        .mockReturnValueOnce(makeSelectChain([mockEventWithOverride]))
        .mockReturnValueOnce(makeSelectChain([mockCreatorUser]))
        .mockReturnValueOnce(makeSelectChain([mockUpdatedEvent]));
      mockDb.update = jest.fn().mockReturnValue(makeUpdateChain());

      const interaction = mockEventUnbindInteraction();

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        APP_EVENT_EVENTS.UPDATED,
        expect.objectContaining({
          recurrenceGroupId: 'rec-uuid-123',
        }),
      );
    });

    it('replies with a success embed after clearing the override', async () => {
      mockDb.select = jest
        .fn()
        .mockReturnValueOnce(makeSelectChain([mockEventWithOverride]))
        .mockReturnValueOnce(makeSelectChain([mockCreatorUser]))
        .mockReturnValueOnce(makeSelectChain([mockUpdatedEvent]));
      mockDb.update = jest.fn().mockReturnValue(makeUpdateChain());

      const interaction = mockEventUnbindInteraction();

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

    it('includes the event title in the success reply', async () => {
      mockDb.select = jest
        .fn()
        .mockReturnValueOnce(makeSelectChain([mockEventWithOverride]))
        .mockReturnValueOnce(makeSelectChain([mockCreatorUser]))
        .mockReturnValueOnce(makeSelectChain([mockUpdatedEvent]));
      mockDb.update = jest.fn().mockReturnValue(makeUpdateChain());

      const interaction = mockEventUnbindInteraction();

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
      expect(description).toContain('Raid Night');
    });

    it('mentions fallback to default channel resolution in success message', async () => {
      mockDb.select = jest
        .fn()
        .mockReturnValueOnce(makeSelectChain([mockEventWithOverride]))
        .mockReturnValueOnce(makeSelectChain([mockCreatorUser]))
        .mockReturnValueOnce(makeSelectChain([mockUpdatedEvent]));
      mockDb.update = jest.fn().mockReturnValue(makeUpdateChain());

      const interaction = mockEventUnbindInteraction();

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
      expect(description.toLowerCase()).toContain('default');
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

    it('has description that mentions "override"', () => {
      const definition = command.getDefinition();
      const options = definition.options as
        | Array<{ name: string; description: string }>
        | undefined;
      const eventOption = options?.find((o) => o.name === 'event');
      expect(eventOption?.description.toLowerCase()).toContain('override');
    });
  });

  // ============================================================
  // Routing: event option takes priority over channel option
  // ============================================================
  describe('routing precedence', () => {
    it('routes to event unbind (not channel unbind) when event option is provided', async () => {
      // Event not found → returns early without calling channelBindingsService.unbind
      mockDb.select = jest.fn().mockReturnValue(makeSelectChain([]));

      const interaction = mockEventUnbindInteraction({ eventValue: '99' });

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const channelBindingsService = command[
        'channelBindingsService'
      ] as jest.Mocked<ChannelBindingsService>;
      expect(channelBindingsService.unbind).not.toHaveBeenCalled();
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

    it('responds with upcoming events the user can manage', async () => {
      const mockEvents = [
        {
          id: 42,
          title: 'Raid Night',
          duration: [
            new Date('2026-04-01T20:00:00Z'),
            new Date('2026-04-01T23:00:00Z'),
          ],
        },
      ];

      mockDb.select = jest
        .fn()
        .mockReturnValueOnce(makeSelectChain([mockCreatorUser]))
        .mockReturnValueOnce(makeEventsAutocompleteChain(mockEvents));

      const interaction = makeAutocompleteInteraction();

      await command.handleAutocomplete(
        interaction as unknown as Parameters<
          typeof command.handleAutocomplete
        >[0],
      );

      expect(interaction.respond).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            name: expect.stringContaining('Raid Night') as unknown,
            value: '42',
          }),
        ]),
      );
    });

    it('admin sees all upcoming events (no creator filter)', async () => {
      const mockEvents = [
        {
          id: 1,
          title: 'Event One',
          duration: [
            new Date('2026-04-01T20:00:00Z'),
            new Date('2026-04-01T23:00:00Z'),
          ],
        },
        {
          id: 2,
          title: 'Event Two',
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

      const respondArg = (
        interaction.respond.mock.calls as unknown[][]
      )[0][0] as unknown[];
      expect(respondArg).toHaveLength(2);
    });

    it('responds with empty array when no events are available', async () => {
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
