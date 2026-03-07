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

const mockBotConfig = { token: 'bot-token-123', enabled: true };

function makeMockCommand(name: string, description: string) {
  return {
    commandName: name,
    getDefinition: jest.fn().mockReturnValue({ name, description }),
    handleInteraction: jest.fn(),
    handleAutocomplete: jest.fn(),
  };
}

const allCommandBodies = [
  { name: 'event', description: 'Event commands' },
  { name: 'events', description: 'List events' },
  { name: 'roster', description: 'View roster' },
  { name: 'bind', description: 'Bind channel' },
  { name: 'unbind', description: 'Unbind channel' },
  { name: 'bindings', description: 'List bindings' },
  { name: 'invite', description: 'Invite user to event' },
  { name: 'help', description: 'List all available bot commands' },
  { name: 'playing', description: 'Set what game you are playing' },
];

const commandClassMap: Record<string, unknown> = {
  event: EventCreateCommand,
  events: EventsListCommand,
  roster: RosterViewCommand,
  bind: BindCommand,
  unbind: UnbindCommand,
  bindings: BindingsCommand,
  invite: InviteCommand,
  help: HelpCommand,
  playing: PlayingCommand,
};

function makeProviders(mockRestPut: jest.Mock) {
  (REST as unknown as jest.Mock).mockImplementation(() => ({
    setToken: jest.fn().mockReturnThis(),
    put: mockRestPut,
  }));
  return [
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
    ...allCommandBodies.map((cmd) => ({
      provide: commandClassMap[cmd.name]! as string,
      useValue: makeMockCommand(cmd.name, cmd.description),
    })),
  ];
}

async function buildModule(mockRestPut: jest.Mock) {
  const providers = makeProviders(mockRestPut);
  return Test.createTestingModule({ providers }).compile();
}

describe('RegisterCommandsService — global registration', () => {
  let service: RegisterCommandsService;
  let settingsService: jest.Mocked<SettingsService>;
  let mockRestPut: jest.Mock;

  beforeEach(async () => {
    mockRestPut = jest.fn().mockResolvedValue({});
    const module: TestingModule = await buildModule(mockRestPut);
    service = module.get(RegisterCommandsService);
    settingsService = module.get(SettingsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should register all commands globally', async () => {
    await service.registerCommands();
    expect(settingsService.getDiscordBotConfig).toHaveBeenCalled();
    expect(Routes.applicationCommands).toHaveBeenCalledWith('client-456');
    expect(mockRestPut).toHaveBeenCalledWith('/global-route', {
      body: allCommandBodies,
    });
  });

  it('should still register globally when no guild is found', async () => {
    const clientService = (service as any)
      .clientService as jest.Mocked<DiscordBotClientService>;
    clientService.getGuildId.mockReturnValue(null);
    await service.registerCommands();
    expect(mockRestPut).toHaveBeenCalledWith('/global-route', {
      body: allCommandBodies,
    });
    expect(Routes.applicationGuildCommands).not.toHaveBeenCalled();
  });
});

describe('RegisterCommandsService — skip conditions', () => {
  let service: RegisterCommandsService;
  let clientService: jest.Mocked<DiscordBotClientService>;
  let settingsService: jest.Mocked<SettingsService>;
  let mockRestPut: jest.Mock;

  beforeEach(async () => {
    mockRestPut = jest.fn().mockResolvedValue({});
    const module: TestingModule = await buildModule(mockRestPut);
    service = module.get(RegisterCommandsService);
    clientService = module.get(DiscordBotClientService);
    settingsService = module.get(SettingsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should skip registration when no bot config', async () => {
    (settingsService.getDiscordBotConfig as jest.Mock).mockResolvedValue(null);
    await service.registerCommands();
    expect(mockRestPut).not.toHaveBeenCalled();
  });

  it('should skip registration when client ID is not available', async () => {
    clientService.getClientId.mockReturnValue(null);
    await service.registerCommands();
    expect(mockRestPut).not.toHaveBeenCalled();
  });

  it('should handle REST API errors gracefully', async () => {
    mockRestPut.mockRejectedValue(new Error('Discord API error'));
    await expect(service.registerCommands()).resolves.not.toThrow();
  });
});

describe('RegisterCommandsService — guild commands & REST', () => {
  let service: RegisterCommandsService;
  let clientService: jest.Mocked<DiscordBotClientService>;
  let mockRestPut: jest.Mock;

  beforeEach(async () => {
    mockRestPut = jest.fn().mockResolvedValue({});
    const module: TestingModule = await buildModule(mockRestPut);
    service = module.get(RegisterCommandsService);
    clientService = module.get(DiscordBotClientService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should clear stale guild commands when guild is set', async () => {
    clientService.getGuildId.mockReturnValue('my-guild-id');
    clientService.getClientId.mockReturnValue('my-client-id');
    await service.registerCommands();
    expect(Routes.applicationCommands).toHaveBeenCalledWith('my-client-id');
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
