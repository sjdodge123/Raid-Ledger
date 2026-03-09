import { Test, TestingModule } from '@nestjs/testing';
import { EventCreateCommand } from './event-create.command';
import { EventsService } from '../../events/events.service';
import { UsersService } from '../../users/users.service';
import { PreferencesService } from '../../users/preferences.service';
import { SettingsService } from '../../settings/settings.service';
import { MagicLinkService } from '../../auth/magic-link.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { ApplicationCommandOptionType, MessageFlags } from 'discord.js';

const originalClientUrl = process.env.CLIENT_URL;
const mockUser = { id: 1, username: 'testuser', role: 'member' as const };
const mockGame = { id: 1, name: 'WoW', coverUrl: null };

const mockCreatedEvent = {
  id: 42,
  title: 'Test Raid',
  startTime: '2030-12-25T20:00:00.000Z',
  endTime: '2030-12-25T22:00:00.000Z',
  signupCount: 0,
  maxAttendees: 20,
  game: { name: 'WoW', coverUrl: null },
};

function createChainMock(resolvedValue: unknown[] = []) {
  const chain: Record<string, jest.Mock> = {};
  chain.from = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockReturnValue(chain);
  chain.limit = jest.fn().mockResolvedValue(resolvedValue);
  chain.values = jest.fn().mockReturnValue(chain);
  chain.returning = jest.fn().mockResolvedValue(resolvedValue);
  return chain;
}

type InteractionOpts = {
  title?: string;
  game?: string;
  time?: string;
  slots?: number | null;
  discordId?: string;
  subcommand?: string;
};

function makeInteraction(options: InteractionOpts = {}) {
  return {
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
  };
}

type HandleParam = Parameters<EventCreateCommand['handleInteraction']>[0];

function castInteraction(interaction: ReturnType<typeof makeInteraction>) {
  return interaction as unknown as HandleParam;
}

function makeModuleProviders(mockDb: { select: jest.Mock; insert: jest.Mock }) {
  return [
    EventCreateCommand,
    { provide: DrizzleAsyncProvider, useValue: mockDb },
    {
      provide: EventsService,
      useValue: { create: jest.fn().mockResolvedValue(mockCreatedEvent) },
    },
    {
      provide: UsersService,
      useValue: { findByDiscordId: jest.fn().mockResolvedValue(mockUser) },
    },
    {
      provide: PreferencesService,
      useValue: { getUserPreference: jest.fn().mockResolvedValue(null) },
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
      useValue: { generateLink: jest.fn().mockResolvedValue(null) },
    },
  ];
}

async function buildModule(mockDb: { select: jest.Mock; insert: jest.Mock }) {
  return Test.createTestingModule({
    providers: makeModuleProviders(mockDb),
  }).compile();
}

function getEmbedDescription(interaction: ReturnType<typeof makeInteraction>) {
  const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
    embeds: { data: { description?: string } }[];
  };
  return call.embeds[0].data.description;
}

function getComponents(interaction: ReturnType<typeof makeInteraction>) {
  const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
    components: unknown[];
  };
  return call.components;
}

function restoreClientUrl() {
  if (originalClientUrl !== undefined) {
    process.env.CLIENT_URL = originalClientUrl;
  } else {
    delete process.env.CLIENT_URL;
  }
}

function makeDefaultMockDb() {
  return {
    select: jest.fn().mockReturnValue(createChainMock([mockGame])),
    insert: jest.fn().mockReturnValue(createChainMock()),
  };
}

describe('EventCreateCommand — definition', () => {
  let command: EventCreateCommand;
  let module: TestingModule;

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    module = await buildModule(makeDefaultMockDb());
    command = module.get(EventCreateCommand);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();
    restoreClientUrl();
  });

  it('should return a command definition named "event"', () => {
    expect(command.getDefinition().name).toBe('event');
  });

  it('should have a create subcommand', () => {
    const options = command.getDefinition().options ?? [];
    const createSub = options.find(
      (o) =>
        o.name === 'create' &&
        o.type === ApplicationCommandOptionType.Subcommand,
    );
    expect(createSub).toBeDefined();
  });
});

describe('EventCreateCommand — subcommand routing', () => {
  let command: EventCreateCommand;
  let module: TestingModule;

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    module = await buildModule(makeDefaultMockDb());
    command = module.get(EventCreateCommand);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();
    restoreClientUrl();
  });

  it('should call handleCreate for "create" subcommand', async () => {
    const interaction = makeInteraction({ subcommand: 'create' });
    await command.handleInteraction(castInteraction(interaction));
    expect(interaction.deferReply).toHaveBeenCalled();
  });

  it('should do nothing for unknown subcommands', async () => {
    const interaction = makeInteraction({ subcommand: 'delete' });
    await command.handleInteraction(castInteraction(interaction));
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });
});

describe('EventCreateCommand — validation: defer & account', () => {
  let command: EventCreateCommand;
  let module: TestingModule;
  let eventsService: jest.Mocked<EventsService>;
  let usersService: jest.Mocked<UsersService>;

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    module = await buildModule(makeDefaultMockDb());
    command = module.get(EventCreateCommand);
    eventsService = module.get(EventsService);
    usersService = module.get(UsersService);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();
    restoreClientUrl();
  });

  it('should defer reply as ephemeral', async () => {
    const interaction = makeInteraction();
    await command.handleInteraction(castInteraction(interaction));
    expect(interaction.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should reply with account linking message when no account', async () => {
    usersService.findByDiscordId.mockResolvedValue(undefined);
    const interaction = makeInteraction();
    await command.handleInteraction(castInteraction(interaction));
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Raid Ledger account'),
    );
    expect(eventsService.create).not.toHaveBeenCalled();
  });
});

describe('EventCreateCommand — validation: time & creation errors', () => {
  let command: EventCreateCommand;
  let module: TestingModule;
  let eventsService: jest.Mocked<EventsService>;

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    module = await buildModule(makeDefaultMockDb());
    command = module.get(EventCreateCommand);
    eventsService = module.get(EventsService);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();
    restoreClientUrl();
  });

  it('should reply with error when time cannot be parsed', async () => {
    const interaction = makeInteraction({ time: 'not a valid time xyz' });
    await command.handleInteraction(castInteraction(interaction));
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Could not parse time'),
    );
    expect(eventsService.create).not.toHaveBeenCalled();
  });

  it('should include the unparseable time input in the error', async () => {
    const badTime = 'not a valid time xyz';
    const interaction = makeInteraction({ time: badTime });
    await command.handleInteraction(castInteraction(interaction));
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining(badTime),
    );
  });

  it('should reply with error when event creation fails', async () => {
    eventsService.create.mockRejectedValue(new Error('DB constraint error'));
    const interaction = makeInteraction();
    await command.handleInteraction(castInteraction(interaction));
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Failed to create event'),
    );
  });
});

describe('EventCreateCommand — create: time & slots', () => {
  let command: EventCreateCommand;
  let module: TestingModule;
  let eventsService: jest.Mocked<EventsService>;

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    module = await buildModule(makeDefaultMockDb());
    command = module.get(EventCreateCommand);
    eventsService = module.get(EventsService);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();
    restoreClientUrl();
  });

  it('should create with parsed start and 2-hour default end', async () => {
    const interaction = makeInteraction({ time: 'December 25, 2030 8pm' });
    await command.handleInteraction(castInteraction(interaction));
    const callArgs = (
      (eventsService.create as jest.Mock).mock.calls as unknown[][]
    )[0][1] as { startTime: string; endTime: string };
    const diff =
      new Date(callArgs.endTime).getTime() -
      new Date(callArgs.startTime).getTime();
    expect(diff).toBe(2 * 60 * 60 * 1000);
  });

  it('should use custom slots when provided', async () => {
    const interaction = makeInteraction({ slots: 15 });
    await command.handleInteraction(castInteraction(interaction));
    expect(eventsService.create).toHaveBeenCalledWith(
      mockUser.id,
      expect.objectContaining({ maxAttendees: 15 }),
    );
  });

  it('should use default 20 slots when null', async () => {
    const interaction = makeInteraction({ slots: null });
    await command.handleInteraction(castInteraction(interaction));
    expect(eventsService.create).toHaveBeenCalledWith(
      mockUser.id,
      expect.objectContaining({ maxAttendees: 20 }),
    );
  });
});

describe('EventCreateCommand — create: game & embed', () => {
  let command: EventCreateCommand;
  let module: TestingModule;
  let eventsService: jest.Mocked<EventsService>;
  let mockDb: { select: jest.Mock; insert: jest.Mock };

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    mockDb = makeDefaultMockDb();
    module = await buildModule(mockDb);
    command = module.get(EventCreateCommand);
    eventsService = module.get(EventsService);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();
    restoreClientUrl();
  });

  it('should attach game registry ID when found', async () => {
    const interaction = makeInteraction();
    await command.handleInteraction(castInteraction(interaction));
    expect(eventsService.create).toHaveBeenCalledWith(
      mockUser.id,
      expect.objectContaining({ gameId: 1 }),
    );
  });

  it('should create without game ID when not found', async () => {
    mockDb.select.mockReturnValue(createChainMock([]));
    const interaction = makeInteraction({ game: 'Unknown Game' });
    await command.handleInteraction(castInteraction(interaction));
    expect(eventsService.create).toHaveBeenCalledWith(
      mockUser.id,
      expect.objectContaining({ gameId: undefined }),
    );
  });

  it('should reply with ephemeral confirmation embed', async () => {
    const interaction = makeInteraction();
    await command.handleInteraction(castInteraction(interaction));
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.arrayContaining([expect.anything()]) as unknown,
      }),
    );
  });
});

describe('EventCreateCommand — timezone: explicit tz', () => {
  let command: EventCreateCommand;
  let module: TestingModule;
  let settingsService: jest.Mocked<SettingsService>;

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    module = await buildModule(makeDefaultMockDb());
    command = module.get(EventCreateCommand);
    settingsService = module.get(SettingsService);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();
    restoreClientUrl();
  });

  it('should include timezone in the confirmation embed', async () => {
    settingsService.get.mockResolvedValue('America/New_York');
    const interaction = makeInteraction();
    await command.handleInteraction(castInteraction(interaction));
    expect(getEmbedDescription(interaction)).toContain('America/New_York');
  });
});

describe('EventCreateCommand — timezone: user preference', () => {
  let command: EventCreateCommand;
  let module: TestingModule;
  let preferencesService: jest.Mocked<PreferencesService>;
  let settingsService: jest.Mocked<SettingsService>;

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    module = await buildModule(makeDefaultMockDb());
    command = module.get(EventCreateCommand);
    preferencesService = module.get(PreferencesService);
    settingsService = module.get(SettingsService);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();
    restoreClientUrl();
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
    await command.handleInteraction(castInteraction(interaction));
    expect(getEmbedDescription(interaction)).toContain('America/New_York');
  });

  it('should fall back to community default when preference is auto', async () => {
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
    await command.handleInteraction(castInteraction(interaction));
    expect(getEmbedDescription(interaction)).toContain('America/Chicago');
  });

  it('should fall back to America/New_York when both unavailable', async () => {
    preferencesService.getUserPreference.mockResolvedValue(undefined);
    settingsService.get.mockResolvedValue(null);
    const interaction = makeInteraction();
    await command.handleInteraction(castInteraction(interaction));
    expect(getEmbedDescription(interaction)).toContain('America/New_York');
  });
});

describe('EventCreateCommand — magic link button present', () => {
  let command: EventCreateCommand;
  let module: TestingModule;
  let magicLinkService: jest.Mocked<MagicLinkService>;

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    module = await buildModule(makeDefaultMockDb());
    command = module.get(EventCreateCommand);
    magicLinkService = module.get(MagicLinkService);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();
    restoreClientUrl();
  });

  it('should include button when CLIENT_URL is set and link generated', async () => {
    process.env.CLIENT_URL = 'https://raidledger.com';
    magicLinkService.generateLink.mockResolvedValue(
      'https://raidledger.com/events/42/edit?token=abc',
    );
    const interaction = makeInteraction();
    await command.handleInteraction(castInteraction(interaction));
    expect(getComponents(interaction).length).toBeGreaterThan(0);
  });
});

describe('EventCreateCommand — magic link button absent', () => {
  let command: EventCreateCommand;
  let module: TestingModule;
  let magicLinkService: jest.Mocked<MagicLinkService>;

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    module = await buildModule(makeDefaultMockDb());
    command = module.get(EventCreateCommand);
    magicLinkService = module.get(MagicLinkService);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();
    restoreClientUrl();
  });

  it('should not include button when CLIENT_URL is not set', async () => {
    delete process.env.CLIENT_URL;
    const interaction = makeInteraction();
    await command.handleInteraction(castInteraction(interaction));
    expect(getComponents(interaction)).toHaveLength(0);
  });

  it('should not include button when magic link returns null', async () => {
    process.env.CLIENT_URL = 'https://raidledger.com';
    magicLinkService.generateLink.mockResolvedValue(null);
    const interaction = makeInteraction();
    await command.handleInteraction(castInteraction(interaction));
    expect(getComponents(interaction)).toHaveLength(0);
  });
});

describe('EventCreateCommand — autocomplete: game match', () => {
  let command: EventCreateCommand;
  let module: TestingModule;
  let mockDb: { select: jest.Mock; insert: jest.Mock };

  type AutocompleteParam = Parameters<
    EventCreateCommand['handleAutocomplete']
  >[0];

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    mockDb = makeDefaultMockDb();
    module = await buildModule(mockDb);
    command = module.get(EventCreateCommand);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();
    restoreClientUrl();
  });

  it('should respond with matching games for "game" field', async () => {
    const mockRespond = jest.fn().mockResolvedValue(undefined);
    mockDb.select.mockReturnValue(
      createChainMock([{ id: 'game-1', name: 'World of Warcraft' }]),
    );
    const interaction = {
      options: {
        getFocused: jest
          .fn()
          .mockReturnValue({ name: 'game', value: 'world-of-warcraft' }),
      },
      respond: mockRespond,
    };
    await command.handleAutocomplete(
      interaction as unknown as AutocompleteParam,
    );
    expect(mockRespond).toHaveBeenCalledWith([
      { name: 'World of Warcraft', value: 'World of Warcraft' },
    ]);
  });

  it('should respond with empty array when no games match', async () => {
    const mockRespond = jest.fn().mockResolvedValue(undefined);
    mockDb.select.mockReturnValue(createChainMock([]));
    const interaction = {
      options: {
        getFocused: jest.fn().mockReturnValue({ name: 'game', value: 'xyz' }),
      },
      respond: mockRespond,
    };
    await command.handleAutocomplete(
      interaction as unknown as AutocompleteParam,
    );
    expect(mockRespond).toHaveBeenCalledWith([]);
  });
});

describe('EventCreateCommand — autocomplete: non-game & format', () => {
  let command: EventCreateCommand;
  let module: TestingModule;
  let mockDb: { select: jest.Mock; insert: jest.Mock };

  type AutocompleteParam = Parameters<
    EventCreateCommand['handleAutocomplete']
  >[0];

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    mockDb = makeDefaultMockDb();
    module = await buildModule(mockDb);
    command = module.get(EventCreateCommand);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();
    restoreClientUrl();
  });

  it('should not respond when focused field is not "game"', async () => {
    const mockRespond = jest.fn().mockResolvedValue(undefined);
    const interaction = {
      options: {
        getFocused: jest
          .fn()
          .mockReturnValue({ name: 'time', value: 'tonight' }),
      },
      respond: mockRespond,
    };
    await command.handleAutocomplete(
      interaction as unknown as AutocompleteParam,
    );
    expect(mockRespond).not.toHaveBeenCalled();
  });

  it('should use game name as both name and value', async () => {
    const mockRespond = jest.fn().mockResolvedValue(undefined);
    mockDb.select.mockReturnValue(
      createChainMock([{ id: 'ff-uuid', name: 'Final Fantasy XIV' }]),
    );
    const interaction = {
      options: {
        getFocused: jest.fn().mockReturnValue({ name: 'game', value: 'ff' }),
      },
      respond: mockRespond,
    };
    await command.handleAutocomplete(
      interaction as unknown as AutocompleteParam,
    );
    const callArgs = (mockRespond.mock.calls as unknown[][])[0][0] as {
      name: string;
      value: string;
    }[];
    expect(callArgs[0].name).toBe('Final Fantasy XIV');
    expect(callArgs[0].value).toBe('Final Fantasy XIV');
  });
});
