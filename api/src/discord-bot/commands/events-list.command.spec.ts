/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { EventsListCommand } from './events-list.command';
import { EventsService } from '../../events/events.service';
import { UsersService } from '../../users/users.service';
import { MagicLinkService } from '../../auth/magic-link.service';
import { EMBED_COLORS } from '../discord-bot.constants';

describe('EventsListCommand', () => {
  let module: TestingModule;
  let command: EventsListCommand;
  let eventsService: jest.Mocked<EventsService>;

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
});
