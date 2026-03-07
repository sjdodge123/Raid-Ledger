import { Test, TestingModule } from '@nestjs/testing';
import { ComponentType } from 'discord.js';
import { EventsListCommand } from './events-list.command';
import { EventsService } from '../../events/events.service';
import { UsersService } from '../../users/users.service';
import { MagicLinkService } from '../../auth/magic-link.service';

describe('EventsListCommand — navigation', () => {
  let module: TestingModule;
  let command: EventsListCommand;
  let eventsService: jest.Mocked<EventsService>;
  let usersService: jest.Mocked<UsersService>;

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

  function buildProviders() {
    return [
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
    ];
  }
  async function setupBlock() {
    delete process.env.CLIENT_URL;

    const module_: TestingModule = await Test.createTestingModule({
      providers: buildProviders(),
    }).compile();

    module = module_;
    command = module.get(EventsListCommand);
    eventsService = module.get(EventsService);
    usersService = module.get(UsersService);
  }

  beforeEach(async () => {
    await setupBlock();
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

  describe('event deleted between list and selection', () => {
    async function triggerEventSelectAndGetUpdate(
      selectedEventId: number,
      cachedEvents: ReturnType<typeof makeEvent>[],
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
        user: { id: 'user-del-test' },
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

      const selectInteraction = {
        componentType: ComponentType.StringSelect,
        customId: 'event_select',
        values: [String(selectedEventId)],
        user: { id: 'user-del-test' },
        update: updateMock,
      };

      collectHandler!(selectInteraction as unknown as Record<string, unknown>);
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
      const { updateMock } = await triggerEventSelectAndGetUpdate(99, [
        cachedEvent,
      ]);

      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('no longer available') as unknown,
          embeds: expect.arrayContaining([expect.anything()]) as unknown,
          components: expect.arrayContaining([expect.anything()]) as unknown,
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
      eventsService.findOne = jest
        .fn()
        .mockRejectedValue(new Error('DB error'));

      const { updateMock } = await triggerEventSelectAndGetUpdate(71, [
        cachedEvent,
      ]);

      // Should show detail view using cached data (fallback works)
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([expect.anything()]) as unknown,
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
      const { updateMock } = await triggerEventSelectAndGetUpdate(72, [
        cachedEvent,
      ]);

      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Something went wrong') as unknown,
          embeds: expect.arrayContaining([expect.anything()]) as unknown,
          components: expect.arrayContaining([expect.anything()]) as unknown,
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

      eventsService.findAll.mockResolvedValueOnce({
        data: cachedEvents,
        meta: { total: cachedEvents.length, page: 1, limit: 10, totalPages: 1 },
      } as unknown as Awaited<ReturnType<EventsService['findAll']>>);

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
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

      collectHandler(backInteraction as unknown as Record<string, unknown>);
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Should re-fetch events list
      expect(eventsService.findAll).toHaveBeenCalledTimes(2);
      // Should show list embed with components
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([expect.anything()]) as unknown,
          components: expect.arrayContaining([expect.anything()]) as unknown,
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

      collectHandler(backInteraction as unknown as Record<string, unknown>);
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

      collectHandler(backInteraction as unknown as Record<string, unknown>);
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Should still show the list using cached events
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([expect.anything()]) as unknown,
          components: expect.arrayContaining([expect.anything()]) as unknown,
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

      collectHandler(backInteraction as unknown as Record<string, unknown>);
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
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
        components: {
          components: { options: { data: { value: string } }[] }[];
        }[];
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
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
        components: {
          components: {
            options: { data: { value: string; label: string } }[];
          }[];
        }[];
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
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
        components: {
          components: { options: { data: { value: string } }[] }[];
        }[];
      };
      const selectMenu = call.components[0].components[0];
      expect(selectMenu.options[0].data.value).toBe('999');
    });

    it('should include game name in dropdown option description', async () => {
      const interaction = mockInteraction();
      eventsService.findAll.mockResolvedValue({
        data: [
          makeEvent({ id: 1, game: { name: 'EverQuest', coverUrl: null } }),
        ],
        meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
      } as unknown as Awaited<ReturnType<EventsService['findAll']>>);

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
        components: {
          components: { options: { data: { description: string } }[] }[];
        }[];
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
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
        components: {
          components: { options: { data: { description: string } }[] }[];
        }[];
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
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
        components: {
          components: { options: { data: { label: string } }[] }[];
        }[];
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
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
        components: {
          components: { data: { url?: string; label?: string } }[];
        }[];
      };
      // Second component row is the View All button
      const buttonRow = call.components[1];
      const viewAllButton = buttonRow.components[0];
      expect(viewAllButton.data.url).toBe('https://myraid.com/events');
      expect(viewAllButton.data.label).toBe('View All in Raid Ledger');
    });
  });
});
