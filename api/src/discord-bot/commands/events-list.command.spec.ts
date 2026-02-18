/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { EventsListCommand } from './events-list.command';
import { EventsService } from '../../events/events.service';
import { EMBED_COLORS } from '../discord-bot.constants';

describe('EventsListCommand', () => {
  let module: TestingModule;
  let command: EventsListCommand;
  let eventsService: jest.Mocked<EventsService>;

  const originalClientUrl = process.env.CLIENT_URL;

  const mockInteraction = () => ({
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
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
        meta: { total: 1, page: 1, limit: 5, totalPages: 1 },
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
        meta: { total: 0, page: 1, limit: 5, totalPages: 0 },
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

    it('should call findAll with upcoming filter and limit 5', async () => {
      const interaction = mockInteraction();
      eventsService.findAll.mockResolvedValue({
        data: [makeEvent()],
        meta: { total: 1, page: 1, limit: 5, totalPages: 1 },
      } as unknown as Awaited<ReturnType<EventsService['findAll']>>);

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(eventsService.findAll).toHaveBeenCalledWith({
        upcoming: 'true',
        limit: 5,
        page: 1,
      });
    });

    it('should build an embed with event details', async () => {
      const interaction = mockInteraction();
      eventsService.findAll.mockResolvedValue({
        data: [makeEvent()],
        meta: { total: 1, page: 1, limit: 5, totalPages: 1 },
      } as unknown as Awaited<ReturnType<EventsService['findAll']>>);

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([expect.anything()]),
        }),
      );
    });

    it('should use announcement color for the embed', async () => {
      const interaction = mockInteraction();
      eventsService.findAll.mockResolvedValue({
        data: [makeEvent()],
        meta: { total: 1, page: 1, limit: 5, totalPages: 1 },
      } as unknown as Awaited<ReturnType<EventsService['findAll']>>);

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const call = interaction.editReply.mock.calls[0][0] as {
        embeds: { data: { color?: number } }[];
      };
      expect(call.embeds[0].data.color).toBe(EMBED_COLORS.ANNOUNCEMENT);
    });

    it('should display "No game" when event has no game', async () => {
      const interaction = mockInteraction();
      eventsService.findAll.mockResolvedValue({
        data: [makeEvent({ game: null })],
        meta: { total: 1, page: 1, limit: 5, totalPages: 1 },
      } as unknown as Awaited<ReturnType<EventsService['findAll']>>);

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const call = interaction.editReply.mock.calls[0][0] as {
        embeds: { data: { description?: string } }[];
      };
      expect(call.embeds[0].data.description).toContain('No game');
    });

    it('should show roster as "N/max" when maxAttendees is set', async () => {
      const interaction = mockInteraction();
      eventsService.findAll.mockResolvedValue({
        data: [makeEvent({ signupCount: 5, maxAttendees: 20 })],
        meta: { total: 1, page: 1, limit: 5, totalPages: 1 },
      } as unknown as Awaited<ReturnType<EventsService['findAll']>>);

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const call = interaction.editReply.mock.calls[0][0] as {
        embeds: { data: { description?: string } }[];
      };
      expect(call.embeds[0].data.description).toContain('5/20');
    });

    it('should show roster as "N signed up" when maxAttendees is null', async () => {
      const interaction = mockInteraction();
      eventsService.findAll.mockResolvedValue({
        data: [makeEvent({ signupCount: 3, maxAttendees: null })],
        meta: { total: 1, page: 1, limit: 5, totalPages: 1 },
      } as unknown as Awaited<ReturnType<EventsService['findAll']>>);

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const call = interaction.editReply.mock.calls[0][0] as {
        embeds: { data: { description?: string } }[];
      };
      expect(call.embeds[0].data.description).toContain('3 signed up');
    });

    it('should include button to view all events when CLIENT_URL is set', async () => {
      process.env.CLIENT_URL = 'https://raidledger.com';
      const interaction = mockInteraction();
      eventsService.findAll.mockResolvedValue({
        data: [makeEvent()],
        meta: { total: 1, page: 1, limit: 5, totalPages: 1 },
      } as unknown as Awaited<ReturnType<EventsService['findAll']>>);

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const call = interaction.editReply.mock.calls[0][0] as {
        components: unknown[];
      };
      expect(call.components.length).toBeGreaterThan(0);
    });

    it('should not include button when CLIENT_URL is not set', async () => {
      delete process.env.CLIENT_URL;
      const interaction = mockInteraction();
      eventsService.findAll.mockResolvedValue({
        data: [makeEvent()],
        meta: { total: 1, page: 1, limit: 5, totalPages: 1 },
      } as unknown as Awaited<ReturnType<EventsService['findAll']>>);

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const call = interaction.editReply.mock.calls[0][0] as {
        components: unknown[];
      };
      expect(call.components).toHaveLength(0);
    });

    it('should include total count in the footer', async () => {
      const interaction = mockInteraction();
      eventsService.findAll.mockResolvedValue({
        data: [makeEvent(), makeEvent({ id: 2, title: 'Event 2' })],
        meta: { total: 10, page: 1, limit: 5, totalPages: 2 },
      } as unknown as Awaited<ReturnType<EventsService['findAll']>>);

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const call = interaction.editReply.mock.calls[0][0] as {
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
  });
});
