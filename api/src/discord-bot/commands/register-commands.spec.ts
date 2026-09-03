import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
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
      get: jest.fn().mockResolvedValue([]),
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

function makeProviders(mockRestPut: jest.Mock, mockRestGet?: jest.Mock) {
  (REST as unknown as jest.Mock).mockImplementation(() => ({
    setToken: jest.fn().mockReturnThis(),
    put: mockRestPut,
    get: mockRestGet ?? jest.fn().mockResolvedValue([]),
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

async function buildModule(mockRestPut: jest.Mock, mockRestGet?: jest.Mock) {
  const providers = makeProviders(mockRestPut, mockRestGet);
  return Test.createTestingModule({ providers }).compile();
}

const FLEET_ID_ENV = 'RL_SLOT_DISCORD_CLIENT_ID';
const FLEET_NAME_ENV = 'RL_SLOT_DISCORD_APP_NAME';

type PutCall = [string, { body: unknown[] }];

function putCalls(put: jest.Mock): PutCall[] {
  return put.mock.calls as unknown as PutCall[];
}

/** Bodies actually PUT to one route, flattened — the shape assertions read. */
function bodiesPutTo(put: jest.Mock, route: string): unknown[] {
  return putCalls(put)
    .filter(([r]) => r === route)
    .flatMap(([, opts]) => opts.body);
}

/** Every command body PUT anywhere, for "registered nothing" assertions. */
function allBodiesPut(put: jest.Mock): unknown[] {
  return putCalls(put).flatMap(([, opts]) => opts.body);
}

function joinedLoggerCalls(spy: jest.SpyInstance): string {
  const calls = spy.mock.calls as unknown as unknown[][];
  return calls.map((args) => args.map((a) => String(a)).join(' ')).join('\n');
}

// Fleet mode is env-driven. A var leaked by another spec (or by the shell that
// launched jest) would silently flip every non-fleet expectation below, so it
// is cleared before EVERY test in this file; the fleet describe re-sets it.
beforeEach(() => {
  delete process.env[FLEET_ID_ENV];
  delete process.env[FLEET_NAME_ENV];
});

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

// --- A3-B P5 -----------------------------------------------------------------
// Slot bots (ROK-1469) registered GLOBALLY: four apps each contributed an
// identical /bind row to the test guild's picker, and those rows outlived the
// envs that made them. Picking a dead one gives "The application did not
// respond" with nothing in the live env's logs.
//
// Every assertion below is written to fail by NAMING the wrong bodies/route,
// not by timing out — revert `registerFleetGuildCommands` and each one reports
// the nine command objects landing on the global route.

describe('RegisterCommandsService — fleet slot bot registers guild-scoped', () => {
  let service: RegisterCommandsService;
  let clientService: jest.Mocked<DiscordBotClientService>;
  let mockRestPut: jest.Mock;
  let mockRestGet: jest.Mock;

  beforeEach(async () => {
    process.env[FLEET_ID_ENV] = 'client-456';
    process.env[FLEET_NAME_ENV] = 'Raid Ledger Slot 2';
    mockRestPut = jest.fn().mockResolvedValue({});
    mockRestGet = jest.fn().mockResolvedValue([]);
    const module: TestingModule = await buildModule(mockRestPut, mockRestGet);
    service = module.get(RegisterCommandsService);
    clientService = module.get(DiscordBotClientService);
  });

  afterEach(() => {
    delete process.env[FLEET_ID_ENV];
    delete process.env[FLEET_NAME_ENV];
    jest.clearAllMocks();
  });

  it('puts every command body on the GUILD route', async () => {
    await service.registerCommands();
    expect(bodiesPutTo(mockRestPut, '/guild-route')).toEqual(allCommandBodies);
  });

  it('puts NO command body on the global route', async () => {
    await service.registerCommands();
    // The global route may legitimately receive an empty body (stale cleanup),
    // but a command body here is the bug: it lands in every guild the app has
    // ever joined and survives env destroy.
    expect(bodiesPutTo(mockRestPut, '/global-route')).toEqual([]);
  });

  it('registers NOTHING at all when the slot bot is in no guild', async () => {
    clientService.getGuildId.mockReturnValue(null);
    const errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    await service.registerCommands();
    expect(allBodiesPut(mockRestPut)).toEqual([]);
    expect(joinedLoggerCalls(errorSpy)).toContain(
      'registering NO slash commands',
    );
    errorSpy.mockRestore();
  });

  it('deletes its own leftover GLOBAL registrations and names them', async () => {
    mockRestGet.mockResolvedValue([{ name: 'bind' }, { name: 'help' }]);
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    await service.registerCommands();
    expect(mockRestGet).toHaveBeenCalledWith('/global-route');
    expect(
      putCalls(mockRestPut).filter(([route]) => route === '/global-route'),
    ).toEqual([['/global-route', { body: [] }]]);
    expect(joinedLoggerCalls(warnSpy)).toContain('bind, help');
    warnSpy.mockRestore();
  });

  it('logs an ERROR when the injected client id is not the logged-in app', async () => {
    // env-spin injected slot 3's application id but slot 2's bot token: OAuth
    // and the slash commands then belong to two different applications, which
    // is the one cross-application ambiguity a running env CAN observe.
    process.env[FLEET_ID_ENV] = 'declared-999';
    const errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    await service.registerCommands();
    const logged = joinedLoggerCalls(errorSpy);
    expect(logged).toContain('declared-999');
    expect(logged).toContain('client-456');
    errorSpy.mockRestore();
  });

  it('survives a failure to read existing global commands', async () => {
    mockRestGet.mockRejectedValue(new Error('403 Missing Access'));
    await expect(service.registerCommands()).resolves.not.toThrow();
    expect(bodiesPutTo(mockRestPut, '/guild-route')).toEqual(allCommandBodies);
  });
});

describe('RegisterCommandsService — production path is untouched', () => {
  let service: RegisterCommandsService;
  let mockRestPut: jest.Mock;

  beforeEach(async () => {
    mockRestPut = jest.fn().mockResolvedValue({});
    const module: TestingModule = await buildModule(mockRestPut);
    service = module.get(RegisterCommandsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('still registers globally with no slot identity in the environment', async () => {
    expect(process.env[FLEET_ID_ENV]).toBeUndefined();
    await service.registerCommands();
    expect(bodiesPutTo(mockRestPut, '/global-route')).toEqual(allCommandBodies);
    // Guild route is still only ever used to CLEAR, never to register.
    expect(bodiesPutTo(mockRestPut, '/guild-route')).toEqual([]);
  });
});
