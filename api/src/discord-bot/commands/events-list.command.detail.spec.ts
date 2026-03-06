/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { ComponentType } from 'discord.js';
import { EventsListCommand } from './events-list.command';
import { EventsService } from '../../events/events.service';
import { UsersService } from '../../users/users.service';
import { MagicLinkService } from '../../auth/magic-link.service';
import { EMBED_COLORS } from '../discord-bot.constants';

describe('EventsListCommand — detail', () => {
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
      let collectHandler: ((i: Record<string, unknown>) => void) | undefined;

      const collectorSpy = {
        on: jest
          .fn()
          .mockImplementation(
            (event: string, handler: (i: Record<string, unknown>) => void) => {
              if (event === 'collect') collectHandler = handler;
              return collectorSpy;
            },
          ),
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
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      // Simulate a StringSelectMenu interaction from the collector
      const selectInteraction = {
        componentType: ComponentType.StringSelect,
        customId: 'event_select',
        values: [String(selectedEventId)],
        user: { id: discordUserId },
        update: updateMock,
      };

      collectHandler!(selectInteraction as unknown as Record<string, unknown>);

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
              }) as unknown,
            }) as unknown,
          ]) as unknown,
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

      const updateArg = (updateMock.mock.calls as unknown[][])[0][0] as {
        embeds: { data: { description?: string } }[];
      };
      expect(updateArg.embeds[0].data.description).toContain(
        'Final Fantasy XIV',
      );
    });

    it('should show "No game" in detail embed when game is null', async () => {
      const event = makeEvent({ id: 44, game: null });
      eventsService.findOne = jest.fn().mockResolvedValue(event);
      usersService.findByDiscordId = jest.fn().mockResolvedValue(null);

      const { updateMock } = await triggerEventSelect(44, 'user-123', [event]);

      const updateArg = (updateMock.mock.calls as unknown[][])[0][0] as {
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

      const updateArg = (updateMock.mock.calls as unknown[][])[0][0] as {
        embeds: { data: { thumbnail?: { url: string } } }[];
      };
      expect(updateArg.embeds[0].data.thumbnail?.url).toBe(
        'https://cdn.example.com/wow.jpg',
      );
    });

    it('should NOT set thumbnail when coverUrl is null', async () => {
      const event = makeEvent({
        id: 46,
        game: { name: 'WoW', coverUrl: null },
      });
      eventsService.findOne = jest.fn().mockResolvedValue(event);
      usersService.findByDiscordId = jest.fn().mockResolvedValue(null);

      const { updateMock } = await triggerEventSelect(46, 'user-123', [event]);

      const updateArg = (updateMock.mock.calls as unknown[][])[0][0] as {
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

      const updateArg = (updateMock.mock.calls as unknown[][])[0][0] as {
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

      const updateArg = (updateMock.mock.calls as unknown[][])[0][0] as {
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

      const updateArg = (updateMock.mock.calls as unknown[][])[0][0] as {
        embeds: { data: { description?: string } }[];
      };
      expect(updateArg.embeds[0].data.description).toContain('7/25');
    });

    it('should show signup count without max when maxAttendees is null', async () => {
      const event = makeEvent({ id: 50, signupCount: 4, maxAttendees: null });
      eventsService.findOne = jest.fn().mockResolvedValue(event);
      usersService.findByDiscordId = jest.fn().mockResolvedValue(null);

      const { updateMock } = await triggerEventSelect(50, 'user-123', [event]);

      const updateArg = (updateMock.mock.calls as unknown[][])[0][0] as {
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

      const updateArg = (updateMock.mock.calls as unknown[][])[0][0] as {
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

      const updateArg = (updateMock.mock.calls as unknown[][])[0][0] as {
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

      const updateArg = (updateMock.mock.calls as unknown[][])[0][0] as {
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

      const updateArg = (updateMock.mock.calls as unknown[][])[0][0] as {
        embeds: { data: { description?: string } }[];
      };
      expect(updateArg.embeds[0].data.description).toContain('RaidLeader');
    });

    it('should show "Unknown" as creator when creator is null', async () => {
      const event = makeEvent({ id: 55, creator: null });
      eventsService.findOne = jest.fn().mockResolvedValue(event);
      usersService.findByDiscordId = jest.fn().mockResolvedValue(null);

      const { updateMock } = await triggerEventSelect(55, 'user-123', [event]);

      const updateArg = (updateMock.mock.calls as unknown[][])[0][0] as {
        embeds: { data: { description?: string } }[];
      };
      expect(updateArg.embeds[0].data.description).toContain('Unknown');
    });

    it('should include a Back to list button in detail view', async () => {
      const event = makeEvent({ id: 56 });
      eventsService.findOne = jest.fn().mockResolvedValue(event);
      usersService.findByDiscordId = jest.fn().mockResolvedValue(null);

      const { updateMock } = await triggerEventSelect(56, 'user-123', [event]);

      const updateArg = (updateMock.mock.calls as unknown[][])[0][0] as {
        components: {
          components: { data: { custom_id?: string; label?: string } }[];
        }[];
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

      const updateArg = (updateMock.mock.calls as unknown[][])[0][0] as {
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
          .mockImplementation(
            (ev: string, handler: (i: Record<string, unknown>) => void) => {
              if (ev === 'collect') collectHandler = handler;
              return collectorSpy;
            },
          ),
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
        data: [event],
        meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
      } as unknown as Awaited<ReturnType<EventsService['findAll']>>);

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const selectInteraction = {
        componentType: ComponentType.StringSelect,
        customId: 'event_select',
        values: [String(selectedEventId)],
        user: { id: discordUserId },
        update: updateMock,
      };

      collectHandler!(selectInteraction as unknown as Record<string, unknown>);
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

      const updateArg = (updateMock.mock.calls as unknown[][])[0][0] as {
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

      const updateArg = (updateMock.mock.calls as unknown[][])[0][0] as {
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

      const updateArg = (updateMock.mock.calls as unknown[][])[0][0] as {
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

      const updateArg = (updateMock.mock.calls as unknown[][])[0][0] as {
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

});
