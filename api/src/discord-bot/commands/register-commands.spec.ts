/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { RegisterCommandsService } from './register-commands';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { SettingsService } from '../../settings/settings.service';
import { EventCreateCommand } from './event-create.command';
import { EventsListCommand } from './events-list.command';
import { RosterViewCommand } from './roster-view.command';
import { BindCommand } from './bind.command';
import { UnbindCommand } from './unbind.command';
import { BindingsCommand } from './bindings.command';
import { InviteCommand } from './invite.command';
import { HelpCommand } from './help.command';
import { PlayingCommand } from './playing.command';
import { REST, Routes } from 'discord.js';

// Mock discord.js REST
jest.mock('discord.js', () => {
  const actual = jest.requireActual<typeof import('discord.js')>('discord.js');
  return {
    ...actual,
    REST: jest.fn().mockImplementation(() => ({
      setToken: jest.fn().mockReturnThis(),
      put: jest.fn().mockResolvedValue({}),
    })),
    Routes: {
      applicationCommands: jest.fn().mockReturnValue('/global-route'),
      applicationGuildCommands: jest.fn().mockReturnValue('/guild-route'),
    },
  };
});

describe('RegisterCommandsService', () => {
  let service: RegisterCommandsService;
  let clientService: jest.Mocked<DiscordBotClientService>;
  let settingsService: jest.Mocked<SettingsService>;
  let mockEventCreateCommand: jest.Mocked<EventCreateCommand>;
  let mockEventsListCommand: jest.Mocked<EventsListCommand>;
  let mockRosterViewCommand: jest.Mocked<RosterViewCommand>;
  let mockRestPut: jest.Mock;

  const mockBotConfig = {
    token: 'bot-token-123',
    enabled: true,
  };

  beforeEach(async () => {
    mockRestPut = jest.fn().mockResolvedValue({});

    (REST as unknown as jest.Mock).mockImplementation(() => ({
      setToken: jest.fn().mockReturnThis(),
      put: mockRestPut,
    }));

    mockEventCreateCommand = {
      commandName: 'event',
      getDefinition: jest
        .fn()
        .mockReturnValue({ name: 'event', description: 'Event commands' }),
      handleInteraction: jest.fn(),
      handleAutocomplete: jest.fn(),
    } as unknown as jest.Mocked<EventCreateCommand>;

    mockEventsListCommand = {
      commandName: 'events',
      getDefinition: jest
        .fn()
        .mockReturnValue({ name: 'events', description: 'List events' }),
      handleInteraction: jest.fn(),
    } as unknown as jest.Mocked<EventsListCommand>;

    mockRosterViewCommand = {
      commandName: 'roster',
      getDefinition: jest
        .fn()
        .mockReturnValue({ name: 'roster', description: 'View roster' }),
      handleInteraction: jest.fn(),
      handleAutocomplete: jest.fn(),
    } as unknown as jest.Mocked<RosterViewCommand>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegisterCommandsService,
        {
          provide: DiscordBotClientService,
          useValue: {
            getGuildId: jest.fn().mockReturnValue('guild-123'),
            getClientId: jest.fn().mockReturnValue('client-456'),
          },
        },
        {
          provide: SettingsService,
          useValue: {
            getDiscordBotConfig: jest.fn().mockResolvedValue(mockBotConfig),
          },
        },
        {
          provide: EventCreateCommand,
          useValue: mockEventCreateCommand,
        },
        {
          provide: EventsListCommand,
          useValue: mockEventsListCommand,
        },
        {
          provide: RosterViewCommand,
          useValue: mockRosterViewCommand,
        },
        {
          provide: BindCommand,
          useValue: {
            commandName: 'bind',
            getDefinition: jest
              .fn()
              .mockReturnValue({ name: 'bind', description: 'Bind channel' }),
          },
        },
        {
          provide: UnbindCommand,
          useValue: {
            commandName: 'unbind',
            getDefinition: jest.fn().mockReturnValue({
              name: 'unbind',
              description: 'Unbind channel',
            }),
          },
        },
        {
          provide: BindingsCommand,
          useValue: {
            commandName: 'bindings',
            getDefinition: jest.fn().mockReturnValue({
              name: 'bindings',
              description: 'List bindings',
            }),
          },
        },
        {
          provide: InviteCommand,
          useValue: {
            commandName: 'invite',
            getDefinition: jest.fn().mockReturnValue({
              name: 'invite',
              description: 'Invite user to event',
            }),
          },
        },
        {
          provide: HelpCommand,
          useValue: {
            commandName: 'help',
            getDefinition: jest.fn().mockReturnValue({
              name: 'help',
              description: 'List all available bot commands',
            }),
          },
        },
        {
          provide: PlayingCommand,
          useValue: {
            commandName: 'playing',
            getDefinition: jest.fn().mockReturnValue({
              name: 'playing',
              description: 'Set what game you are playing',
            }),
          },
        },
      ],
    }).compile();

    service = module.get(RegisterCommandsService);
    clientService = module.get(DiscordBotClientService);
    settingsService = module.get(SettingsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('registerCommands', () => {
    it('should register all commands globally when config is available', async () => {
      await service.registerCommands();

      expect(settingsService.getDiscordBotConfig).toHaveBeenCalled();
      expect(mockEventCreateCommand.getDefinition).toHaveBeenCalled();
      expect(mockEventsListCommand.getDefinition).toHaveBeenCalled();
      expect(mockRosterViewCommand.getDefinition).toHaveBeenCalled();
      expect(Routes.applicationCommands).toHaveBeenCalledWith('client-456');
      expect(mockRestPut).toHaveBeenCalledWith('/global-route', {
        body: [
          { name: 'event', description: 'Event commands' },
          { name: 'events', description: 'List events' },
          { name: 'roster', description: 'View roster' },
          { name: 'bind', description: 'Bind channel' },
          { name: 'unbind', description: 'Unbind channel' },
          { name: 'bindings', description: 'List bindings' },
          { name: 'invite', description: 'Invite user to event' },
          { name: 'help', description: 'List all available bot commands' },
          { name: 'playing', description: 'Set what game you are playing' },
        ],
      });
    });

    it('should still register globally when no guild is found (skip guild cleanup)', async () => {
      clientService.getGuildId.mockReturnValue(null);

      await service.registerCommands();

      expect(settingsService.getDiscordBotConfig).toHaveBeenCalled();
      // Global registration still happens
      expect(mockRestPut).toHaveBeenCalledWith('/global-route', {
        body: [
          { name: 'event', description: 'Event commands' },
          { name: 'events', description: 'List events' },
          { name: 'roster', description: 'View roster' },
          { name: 'bind', description: 'Bind channel' },
          { name: 'unbind', description: 'Unbind channel' },
          { name: 'bindings', description: 'List bindings' },
          { name: 'invite', description: 'Invite user to event' },
          { name: 'help', description: 'List all available bot commands' },
          { name: 'playing', description: 'Set what game you are playing' },
        ],
      });
      // Guild cleanup is skipped
      expect(Routes.applicationGuildCommands).not.toHaveBeenCalled();
    });

    it('should skip registration when no bot config is found', async () => {
      (settingsService.getDiscordBotConfig as jest.Mock).mockResolvedValue(
        null,
      );

      await service.registerCommands();

      expect(mockRestPut).not.toHaveBeenCalled();
    });

    it('should skip registration when client ID is not available', async () => {
      clientService.getClientId.mockReturnValue(null);

      await service.registerCommands();

      expect(mockRestPut).not.toHaveBeenCalled();
    });

    it('should handle REST API errors gracefully without throwing', async () => {
      mockRestPut.mockRejectedValue(new Error('Discord API error'));

      // Should not throw
      await expect(service.registerCommands()).resolves.not.toThrow();
    });

    it('should register globally with client ID and clear stale guild commands', async () => {
      clientService.getGuildId.mockReturnValue('my-guild-id');
      clientService.getClientId.mockReturnValue('my-client-id');

      await service.registerCommands();

      // Global registration uses only clientId
      expect(Routes.applicationCommands).toHaveBeenCalledWith('my-client-id');
      // Stale guild commands are cleared
      expect(Routes.applicationGuildCommands).toHaveBeenCalledWith(
        'my-client-id',
        'my-guild-id',
      );
    });

    it('should create REST client with bot token from config', async () => {
      await service.registerCommands();

      expect(REST).toHaveBeenCalledWith({ version: '10' });
    });
  });
});
