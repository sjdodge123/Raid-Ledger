/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { EventCreateCommand } from './event-create.command';
import { EventsService } from '../../events/events.service';
import { UsersService } from '../../users/users.service';
import { PreferencesService } from '../../users/preferences.service';
import { SettingsService } from '../../settings/settings.service';
import { MagicLinkService } from '../../auth/magic-link.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { ApplicationCommandOptionType } from 'discord.js';

describe('EventCreateCommand', () => {
  let module: TestingModule;
  let command: EventCreateCommand;
  let eventsService: jest.Mocked<EventsService>;
  let usersService: jest.Mocked<UsersService>;
  let preferencesService: jest.Mocked<PreferencesService>;
  let settingsService: jest.Mocked<SettingsService>;
  let magicLinkService: jest.Mocked<MagicLinkService>;
  let mockDb: {
    select: jest.Mock;
    insert: jest.Mock;
  };

  const originalClientUrl = process.env.CLIENT_URL;

  const mockUser = { id: 1, username: 'testuser', role: 'member' as const };
  const mockGame = { id: 'game-uuid', name: 'WoW', coverUrl: null };
  const mockCreatedEvent = {
    id: 42,
    title: 'Test Raid',
    startTime: '2030-12-25T20:00:00.000Z',
    endTime: '2030-12-25T22:00:00.000Z',
    signupCount: 0,
    maxAttendees: 20,
    game: { name: 'WoW', coverUrl: null },
  };

  const createChainMock = (resolvedValue: unknown[] = []) => {
    const chain: Record<string, jest.Mock> = {};
    chain.from = jest.fn().mockReturnValue(chain);
    chain.where = jest.fn().mockReturnValue(chain);
    chain.limit = jest.fn().mockResolvedValue(resolvedValue);
    chain.values = jest.fn().mockReturnValue(chain);
    chain.returning = jest.fn().mockResolvedValue(resolvedValue);
    return chain;
  };

  const makeInteraction = (
    options: {
      title?: string;
      game?: string;
      time?: string;
      slots?: number | null;
      discordId?: string;
      subcommand?: string;
    } = {},
  ) => ({
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    user: { id: options.discordId ?? 'discord-user-123' },
    options: {
      getSubcommand: jest.fn().mockReturnValue(options.subcommand ?? 'create'),
      getString: jest.fn().mockImplementation((name: string) => {
        if (name === 'title') return options.title ?? 'Test Raid';
        if (name === 'game') return options.game ?? 'WoW';
        if (name === 'time') return options.time ?? 'December 25, 2030 8pm';
        return null;
      }),
      getInteger: jest.fn().mockReturnValue(options.slots ?? null),
    },
  });

  beforeEach(async () => {
    delete process.env.CLIENT_URL;

    mockDb = {
      select: jest.fn().mockReturnValue(createChainMock([mockGame])),
      insert: jest.fn().mockReturnValue(createChainMock()),
    };

    const module_: TestingModule = await Test.createTestingModule({
      providers: [
        EventCreateCommand,
        {
          provide: DrizzleAsyncProvider,
          useValue: mockDb,
        },
        {
          provide: EventsService,
          useValue: {
            create: jest.fn().mockResolvedValue(mockCreatedEvent),
          },
        },
        {
          provide: UsersService,
          useValue: {
            findByDiscordId: jest.fn().mockResolvedValue(mockUser),
          },
        },
        {
          provide: PreferencesService,
          useValue: {
            getUserPreference: jest.fn().mockResolvedValue(null),
          },
        },
        {
          provide: SettingsService,
          useValue: {
            get: jest.fn().mockResolvedValue('UTC'),
            getBranding: jest.fn().mockResolvedValue({
              communityName: 'Test Guild',
              communityLogoPath: null,
              communityAccentColor: null,
            }),
          },
        },
        {
          provide: MagicLinkService,
          useValue: {
            generateLink: jest.fn().mockResolvedValue(null),
          },
        },
      ],
    }).compile();

    module = module_;
    command = module.get(EventCreateCommand);
    eventsService = module.get(EventsService);
    usersService = module.get(UsersService);
    preferencesService = module.get(PreferencesService);
    settingsService = module.get(SettingsService);
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
    it('should return a command definition named "event"', () => {
      const definition = command.getDefinition();
      expect(definition.name).toBe('event');
    });

    it('should have a create subcommand', () => {
      const definition = command.getDefinition();
      const options = definition.options ?? [];
      const createSub = options.find(
        (o) =>
          o.name === 'create' &&
          o.type === ApplicationCommandOptionType.Subcommand,
      );
      expect(createSub).toBeDefined();
    });
  });

  describe('handleInteraction (subcommand routing)', () => {
    it('should call handleCreate for "create" subcommand', async () => {
      const interaction = makeInteraction({ subcommand: 'create' });

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      // If handleCreate ran, deferReply would have been called
      expect(interaction.deferReply).toHaveBeenCalled();
    });

    it('should do nothing for unknown subcommands', async () => {
      const interaction = makeInteraction({ subcommand: 'delete' });

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(interaction.deferReply).not.toHaveBeenCalled();
    });
  });

  describe('handleInteraction (create subcommand)', () => {
    it('should defer reply as ephemeral', async () => {
      const interaction = makeInteraction();

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    });

    it('should reply with account linking message when user has no Raid Ledger account', async () => {
      usersService.findByDiscordId.mockResolvedValue(undefined);
      const interaction = makeInteraction();

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.stringContaining('Raid Ledger account'),
      );
      expect(eventsService.create).not.toHaveBeenCalled();
    });

    it('should reply with error when time cannot be parsed', async () => {
      const interaction = makeInteraction({ time: 'not a valid time xyz' });

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.stringContaining('Could not parse time'),
      );
      expect(eventsService.create).not.toHaveBeenCalled();
    });

    it('should include the unparseable time input in the error message', async () => {
      const badTime = 'not a valid time xyz';
      const interaction = makeInteraction({ time: badTime });

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.stringContaining(badTime),
      );
    });

    it('should create an event with parsed start time and 2-hour default end time', async () => {
      const interaction = makeInteraction({ time: 'December 25, 2030 8pm' });

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(eventsService.create).toHaveBeenCalledWith(
        mockUser.id,
        expect.objectContaining({
          title: 'Test Raid',
          startTime: expect.any(String) as unknown,
          endTime: expect.any(String) as unknown,
          maxAttendees: 20, // default slots
        }),
      );

      // Verify end time is 2 hours after start time
      const callArgs = (
        (eventsService.create as jest.Mock).mock.calls as unknown[][]
      )[0][1] as {
        startTime: string;
        endTime: string;
      };
      const startMs = new Date(callArgs.startTime).getTime();
      const endMs = new Date(callArgs.endTime).getTime();
      expect(endMs - startMs).toBe(2 * 60 * 60 * 1000);
    });

    it('should use the custom slots value when provided', async () => {
      const interaction = makeInteraction({ slots: 15 });

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(eventsService.create).toHaveBeenCalledWith(
        mockUser.id,
        expect.objectContaining({ maxAttendees: 15 }),
      );
    });

    it('should use default 20 slots when slots option is null', async () => {
      const interaction = makeInteraction({ slots: null });

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(eventsService.create).toHaveBeenCalledWith(
        mockUser.id,
        expect.objectContaining({ maxAttendees: 20 }),
      );
    });

    it('should attach game registry ID when game is found', async () => {
      const interaction = makeInteraction();

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(eventsService.create).toHaveBeenCalledWith(
        mockUser.id,
        expect.objectContaining({ registryGameId: 'game-uuid' }),
      );
    });

    it('should create event without game ID when game is not found', async () => {
      mockDb.select.mockReturnValue(createChainMock([])); // no game found
      const interaction = makeInteraction({ game: 'Unknown Game' });

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(eventsService.create).toHaveBeenCalledWith(
        mockUser.id,
        expect.objectContaining({ registryGameId: undefined }),
      );
    });

    it('should reply with ephemeral confirmation embed on success', async () => {
      const interaction = makeInteraction();

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

    it('should include timezone in the confirmation embed', async () => {
      settingsService.get.mockResolvedValue('America/New_York');
      const interaction = makeInteraction();

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
        embeds: { data: { description?: string } }[];
      };
      expect(call.embeds[0].data.description).toContain('America/New_York');
    });

    it('should include magic link button when CLIENT_URL is set and link is generated', async () => {
      process.env.CLIENT_URL = 'https://raidledger.com';
      magicLinkService.generateLink.mockResolvedValue(
        'https://raidledger.com/events/42/edit?token=abc',
      );
      const interaction = makeInteraction();

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
        components: unknown[];
      };
      expect(call.components.length).toBeGreaterThan(0);
    });

    it('should not include button when CLIENT_URL is not set', async () => {
      delete process.env.CLIENT_URL;
      const interaction = makeInteraction();

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
        components: unknown[];
      };
      expect(call.components).toHaveLength(0);
    });

    it('should not include button when magic link generation returns null', async () => {
      process.env.CLIENT_URL = 'https://raidledger.com';
      magicLinkService.generateLink.mockResolvedValue(null);
      const interaction = makeInteraction();

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
        components: unknown[];
      };
      expect(call.components).toHaveLength(0);
    });

    it('should reply with error message when event creation fails', async () => {
      eventsService.create.mockRejectedValue(new Error('DB constraint error'));
      const interaction = makeInteraction();

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.stringContaining('Failed to create event'),
      );
    });

    it('should use user timezone preference when available', async () => {
      preferencesService.getUserPreference.mockResolvedValue({
        id: 1,
        userId: 1,
        key: 'timezone',
        value: 'America/New_York',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const interaction = makeInteraction();

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
        embeds: { data: { description?: string } }[];
      };
      expect(call.embeds[0].data.description).toContain('America/New_York');
    });

    it('should fall back to community default when user preference is auto', async () => {
      preferencesService.getUserPreference.mockResolvedValue({
        id: 1,
        userId: 1,
        key: 'timezone',
        value: 'auto',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      settingsService.get.mockResolvedValue('America/Chicago');
      const interaction = makeInteraction();

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
        embeds: { data: { description?: string } }[];
      };
      expect(call.embeds[0].data.description).toContain('America/Chicago');
    });

    it('should fall back to America/New_York when both user preference and community default are unavailable', async () => {
      preferencesService.getUserPreference.mockResolvedValue(undefined);
      settingsService.get.mockResolvedValue(null);
      const interaction = makeInteraction();

      await command.handleInteraction(
        interaction as unknown as Parameters<
          typeof command.handleInteraction
        >[0],
      );

      const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
        embeds: { data: { description?: string } }[];
      };
      expect(call.embeds[0].data.description).toContain('America/New_York');
    });
  });

  describe('handleAutocomplete', () => {
    it('should respond with matching games for "game" field', async () => {
      const mockRespond = jest.fn().mockResolvedValue(undefined);
      const mockAutocompleteInteraction = {
        options: {
          getFocused: jest.fn().mockReturnValue({ name: 'game', value: 'wow' }),
        },
        respond: mockRespond,
      };

      const chain = createChainMock([
        { id: 'game-1', name: 'World of Warcraft' },
      ]);
      mockDb.select.mockReturnValue(chain);

      await command.handleAutocomplete(
        mockAutocompleteInteraction as unknown as Parameters<
          typeof command.handleAutocomplete
        >[0],
      );

      expect(mockRespond).toHaveBeenCalledWith([
        { name: 'World of Warcraft', value: 'World of Warcraft' },
      ]);
    });

    it('should respond with empty array when no games match', async () => {
      const mockRespond = jest.fn().mockResolvedValue(undefined);
      const mockAutocompleteInteraction = {
        options: {
          getFocused: jest.fn().mockReturnValue({ name: 'game', value: 'xyz' }),
        },
        respond: mockRespond,
      };

      const chain = createChainMock([]);
      mockDb.select.mockReturnValue(chain);

      await command.handleAutocomplete(
        mockAutocompleteInteraction as unknown as Parameters<
          typeof command.handleAutocomplete
        >[0],
      );

      expect(mockRespond).toHaveBeenCalledWith([]);
    });

    it('should not respond when focused field is not "game"', async () => {
      const mockRespond = jest.fn().mockResolvedValue(undefined);
      const mockAutocompleteInteraction = {
        options: {
          getFocused: jest
            .fn()
            .mockReturnValue({ name: 'time', value: 'tonight' }),
        },
        respond: mockRespond,
      };

      await command.handleAutocomplete(
        mockAutocompleteInteraction as unknown as Parameters<
          typeof command.handleAutocomplete
        >[0],
      );

      expect(mockRespond).not.toHaveBeenCalled();
    });

    it('should use game name as both name and value in respond', async () => {
      const mockRespond = jest.fn().mockResolvedValue(undefined);
      const mockAutocompleteInteraction = {
        options: {
          getFocused: jest.fn().mockReturnValue({ name: 'game', value: 'ff' }),
        },
        respond: mockRespond,
      };

      const chain = createChainMock([
        { id: 'ff-uuid', name: 'Final Fantasy XIV' },
      ]);
      mockDb.select.mockReturnValue(chain);

      await command.handleAutocomplete(
        mockAutocompleteInteraction as unknown as Parameters<
          typeof command.handleAutocomplete
        >[0],
      );

      const callArgs = (mockRespond.mock.calls as unknown[][])[0][0] as {
        name: string;
        value: string;
      }[];
      expect(callArgs[0].name).toBe('Final Fantasy XIV');
      expect(callArgs[0].value).toBe('Final Fantasy XIV');
    });
  });
});
