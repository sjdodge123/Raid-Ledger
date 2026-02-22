/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { ComponentType } from 'discord.js';
import { EventsListCommand } from './events-list.command';
import { EventsService } from '../../events/events.service';
import { UsersService } from '../../users/users.service';
import { MagicLinkService } from '../../auth/magic-link.service';
import { EMBED_COLORS } from '../discord-bot.constants';

describe('EventsListCommand', () => {
  let module: TestingModule;
  let command: EventsListCommand;
  let eventsService: jest.Mocked<EventsService>;
  let usersService: jest.Mocked<UsersService>;
  let magicLinkService: jest.Mocked<MagicLinkService>;

  const originalClientUrl = process.env.CLIENT_URL;

  const mockCollector = {
    on: jest.fn().mockReturnThis(),
  };

  const mockReplyMessage = {
    createMessageComponentCollector: jest.fn().mockReturnValue(mockCollector),
  };

  const mockInteraction = () => ({
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(mockReplyMessage),
    user: { id: '123456' },
  });

  const makeEvent = (overrides = {}) => ({
    id: 1,
    title: 'Test Raid',
    startTime: '2030-12-25T20:00:00.000Z',
    endTime: '2030-12-25T22:00:00.000Z',
    signupCount: 5,
    maxAttendees: 20,
    game: { name: 'WoW', coverUrl: null },
    ...overrides,
  });

  beforeEach(async () => {
    delete process.env.CLIENT_URL;

    const module_: TestingModule = await Test.createTestingModule({
      providers: [
        EventsListCommand,
        {
          provide: EventsService,
          useValue: {
            findAll: jest.fn(),
            findOne: jest.fn(),
          },
        },
        {
          provide: UsersService,
          useValue: {
            findByDiscordId: jest.fn(),
          },
        },
        {
          provide: MagicLinkService,
          useValue: {
            generateLink: jest.fn(),
          },
        },
      ],
    }).compile();

    module = module_;
    command = module.get(EventsListCommand);
    eventsService = module.get(EventsService);
    usersService = module.get(UsersService);
    magicLinkService = module.get(MagicLinkService);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();

    if (originalClientUrl !== undefined) {
      process.env.CLIENT_URL = originalClientUrl;
    } else {
      delete process.env.CLIENT_URL;
    }
  });

  describe('getDefinition', () => {
    it('should return a command definition named "events"', () => {
      const definition = command.getDefinition();
      expect(definition.name).toBe('events');
    });

    it('should have a description', () => {
      const definition = command.getDefinition();
      expect(definition.description).toBeTruthy();
    });
  });

  describe('handleInteraction', () => {
    it('should defer reply as ephemeral', async () => {
      const interaction = mockInteraction();
      eventsService.findAll.mockResolvedValue({
        data: [makeEvent()],
        meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
      } as unknown as Awaited<ReturnType<EventsService['findAll']>>);

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    });

    it('should reply with no events message when list is empty', async () => {
      const interaction = mockInteraction();
      eventsService.findAll.mockResolvedValue({
        data: [],
        meta: { total: 0, page: 1, limit: 10, totalPages: 0 },
      } as unknown as Awaited<ReturnType<EventsService['findAll']>>);

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(interaction.editReply).toHaveBeenCalledWith(
        'No upcoming events found.',
      );
    });

    it('should call findAll with upcoming filter and limit 10', async () => {
      const interaction = mockInteraction();
      eventsService.findAll.mockResolvedValue({
        data: [makeEvent()],
        meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
      } as unknown as Awaited<ReturnType<EventsService['findAll']>>);

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(eventsService.findAll).toHaveBeenCalledWith({
        upcoming: 'true',
        limit: 10,
        page: 1,
      });
    });

    it('should build an embed with event details', async () => {
      const interaction = mockInteraction();
      eventsService.findAll.mockResolvedValue({
        data: [makeEvent()],
        meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
      } as unknown as Awaited<ReturnType<EventsService['findAll']>>);

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

    it('should use announcement color for the embed', async () => {
      const interaction = mockInteraction();
      eventsService.findAll.mockResolvedValue({
        data: [makeEvent()],
        meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
      } as unknown as Awaited<ReturnType<EventsService['findAll']>>);

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
        embeds: { data: { color?: number } }[];
      };
      expect(call.embeds[0].data.color).toBe(EMBED_COLORS.ANNOUNCEMENT);
    });

    it('should display "No game" when event has no game', async () => {
      const interaction = mockInteraction();
      eventsService.findAll.mockResolvedValue({
        data: [makeEvent({ game: null })],
        meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
      } as unknown as Awaited<ReturnType<EventsService['findAll']>>);

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
        embeds: { data: { description?: string } }[];
      };
      expect(call.embeds[0].data.description).toContain('No game');
    });

    it('should show roster as "N/max" when maxAttendees is set', async () => {
      const interaction = mockInteraction();
      eventsService.findAll.mockResolvedValue({
        data: [makeEvent({ signupCount: 5, maxAttendees: 20 })],
        meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
      } as unknown as Awaited<ReturnType<EventsService['findAll']>>);

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
        embeds: { data: { description?: string } }[];
      };
      expect(call.embeds[0].data.description).toContain('5/20');
    });

    it('should show roster as "N signed up" when maxAttendees is null', async () => {
      const interaction = mockInteraction();
      eventsService.findAll.mockResolvedValue({
        data: [makeEvent({ signupCount: 3, maxAttendees: null })],
        meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
      } as unknown as Awaited<ReturnType<EventsService['findAll']>>);

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
        embeds: { data: { description?: string } }[];
      };
      expect(call.embeds[0].data.description).toContain('3 signed up');
    });

    it('should include select menu and button when CLIENT_URL is set', async () => {
      process.env.CLIENT_URL = 'https://raidledger.com';
      const interaction = mockInteraction();
      eventsService.findAll.mockResolvedValue({
        data: [makeEvent()],
        meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
      } as unknown as Awaited<ReturnType<EventsService['findAll']>>);

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
        components: unknown[];
      };
      // Select menu row + View All button row
      expect(call.components.length).toBe(2);
    });

    it('should include only select menu when CLIENT_URL is not set', async () => {
      delete process.env.CLIENT_URL;
      const interaction = mockInteraction();
      eventsService.findAll.mockResolvedValue({
        data: [makeEvent()],
        meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
      } as unknown as Awaited<ReturnType<EventsService['findAll']>>);

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
        components: unknown[];
      };
      // Only the select menu row
      expect(call.components).toHaveLength(1);
    });

    it('should include total count in the footer', async () => {
      const interaction = mockInteraction();
      eventsService.findAll.mockResolvedValue({
        data: [makeEvent(), makeEvent({ id: 2, title: 'Event 2' })],
        meta: { total: 10, page: 1, limit: 10, totalPages: 2 },
      } as unknown as Awaited<ReturnType<EventsService['findAll']>>);

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
        embeds: { data: { footer?: { text: string } } }[];
      };
      expect(call.embeds[0].data.footer?.text).toContain('10');
    });

    it('should handle service errors gracefully', async () => {
      const interaction = mockInteraction();
      eventsService.findAll.mockRejectedValue(new Error('Database error'));

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(interaction.editReply).toHaveBeenCalledWith(
        'Failed to fetch upcoming events. Please try again later.',
      );
    });

    it('should attach a component collector on the reply message', async () => {
      const interaction = mockInteraction();
      eventsService.findAll.mockResolvedValue({
        data: [makeEvent()],
        meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
      } as unknown as Awaited<ReturnType<EventsService['findAll']>>);

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(
        mockReplyMessage.createMessageComponentCollector,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          time: 5 * 60 * 1000,
        }),
      );
    });
  });

  // ============================================================
  // Collector timeout and cleanup
  // ============================================================

  describe('collector timeout cleanup', () => {
    it('should remove components from reply when collector ends (timeout)', async () => {
      let endHandler: (() => void) | undefined;
      const collectorWithEnd = {
        on: jest.fn().mockImplementation((event: string, handler: () => void) => {
          if (event === 'end') endHandler = handler;
          return collectorWithEnd;
        }),
      };
      const replyWithCollector = {
        createMessageComponentCollector: jest
          .fn()
          .mockReturnValue(collectorWithEnd),
      };
      const interaction = {
        deferReply: jest.fn().mockResolvedValue(undefined),
        editReply: jest.fn().mockResolvedValue(replyWithCollector),
        user: { id: '999' },
      };

      eventsService.findAll.mockResolvedValue({
        data: [makeEvent()],
        meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
      } as unknown as Awaited<ReturnType<EventsService['findAll']>>);

      await command.handleInteraction(
        interaction as unknown as Parameters<typeof command.handleInteraction>[0],
      );

      expect(endHandler).toBeDefined();

      // Simulate timeout firing
      endHandler!();

      // editReply should be called again with empty components
      expect(interaction.editReply).toHaveBeenLastCalledWith({ components: [] });
    });

    it('should register both collect and end handlers on the collector', async () => {
      const registeredEvents: string[] = [];
      const collectorCapture = {
        on: jest.fn().mockImplementation((event: string) => {
          registeredEvents.push(event);
          return collectorCapture;
        }),
      };
      const replyCapture = {
        createMessageComponentCollector: jest
          .fn()
          .mockReturnValue(collectorCapture),
      };
      const interaction = {
        deferReply: jest.fn().mockResolvedValue(undefined),
        editReply: jest.fn().mockResolvedValue(replyCapture),
        user: { id: '999' },
      };

      eventsService.findAll.mockResolvedValue({
        data: [makeEvent()],
        meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
      } as unknown as Awaited<ReturnType<EventsService['findAll']>>);

      await command.handleInteraction(
        interaction as unknown as Parameters<typeof command.handleInteraction>[0],
      );

      expect(registeredEvents).toContain('collect');
      expect(registeredEvents).toContain('end');
    });

    it('should filter collector to only handle interactions from the original user', async () => {
      let capturedFilter: ((i: { user: { id: string } }) => boolean) | undefined;
      const collectorFilter = {
        on: jest.fn().mockReturnThis(),
      };
      const replyFilter = {
        createMessageComponentCollector: jest
          .fn()
          .mockImplementation((opts: { filter?: (i: { user: { id: string } }) => boolean }) => {
            capturedFilter = opts.filter;
            return collectorFilter;
          }),
      };
      const interaction = {
        deferReply: jest.fn().mockResolvedValue(undefined),
        editReply: jest.fn().mockResolvedValue(replyFilter),
        user: { id: 'original-user-id' },
      };

      eventsService.findAll.mockResolvedValue({
        data: [makeEvent()],
        meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
      } as unknown as Awaited<ReturnType<EventsService['findAll']>>);

      await command.handleInteraction(
        interaction as unknown as Parameters<typeof command.handleInteraction>[0],
      );

      expect(capturedFilter).toBeDefined();
      // Filter allows original user
      expect(capturedFilter!({ user: { id: 'original-user-id' } })).toBe(true);
      // Filter blocks a different user
      expect(capturedFilter!({ user: { id: 'intruder-user-id' } })).toBe(false);
    });
  });

  // ============================================================
  // Detail embed: buildDetailView via handleEventSelect
  // ============================================================

  describe('detail embed via event select interaction', () => {
    /**
     * Helper that simulates the collector's 'collect' handler receiving a
     * StringSelectMenu interaction. It wires up the full handleInteraction
     * flow, captures the collect handler, then calls it directly.
     */
    async function triggerEventSelect(
      selectedEventId: number,
      discordUserId: string,
      cachedEvents: ReturnType<typeof makeEvent>[],
    ) {
      let collectHandler:
        | ((i: Record<string, unknown>) => void)
        | undefined;

      const collectorSpy = {
        on: jest
          .fn()
          .mockImplementation((event: string, handler: (i: Record<string, unknown>) => void) => {
            if (event === 'collect') collectHandler = handler;
            return collectorSpy;
          }),
      };

      const updateMock = jest.fn().mockResolvedValue(undefined);
      const replyMsg = {
        createMessageComponentCollector: jest
          .fn()
          .mockReturnValue(collectorSpy),
      };
      const interaction = {
        deferReply: jest.fn().mockResolvedValue(undefined),
        editReply: jest.fn().mockResolvedValue(replyMsg),
        user: { id: discordUserId },
      };

      eventsService.findAll.mockResolvedValue({
        data: cachedEvents,
        meta: { total: cachedEvents.length, page: 1, limit: 10, totalPages: 1 },
      } as unknown as Awaited<ReturnType<EventsService['findAll']>>);

      await command.handleInteraction(
        interaction as unknown as Parameters<typeof command.handleInteraction>[0],
      );

      // Simulate a StringSelectMenu interaction from the collector
      const selectInteraction = {
        componentType: ComponentType.StringSelect,
        customId: 'event_select',
        values: [String(selectedEventId)],
        user: { id: discordUserId },
        update: updateMock,
      };

      await collectHandler!(selectInteraction as unknown as Record<string, unknown>);

      // Wait for the async handle() inside the collector
      await new Promise((resolve) => setTimeout(resolve, 0));

      return { updateMock };
    }

    it('should show detail embed with event title when event is selected', async () => {
      const event = makeEvent({ id: 42, title: 'Dragon Boss Kill' });
      eventsService.findOne = jest.fn().mockResolvedValue(event);
      usersService.findByDiscordId = jest.fn().mockResolvedValue(null);

      const { updateMock } = await triggerEventSelect(42, 'user-123', [event]);

      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              data: expect.objectContaining({
                title: 'Dragon Boss Kill',
              }),
            }),
          ]),
        }),
      );
    });

    it('should include game name in detail embed description', async () => {
      const event = makeEvent({
        id: 43,
        game: { name: 'Final Fantasy XIV', coverUrl: null },
      });
      eventsService.findOne = jest.fn().mockResolvedValue(event);
      usersService.findByDiscordId = jest.fn().mockResolvedValue(null);

      const { updateMock } = await triggerEventSelect(43, 'user-123', [event]);

      const updateArg = updateMock.mock.calls[0][0] as {
        embeds: { data: { description?: string } }[];
      };
      expect(updateArg.embeds[0].data.description).toContain('Final Fantasy XIV');
    });

    it('should show "No game" in detail embed when game is null', async () => {
      const event = makeEvent({ id: 44, game: null });
      eventsService.findOne = jest.fn().mockResolvedValue(event);
      usersService.findByDiscordId = jest.fn().mockResolvedValue(null);

      const { updateMock } = await triggerEventSelect(44, 'user-123', [event]);

      const updateArg = updateMock.mock.calls[0][0] as {
        embeds: { data: { description?: string } }[];
      };
      expect(updateArg.embeds[0].data.description).toContain('No game');
    });

    it('should set game cover art as thumbnail when coverUrl is present', async () => {
      const event = makeEvent({
        id: 45,
        game: { name: 'WoW', coverUrl: 'https://cdn.example.com/wow.jpg' },
      });
      eventsService.findOne = jest.fn().mockResolvedValue(event);
      usersService.findByDiscordId = jest.fn().mockResolvedValue(null);

      const { updateMock } = await triggerEventSelect(45, 'user-123', [event]);

      const updateArg = updateMock.mock.calls[0][0] as {
        embeds: { data: { thumbnail?: { url: string } } }[];
      };
      expect(updateArg.embeds[0].data.thumbnail?.url).toBe(
        'https://cdn.example.com/wow.jpg',
      );
    });

    it('should NOT set thumbnail when coverUrl is null', async () => {
      const event = makeEvent({ id: 46, game: { name: 'WoW', coverUrl: null } });
      eventsService.findOne = jest.fn().mockResolvedValue(event);
      usersService.findByDiscordId = jest.fn().mockResolvedValue(null);

      const { updateMock } = await triggerEventSelect(46, 'user-123', [event]);

      const updateArg = updateMock.mock.calls[0][0] as {
        embeds: { data: { thumbnail?: unknown } }[];
      };
      expect(updateArg.embeds[0].data.thumbnail).toBeUndefined();
    });

    it('should truncate description longer than 1024 chars with ellipsis', async () => {
      const longDescription = 'A'.repeat(1100);
      const event = makeEvent({ id: 47, description: longDescription });
      eventsService.findOne = jest.fn().mockResolvedValue(event);
      usersService.findByDiscordId = jest.fn().mockResolvedValue(null);

      const { updateMock } = await triggerEventSelect(47, 'user-123', [event]);

      const updateArg = updateMock.mock.calls[0][0] as {
        embeds: { data: { description?: string } }[];
      };
      const desc = updateArg.embeds[0].data.description ?? '';
      // The truncated body ends with '...'
      expect(desc).toContain('...');
      // Total embed description should not contain the full 1100-char string
      expect(desc).not.toContain('A'.repeat(1100));
    });

    it('should not truncate description exactly at 1024 chars', async () => {
      const exactDescription = 'B'.repeat(1024);
      const event = makeEvent({ id: 48, description: exactDescription });
      eventsService.findOne = jest.fn().mockResolvedValue(event);
      usersService.findByDiscordId = jest.fn().mockResolvedValue(null);

      const { updateMock } = await triggerEventSelect(48, 'user-123', [event]);

      const updateArg = updateMock.mock.calls[0][0] as {
        embeds: { data: { description?: string } }[];
      };
      const desc = updateArg.embeds[0].data.description ?? '';
      // Should include the full 1024-char description without '...'
      expect(desc).toContain('B'.repeat(1024));
      expect(desc).not.toContain('B'.repeat(1024) + '...');
    });

    it('should show signup count with max when maxAttendees is set', async () => {
      const event = makeEvent({ id: 49, signupCount: 7, maxAttendees: 25 });
      eventsService.findOne = jest.fn().mockResolvedValue(event);
      usersService.findByDiscordId = jest.fn().mockResolvedValue(null);

      const { updateMock } = await triggerEventSelect(49, 'user-123', [event]);

      const updateArg = updateMock.mock.calls[0][0] as {
        embeds: { data: { description?: string } }[];
      };
      expect(updateArg.embeds[0].data.description).toContain('7/25');
    });

    it('should show signup count without max when maxAttendees is null', async () => {
      const event = makeEvent({ id: 50, signupCount: 4, maxAttendees: null });
      eventsService.findOne = jest.fn().mockResolvedValue(event);
      usersService.findByDiscordId = jest.fn().mockResolvedValue(null);

      const { updateMock } = await triggerEventSelect(50, 'user-123', [event]);

      const updateArg = updateMock.mock.calls[0][0] as {
        embeds: { data: { description?: string } }[];
      };
      expect(updateArg.embeds[0].data.description).toContain('4 signed up');
    });

    it('should format 1-hour duration as "1 hour" (singular)', async () => {
      const event = makeEvent({
        id: 51,
        startTime: '2030-12-25T20:00:00.000Z',
        endTime: '2030-12-25T21:00:00.000Z',
      });
      eventsService.findOne = jest.fn().mockResolvedValue(event);
      usersService.findByDiscordId = jest.fn().mockResolvedValue(null);

      const { updateMock } = await triggerEventSelect(51, 'user-123', [event]);

      const updateArg = updateMock.mock.calls[0][0] as {
        embeds: { data: { description?: string } }[];
      };
      expect(updateArg.embeds[0].data.description).toContain('1 hour');
      expect(updateArg.embeds[0].data.description).not.toContain('1 hours');
    });

    it('should format 2-hour duration as "2 hours" (plural)', async () => {
      const event = makeEvent({
        id: 52,
        startTime: '2030-12-25T20:00:00.000Z',
        endTime: '2030-12-25T22:00:00.000Z',
      });
      eventsService.findOne = jest.fn().mockResolvedValue(event);
      usersService.findByDiscordId = jest.fn().mockResolvedValue(null);

      const { updateMock } = await triggerEventSelect(52, 'user-123', [event]);

      const updateArg = updateMock.mock.calls[0][0] as {
        embeds: { data: { description?: string } }[];
      };
      expect(updateArg.embeds[0].data.description).toContain('2 hours');
    });

    it('should format fractional duration (e.g. 1.5 hours)', async () => {
      const event = makeEvent({
        id: 53,
        startTime: '2030-12-25T20:00:00.000Z',
        endTime: '2030-12-25T21:30:00.000Z',
      });
      eventsService.findOne = jest.fn().mockResolvedValue(event);
      usersService.findByDiscordId = jest.fn().mockResolvedValue(null);

      const { updateMock } = await triggerEventSelect(53, 'user-123', [event]);

      const updateArg = updateMock.mock.calls[0][0] as {
        embeds: { data: { description?: string } }[];
      };
      expect(updateArg.embeds[0].data.description).toContain('1.5 hours');
    });

    it('should include creator username in detail embed', async () => {
      const event = makeEvent({
        id: 54,
        creator: { username: 'RaidLeader' },
      });
      eventsService.findOne = jest.fn().mockResolvedValue(event);
      usersService.findByDiscordId = jest.fn().mockResolvedValue(null);

      const { updateMock } = await triggerEventSelect(54, 'user-123', [event]);

      const updateArg = updateMock.mock.calls[0][0] as {
        embeds: { data: { description?: string } }[];
      };
      expect(updateArg.embeds[0].data.description).toContain('RaidLeader');
    });

    it('should show "Unknown" as creator when creator is null', async () => {
      const event = makeEvent({ id: 55, creator: null });
      eventsService.findOne = jest.fn().mockResolvedValue(event);
      usersService.findByDiscordId = jest.fn().mockResolvedValue(null);

      const { updateMock } = await triggerEventSelect(55, 'user-123', [event]);

      const updateArg = updateMock.mock.calls[0][0] as {
        embeds: { data: { description?: string } }[];
      };
      expect(updateArg.embeds[0].data.description).toContain('Unknown');
    });

    it('should include a Back to list button in detail view', async () => {
      const event = makeEvent({ id: 56 });
      eventsService.findOne = jest.fn().mockResolvedValue(event);
      usersService.findByDiscordId = jest.fn().mockResolvedValue(null);

      const { updateMock } = await triggerEventSelect(56, 'user-123', [event]);

      const updateArg = updateMock.mock.calls[0][0] as {
        components: { components: { data: { custom_id?: string; label?: string } }[] }[];
      };
      const allButtons = updateArg.components.flatMap((row) => row.components);
      const backButton = allButtons.find(
        (b) => b.data.custom_id === 'events_back',
      );
      expect(backButton).toBeDefined();
      expect(backButton?.data.label).toBe('Back to list');
    });

    it('should use announcement embed color in detail view', async () => {
      const event = makeEvent({ id: 57 });
      eventsService.findOne = jest.fn().mockResolvedValue(event);
      usersService.findByDiscordId = jest.fn().mockResolvedValue(null);

      const { updateMock } = await triggerEventSelect(57, 'user-123', [event]);

      const updateArg = updateMock.mock.calls[0][0] as {
        embeds: { data: { color?: number } }[];
      };
      expect(updateArg.embeds[0].data.color).toBe(EMBED_COLORS.ANNOUNCEMENT);
    });
  });

  // ============================================================
  // Magic link generation vs plain URL fallback
  // ============================================================

  describe('magic link vs plain URL in detail view', () => {
    async function triggerEventSelectWithServices(
      selectedEventId: number,
      discordUserId: string,
      event: ReturnType<typeof makeEvent>,
    ) {
      let collectHandler: ((i: Record<string, unknown>) => void) | undefined;

      const collectorSpy = {
        on: jest
          .fn()
          .mockImplementation((ev: string, handler: (i: Record<string, unknown>) => void) => {
            if (ev === 'collect') collectHandler = handler;
            return collectorSpy;
          }),
      };

      const updateMock = jest.fn().mockResolvedValue(undefined);
      const replyMsg = {
        createMessageComponentCollector: jest.fn().mockReturnValue(collectorSpy),
      };
      const interaction = {
        deferReply: jest.fn().mockResolvedValue(undefined),
        editReply: jest.fn().mockResolvedValue(replyMsg),
        user: { id: discordUserId },
      };

      eventsService.findAll.mockResolvedValue({
        data: [event],
        meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
      } as unknown as Awaited<ReturnType<EventsService['findAll']>>);

      await command.handleInteraction(
        interaction as unknown as Parameters<typeof command.handleInteraction>[0],
      );

      const selectInteraction = {
        componentType: ComponentType.StringSelect,
        customId: 'event_select',
        values: [String(selectedEventId)],
        user: { id: discordUserId },
        update: updateMock,
      };

      await collectHandler!(selectInteraction as unknown as Record<string, unknown>);
      await new Promise((resolve) => setTimeout(resolve, 0));

      return { updateMock };
    }

    it('should use magic link URL when user is linked and CLIENT_URL is set', async () => {
      process.env.CLIENT_URL = 'https://raidledger.com';
      const event = makeEvent({ id: 60 });
      eventsService.findOne = jest.fn().mockResolvedValue(event);
      usersService.findByDiscordId = jest
        .fn()
        .mockResolvedValue({ id: 77, username: 'Player1' });
      magicLinkService.generateLink = jest
        .fn()
        .mockResolvedValue('https://raidledger.com/events/60?token=abc123');

      const { updateMock } = await triggerEventSelectWithServices(
        60,
        'discord-user-60',
        event,
      );

      expect(magicLinkService.generateLink).toHaveBeenCalledWith(
        77,
        '/events/60',
        'https://raidledger.com',
      );

      const updateArg = updateMock.mock.calls[0][0] as {
        components: { components: { data: { url?: string } }[] }[];
      };
      const allButtons = updateArg.components.flatMap((row) => row.components);
      const viewButton = allButtons.find((b) => b.data.url !== undefined);
      expect(viewButton?.data.url).toBe(
        'https://raidledger.com/events/60?token=abc123',
      );
    });

    it('should fall back to plain event URL when user has no linked account', async () => {
      process.env.CLIENT_URL = 'https://raidledger.com';
      const event = makeEvent({ id: 61 });
      eventsService.findOne = jest.fn().mockResolvedValue(event);
      // No linked RL account
      usersService.findByDiscordId = jest.fn().mockResolvedValue(null);

      const { updateMock } = await triggerEventSelectWithServices(
        61,
        'discord-user-61',
        event,
      );

      // Magic link should NOT be called for unlinked users
      expect(magicLinkService.generateLink).not.toHaveBeenCalled();

      const updateArg = updateMock.mock.calls[0][0] as {
        components: { components: { data: { url?: string } }[] }[];
      };
      const allButtons = updateArg.components.flatMap((row) => row.components);
      const viewButton = allButtons.find((b) => b.data.url !== undefined);
      expect(viewButton?.data.url).toBe('https://raidledger.com/events/61');
    });

    it('should fall back to plain URL when magic link generation returns null', async () => {
      process.env.CLIENT_URL = 'https://raidledger.com';
      const event = makeEvent({ id: 62 });
      eventsService.findOne = jest.fn().mockResolvedValue(event);
      usersService.findByDiscordId = jest
        .fn()
        .mockResolvedValue({ id: 88, username: 'Player2' });
      // generateLink returns null (user not found internally)
      magicLinkService.generateLink = jest.fn().mockResolvedValue(null);

      const { updateMock } = await triggerEventSelectWithServices(
        62,
        'discord-user-62',
        event,
      );

      const updateArg = updateMock.mock.calls[0][0] as {
        components: { components: { data: { url?: string } }[] }[];
      };
      const allButtons = updateArg.components.flatMap((row) => row.components);
      const viewButton = allButtons.find((b) => b.data.url !== undefined);
      // Should use plain URL as fallback
      expect(viewButton?.data.url).toBe('https://raidledger.com/events/62');
    });

    it('should not include View in Raid Ledger button when CLIENT_URL is not set', async () => {
      delete process.env.CLIENT_URL;
      const event = makeEvent({ id: 63 });
      eventsService.findOne = jest.fn().mockResolvedValue(event);
      usersService.findByDiscordId = jest.fn().mockResolvedValue(null);

      const { updateMock } = await triggerEventSelectWithServices(
        63,
        'discord-user-63',
        event,
      );

      const updateArg = updateMock.mock.calls[0][0] as {
        components: { components: { data: { label?: string } }[] }[];
      };
      const allButtons = updateArg.components.flatMap((row) => row.components);
      const viewButton = allButtons.find((b) =>
        b.data.label?.includes('View in Raid Ledger'),
      );
      expect(viewButton).toBeUndefined();
    });
  });

  // ============================================================
  // Error handling: event deleted between list and selection
  // ============================================================

  describe('event deleted between list and selection', () => {
    async function triggerEventSelectAndGetUpdate(
      selectedEventId: number,
      cachedEvents: ReturnType<typeof makeEvent>[],
    ) {
      let collectHandler: ((i: Record<string, unknown>) => void) | undefined;

      const collectorSpy = {
        on: jest
          .fn()
          .mockImplementation((ev: string, handler: (i: Record<string, unknown>) => void) => {
            if (ev === 'collect') collectHandler = handler;
            return collectorSpy;
          }),
      };

      const updateMock = jest.fn().mockResolvedValue(undefined);
      const replyMsg = {
        createMessageComponentCollector: jest.fn().mockReturnValue(collectorSpy),
      };
      const interaction = {
        deferReply: jest.fn().mockResolvedValue(undefined),
        editReply: jest.fn().mockResolvedValue(replyMsg),
        user: { id: 'user-del-test' },
      };

      eventsService.findAll.mockResolvedValue({
        data: cachedEvents,
        meta: { total: cachedEvents.length, page: 1, limit: 10, totalPages: 1 },
      } as unknown as Awaited<ReturnType<EventsService['findAll']>>);

      await command.handleInteraction(
        interaction as unknown as Parameters<typeof command.handleInteraction>[0],
      );

      const selectInteraction = {
        componentType: ComponentType.StringSelect,
        customId: 'event_select',
        values: [String(selectedEventId)],
        user: { id: 'user-del-test' },
        update: updateMock,
      };

      await collectHandler!(selectInteraction as unknown as Record<string, unknown>);
      await new Promise((resolve) => setTimeout(resolve, 0));

      return { updateMock };
    }

    it('should show friendly message and restore list when event no longer exists in cache or DB', async () => {
      // findOne throws, and the event isn't in the cache (different ID)
      eventsService.findOne = jest
        .fn()
        .mockRejectedValue(new Error('Not found'));

      const cachedEvent = makeEvent({ id: 70, title: 'Cached Event' });
      // User selects event 99 but only event 70 is cached — 99 is gone
      const { updateMock } = await triggerEventSelectAndGetUpdate(99, [cachedEvent]);

      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('no longer available'),
          embeds: expect.arrayContaining([expect.anything()]),
          components: expect.arrayContaining([expect.anything()]),
        }),
      );
    });

    it('should restore list view with cached events when event is deleted (findOne throws)', async () => {
      eventsService.findOne = jest
        .fn()
        .mockRejectedValue(new Error('Event deleted'));

      const cachedEvent = makeEvent({ id: 71, title: 'Still Here' });
      // Select the cached event but findOne fails and cache lookup succeeds
      // (event IS in cache, so it falls back to cache, not the "no longer available" path)
      eventsService.findOne = jest.fn().mockRejectedValue(new Error('DB error'));

      const { updateMock } = await triggerEventSelectAndGetUpdate(71, [cachedEvent]);

      // Should show detail view using cached data (fallback works)
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([expect.anything()]),
        }),
      );
    });

    it('should restore list view on unexpected error during detail fetch', async () => {
      // findOne succeeds but buildDetailView throws due to internal error
      eventsService.findOne = jest
        .fn()
        .mockResolvedValue(makeEvent({ id: 72 }));
      usersService.findByDiscordId = jest
        .fn()
        .mockRejectedValue(new Error('DB timeout'));

      process.env.CLIENT_URL = 'https://raidledger.com';

      const cachedEvent = makeEvent({ id: 72 });
      const { updateMock } = await triggerEventSelectAndGetUpdate(72, [cachedEvent]);

      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Something went wrong'),
          embeds: expect.arrayContaining([expect.anything()]),
          components: expect.arrayContaining([expect.anything()]),
        }),
      );
    });
  });

  // ============================================================
  // Back button: restores list view
  // ============================================================

  describe('Back to list button', () => {
    async function triggerBackButton(
      discordUserId: string,
      cachedEvents: ReturnType<typeof makeEvent>[],
    ) {
      let collectHandler: ((i: Record<string, unknown>) => void) | undefined;

      const collectorSpy = {
        on: jest
          .fn()
          .mockImplementation((ev: string, handler: (i: Record<string, unknown>) => void) => {
            if (ev === 'collect') collectHandler = handler;
            return collectorSpy;
          }),
      };

      const updateMock = jest.fn().mockResolvedValue(undefined);
      const replyMsg = {
        createMessageComponentCollector: jest.fn().mockReturnValue(collectorSpy),
      };
      const interaction = {
        deferReply: jest.fn().mockResolvedValue(undefined),
        editReply: jest.fn().mockResolvedValue(replyMsg),
        user: { id: discordUserId },
      };

      eventsService.findAll.mockResolvedValueOnce({
        data: cachedEvents,
        meta: { total: cachedEvents.length, page: 1, limit: 10, totalPages: 1 },
      } as unknown as Awaited<ReturnType<EventsService['findAll']>>);

      await command.handleInteraction(
        interaction as unknown as Parameters<typeof command.handleInteraction>[0],
      );

      return { collectHandler: collectHandler!, updateMock };
    }

    it('should re-fetch events and show list when back button is pressed', async () => {
      const cachedEvents = [makeEvent({ id: 80, title: 'Old Event' })];
      const freshEvents = [
        makeEvent({ id: 80, title: 'Old Event' }),
        makeEvent({ id: 81, title: 'New Event' }),
      ];

      const { collectHandler, updateMock } = await triggerBackButton(
        'user-back-1',
        cachedEvents,
      );

      // Set up the re-fetch for Back button
      eventsService.findAll.mockResolvedValueOnce({
        data: freshEvents,
        meta: { total: 2, page: 1, limit: 10, totalPages: 1 },
      } as unknown as Awaited<ReturnType<EventsService['findAll']>>);

      const backInteraction = {
        componentType: ComponentType.Button,
        customId: 'events_back',
        user: { id: 'user-back-1' },
        update: updateMock,
      };

      await collectHandler(backInteraction as unknown as Record<string, unknown>);
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Should re-fetch events list
      expect(eventsService.findAll).toHaveBeenCalledTimes(2);
      // Should show list embed with components
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([expect.anything()]),
          components: expect.arrayContaining([expect.anything()]),
        }),
      );
    });

    it('should show "No upcoming events found" in back button if re-fetch returns empty', async () => {
      const cachedEvents = [makeEvent({ id: 82 })];
      const { collectHandler, updateMock } = await triggerBackButton(
        'user-back-2',
        cachedEvents,
      );

      // All events expired by the time user presses Back
      eventsService.findAll.mockResolvedValueOnce({
        data: [],
        meta: { total: 0, page: 1, limit: 10, totalPages: 0 },
      } as unknown as Awaited<ReturnType<EventsService['findAll']>>);

      const backInteraction = {
        componentType: ComponentType.Button,
        customId: 'events_back',
        user: { id: 'user-back-2' },
        update: updateMock,
      };

      await collectHandler(backInteraction as unknown as Record<string, unknown>);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'No upcoming events found.',
          embeds: [],
          components: [],
        }),
      );
    });

    it('should fall back to cached events when back button re-fetch fails', async () => {
      const cachedEvents = [makeEvent({ id: 83, title: 'Cached Fallback' })];
      const { collectHandler, updateMock } = await triggerBackButton(
        'user-back-3',
        cachedEvents,
      );

      // Re-fetch fails
      eventsService.findAll.mockRejectedValueOnce(new Error('Network error'));

      const backInteraction = {
        componentType: ComponentType.Button,
        customId: 'events_back',
        user: { id: 'user-back-3' },
        update: updateMock,
      };

      await collectHandler(backInteraction as unknown as Record<string, unknown>);
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Should still show the list using cached events
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([expect.anything()]),
          components: expect.arrayContaining([expect.anything()]),
        }),
      );
    });

    it('should restore content to empty string when going back to list', async () => {
      const cachedEvents = [makeEvent({ id: 84 })];
      const { collectHandler, updateMock } = await triggerBackButton(
        'user-back-4',
        cachedEvents,
      );

      eventsService.findAll.mockResolvedValueOnce({
        data: cachedEvents,
        meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
      } as unknown as Awaited<ReturnType<EventsService['findAll']>>);

      const backInteraction = {
        componentType: ComponentType.Button,
        customId: 'events_back',
        user: { id: 'user-back-4' },
        update: updateMock,
      };

      await collectHandler(backInteraction as unknown as Record<string, unknown>);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          content: '',
        }),
      );
    });
  });

  // ============================================================
  // Dropdown options: label/description edge cases
  // ============================================================

  describe('StringSelectMenu dropdown options', () => {
    it('should include all 10 events as dropdown options when at max', async () => {
      const events = Array.from({ length: 10 }, (_, i) =>
        makeEvent({ id: i + 1, title: `Event ${i + 1}` }),
      );
      const interaction = mockInteraction();
      eventsService.findAll.mockResolvedValue({
        data: events,
        meta: { total: 10, page: 1, limit: 10, totalPages: 1 },
      } as unknown as Awaited<ReturnType<EventsService['findAll']>>);

      await command.handleInteraction(
        interaction as unknown as Parameters<typeof command.handleInteraction>[0],
      );

      const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
        components: { components: { options: { data: { value: string } }[] }[] }[];
      };
      const selectMenu = call.components[0].components[0];
      expect(selectMenu.options).toHaveLength(10);
    });

    it('should include single event as dropdown option', async () => {
      const interaction = mockInteraction();
      eventsService.findAll.mockResolvedValue({
        data: [makeEvent({ id: 5, title: 'Solo Event' })],
        meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
      } as unknown as Awaited<ReturnType<EventsService['findAll']>>);

      await command.handleInteraction(
        interaction as unknown as Parameters<typeof command.handleInteraction>[0],
      );

      const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
        components: { components: { options: { data: { value: string; label: string } }[] }[] }[];
      };
      const selectMenu = call.components[0].components[0];
      expect(selectMenu.options).toHaveLength(1);
      expect(selectMenu.options[0].data.value).toBe('5');
      expect(selectMenu.options[0].data.label).toBe('Solo Event');
    });

    it('should use event id as the dropdown option value', async () => {
      const interaction = mockInteraction();
      eventsService.findAll.mockResolvedValue({
        data: [makeEvent({ id: 999 })],
        meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
      } as unknown as Awaited<ReturnType<EventsService['findAll']>>);

      await command.handleInteraction(
        interaction as unknown as Parameters<typeof command.handleInteraction>[0],
      );

      const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
        components: { components: { options: { data: { value: string } }[] }[] }[];
      };
      const selectMenu = call.components[0].components[0];
      expect(selectMenu.options[0].data.value).toBe('999');
    });

    it('should include game name in dropdown option description', async () => {
      const interaction = mockInteraction();
      eventsService.findAll.mockResolvedValue({
        data: [makeEvent({ id: 1, game: { name: 'EverQuest', coverUrl: null } })],
        meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
      } as unknown as Awaited<ReturnType<EventsService['findAll']>>);

      await command.handleInteraction(
        interaction as unknown as Parameters<typeof command.handleInteraction>[0],
      );

      const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
        components: { components: { options: { data: { description: string } }[] }[] }[];
      };
      const selectMenu = call.components[0].components[0];
      expect(selectMenu.options[0].data.description).toContain('EverQuest');
    });

    it('should show "No game" in dropdown description when event has no game', async () => {
      const interaction = mockInteraction();
      eventsService.findAll.mockResolvedValue({
        data: [makeEvent({ id: 1, game: null })],
        meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
      } as unknown as Awaited<ReturnType<EventsService['findAll']>>);

      await command.handleInteraction(
        interaction as unknown as Parameters<typeof command.handleInteraction>[0],
      );

      const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
        components: { components: { options: { data: { description: string } }[] }[] }[];
      };
      const selectMenu = call.components[0].components[0];
      expect(selectMenu.options[0].data.description).toContain('No game');
    });

    it('should truncate event title label to 100 chars in dropdown', async () => {
      const longTitle = 'X'.repeat(150);
      const interaction = mockInteraction();
      eventsService.findAll.mockResolvedValue({
        data: [makeEvent({ id: 1, title: longTitle })],
        meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
      } as unknown as Awaited<ReturnType<EventsService['findAll']>>);

      await command.handleInteraction(
        interaction as unknown as Parameters<typeof command.handleInteraction>[0],
      );

      const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
        components: { components: { options: { data: { label: string } }[] }[] }[];
      };
      const selectMenu = call.components[0].components[0];
      expect(selectMenu.options[0].data.label).toHaveLength(100);
      expect(selectMenu.options[0].data.label).toBe('X'.repeat(100));
    });
  });

  // ============================================================
  // View All link button
  // ============================================================

  describe('View All link button', () => {
    it('should point View All button to /events path on CLIENT_URL', async () => {
      process.env.CLIENT_URL = 'https://myraid.com';
      const interaction = mockInteraction();
      eventsService.findAll.mockResolvedValue({
        data: [makeEvent()],
        meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
      } as unknown as Awaited<ReturnType<EventsService['findAll']>>);

      await command.handleInteraction(
        interaction as unknown as Parameters<typeof command.handleInteraction>[0],
      );

      const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
        components: { components: { data: { url?: string; label?: string } }[] }[];
      };
      // Second component row is the View All button
      const buttonRow = call.components[1];
      const viewAllButton = buttonRow.components[0];
      expect(viewAllButton.data.url).toBe('https://myraid.com/events');
      expect(viewAllButton.data.label).toBe('View All in Raid Ledger');
    });
  });
});
