import { Test, TestingModule } from '@nestjs/testing';
import { RosterViewCommand } from './roster-view.command';
import { SignupsService } from '../../events/signups.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { DiscordEmojiService } from '../services/discord-emoji.service';
import { EMBED_COLORS } from '../discord-bot.constants';

const originalClientUrl = process.env.CLIENT_URL;

type RosterReturn = Awaited<
  ReturnType<SignupsService['getRosterWithAssignments']>
>;
type HandleParam = Parameters<RosterViewCommand['handleInteraction']>[0];
type AutocompleteParam = Parameters<RosterViewCommand['handleAutocomplete']>[0];

const mockInteraction = (eventInput: string) => ({
  deferReply: jest.fn().mockResolvedValue(undefined),
  editReply: jest.fn().mockResolvedValue(undefined),
  options: { getString: jest.fn().mockReturnValue(eventInput) },
});

function makeRoster(
  assignments: { slot: string | null; username: string }[] = [],
  pool: { username: string }[] = [],
  slots: Record<string, number> | null = null,
) {
  return { assignments, pool, slots };
}

function createChainMock(resolvedValue: unknown[] = []) {
  const chain: Record<string, jest.Mock> = {};
  chain.from = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockReturnValue(chain);
  chain.limit = jest.fn().mockResolvedValue(resolvedValue);
  chain.orderBy = jest.fn().mockReturnValue(chain);
  return chain;
}

function makeEmojiService() {
  return {
    getRoleEmoji: jest.fn((role: string) => {
      const map: Record<string, string> = {
        tank: '\uD83D\uDEE1\uFE0F',
        healer: '\uD83D\uDC9A',
        dps: '\u2694\uFE0F',
      };
      return map[role] ?? '';
    }),
    isUsingCustomEmojis: jest.fn(() => false),
  };
}

async function buildModule(mockDb: { select: jest.Mock }) {
  return Test.createTestingModule({
    providers: [
      RosterViewCommand,
      { provide: DrizzleAsyncProvider, useValue: mockDb },
      {
        provide: SignupsService,
        useValue: { getRosterWithAssignments: jest.fn() },
      },
      { provide: DiscordEmojiService, useValue: makeEmojiService() },
    ],
  }).compile();
}

function getEmbedDescription(interaction: ReturnType<typeof mockInteraction>) {
  const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
    embeds: { data: { description?: string } }[];
  };
  return call.embeds[0].data.description ?? '';
}

function restoreClientUrl() {
  if (originalClientUrl !== undefined) {
    process.env.CLIENT_URL = originalClientUrl;
  } else {
    delete process.env.CLIENT_URL;
  }
}

function makeDefaultDb() {
  return { select: jest.fn().mockReturnValue(createChainMock()) };
}

describe('RosterViewCommand — definition', () => {
  let command: RosterViewCommand;
  let module: TestingModule;

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    module = await buildModule(makeDefaultDb());
    command = module.get(RosterViewCommand);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();
    restoreClientUrl();
  });

  it('should return a command definition named "roster"', () => {
    expect(command.getDefinition().name).toBe('roster');
  });

  it('should have required "event" option', () => {
    const options = command.getDefinition().options ?? [];
    expect(options.find((o) => o.name === 'event')).toBeDefined();
  });
});

describe('RosterViewCommand — defer & numeric ID', () => {
  let command: RosterViewCommand;
  let module: TestingModule;
  let signupsService: jest.Mocked<SignupsService>;
  let mockDb: { select: jest.Mock };

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    mockDb = makeDefaultDb();
    module = await buildModule(mockDb);
    command = module.get(RosterViewCommand);
    signupsService = module.get(SignupsService);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();
    restoreClientUrl();
  });

  it('should defer reply as ephemeral', async () => {
    const interaction = mockInteraction('42');
    mockDb.select.mockReturnValue(
      createChainMock([{ title: 'Test Raid', maxAttendees: 20 }]),
    );
    signupsService.getRosterWithAssignments.mockResolvedValue(
      makeRoster() as unknown as RosterReturn,
    );
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
  });

  it('should resolve event by numeric ID', async () => {
    const interaction = mockInteraction('42');
    mockDb.select.mockReturnValue(
      createChainMock([{ title: 'Test Raid', maxAttendees: 20 }]),
    );
    signupsService.getRosterWithAssignments.mockResolvedValue(
      makeRoster() as unknown as RosterReturn,
    );
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(signupsService.getRosterWithAssignments).toHaveBeenCalledWith(42);
  });
});

describe('RosterViewCommand — title search', () => {
  let command: RosterViewCommand;
  let module: TestingModule;
  let signupsService: jest.Mocked<SignupsService>;
  let mockDb: { select: jest.Mock };

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    mockDb = makeDefaultDb();
    module = await buildModule(mockDb);
    command = module.get(RosterViewCommand);
    signupsService = module.get(SignupsService);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();
    restoreClientUrl();
  });

  it('should search by title when input is not a number', async () => {
    const interaction = mockInteraction('Test Raid');
    const searchChain = createChainMock([{ id: 99 }]);
    const detailChain = createChainMock([
      { title: 'Test Raid', maxAttendees: 20 },
    ]);
    mockDb.select
      .mockReturnValueOnce(searchChain)
      .mockReturnValueOnce(detailChain);
    signupsService.getRosterWithAssignments.mockResolvedValue(
      makeRoster() as unknown as RosterReturn,
    );
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(signupsService.getRosterWithAssignments).toHaveBeenCalledWith(99);
  });
});

describe('RosterViewCommand — not found: title', () => {
  let command: RosterViewCommand;
  let module: TestingModule;
  let signupsService: jest.Mocked<SignupsService>;
  let mockDb: { select: jest.Mock };

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    mockDb = makeDefaultDb();
    module = await buildModule(mockDb);
    command = module.get(RosterViewCommand);
    signupsService = module.get(SignupsService);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();
    restoreClientUrl();
  });

  it('should reply not found when title search empty', async () => {
    const interaction = mockInteraction('Unknown Event');
    mockDb.select.mockReturnValue(createChainMock([]));
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(interaction.editReply).toHaveBeenCalledWith(
      'No event found matching "Unknown Event".',
    );
    expect(signupsService.getRosterWithAssignments).not.toHaveBeenCalled();
  });
});

describe('RosterViewCommand — not found: detail & errors', () => {
  let command: RosterViewCommand;
  let module: TestingModule;
  let signupsService: jest.Mocked<SignupsService>;
  let mockDb: { select: jest.Mock };

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    mockDb = makeDefaultDb();
    module = await buildModule(mockDb);
    command = module.get(RosterViewCommand);
    signupsService = module.get(SignupsService);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();
    restoreClientUrl();
  });

  it('should reply "Event not found" when detail query returns nothing', async () => {
    const interaction = mockInteraction('42');
    signupsService.getRosterWithAssignments.mockResolvedValue(
      makeRoster() as unknown as RosterReturn,
    );
    mockDb.select.mockReturnValue(createChainMock([]));
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(interaction.editReply).toHaveBeenCalledWith('Event not found.');
  });

  it('should handle service errors gracefully', async () => {
    const interaction = mockInteraction('42');
    signupsService.getRosterWithAssignments.mockRejectedValue(
      new Error('Database error'),
    );
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(interaction.editReply).toHaveBeenCalledWith(
      'Failed to fetch roster. Please try again later.',
    );
  });
});

describe('RosterViewCommand — roster: empty & grouped', () => {
  let command: RosterViewCommand;
  let module: TestingModule;
  let signupsService: jest.Mocked<SignupsService>;
  let mockDb: { select: jest.Mock };

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    mockDb = makeDefaultDb();
    module = await buildModule(mockDb);
    command = module.get(RosterViewCommand);
    signupsService = module.get(SignupsService);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();
    restoreClientUrl();
  });

  it('should show "No signups yet." when empty', async () => {
    const interaction = mockInteraction('42');
    mockDb.select.mockReturnValue(
      createChainMock([{ title: 'Empty Raid', maxAttendees: 20 }]),
    );
    signupsService.getRosterWithAssignments.mockResolvedValue(
      makeRoster([], []) as unknown as RosterReturn,
    );
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(getEmbedDescription(interaction)).toBe('No signups yet.');
  });

  it('should group assignments by role', async () => {
    const interaction = mockInteraction('42');
    mockDb.select.mockReturnValue(
      createChainMock([{ title: 'Test Raid', maxAttendees: 20 }]),
    );
    const roster = makeRoster(
      [
        { slot: 'tank', username: 'TankPlayer' },
        { slot: 'healer', username: 'HealerPlayer' },
        { slot: 'dps', username: 'DpsPlayer' },
      ],
      [],
      { tank: 2, healer: 3, dps: 5 },
    );
    signupsService.getRosterWithAssignments.mockResolvedValue(
      roster as unknown as RosterReturn,
    );
    await command.handleInteraction(interaction as unknown as HandleParam);
    const desc = getEmbedDescription(interaction);
    expect(desc).toContain('TankPlayer');
    expect(desc).toContain('HealerPlayer');
    expect(desc).toContain('DpsPlayer');
  });
});

describe('RosterViewCommand — roster: pool & color & footer', () => {
  let command: RosterViewCommand;
  let module: TestingModule;
  let signupsService: jest.Mocked<SignupsService>;
  let mockDb: { select: jest.Mock };

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    mockDb = makeDefaultDb();
    module = await buildModule(mockDb);
    command = module.get(RosterViewCommand);
    signupsService = module.get(SignupsService);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();
    restoreClientUrl();
  });

  it('should show unassigned pool members', async () => {
    const interaction = mockInteraction('42');
    mockDb.select.mockReturnValue(
      createChainMock([{ title: 'Test Raid', maxAttendees: 20 }]),
    );
    const roster = makeRoster([], [{ username: 'UnassignedPlayer' }], null);
    signupsService.getRosterWithAssignments.mockResolvedValue(
      roster as unknown as RosterReturn,
    );
    await command.handleInteraction(interaction as unknown as HandleParam);
    const desc = getEmbedDescription(interaction);
    expect(desc).toContain('UnassignedPlayer');
    expect(desc).toContain('Unassigned');
  });

  it('should use roster update color', async () => {
    const interaction = mockInteraction('42');
    mockDb.select.mockReturnValue(
      createChainMock([{ title: 'Test Raid', maxAttendees: null }]),
    );
    signupsService.getRosterWithAssignments.mockResolvedValue(
      makeRoster() as unknown as RosterReturn,
    );
    await command.handleInteraction(interaction as unknown as HandleParam);
    const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
      embeds: { data: { color?: number } }[];
    };
    expect(call.embeds[0].data.color).toBe(EMBED_COLORS.ROSTER_UPDATE);
  });

  it('should include footer with total and max', async () => {
    const interaction = mockInteraction('42');
    mockDb.select.mockReturnValue(
      createChainMock([{ title: 'Test Raid', maxAttendees: 25 }]),
    );
    const roster = makeRoster(
      [{ slot: 'tank', username: 'Player1' }],
      [{ username: 'Player2' }],
    );
    signupsService.getRosterWithAssignments.mockResolvedValue(
      roster as unknown as RosterReturn,
    );
    await command.handleInteraction(interaction as unknown as HandleParam);
    const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
      embeds: { data: { footer?: { text: string } } }[];
    };
    expect(call.embeds[0].data.footer?.text).toContain('2 total signups');
    expect(call.embeds[0].data.footer?.text).toContain('25');
  });
});

describe('RosterViewCommand — CLIENT_URL button present', () => {
  let command: RosterViewCommand;
  let module: TestingModule;
  let signupsService: jest.Mocked<SignupsService>;
  let mockDb: { select: jest.Mock };

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    mockDb = makeDefaultDb();
    module = await buildModule(mockDb);
    command = module.get(RosterViewCommand);
    signupsService = module.get(SignupsService);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();
    restoreClientUrl();
  });

  it('should include button when CLIENT_URL is set', async () => {
    process.env.CLIENT_URL = 'https://raidledger.com';
    const interaction = mockInteraction('42');
    mockDb.select.mockReturnValue(
      createChainMock([{ title: 'Test Raid', maxAttendees: 20 }]),
    );
    signupsService.getRosterWithAssignments.mockResolvedValue(
      makeRoster() as unknown as RosterReturn,
    );
    await command.handleInteraction(interaction as unknown as HandleParam);
    const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
      components: unknown[];
    };
    expect(call.components.length).toBeGreaterThan(0);
  });

  it('should not include button when CLIENT_URL is not set', async () => {
    delete process.env.CLIENT_URL;
    const interaction = mockInteraction('42');
    mockDb.select.mockReturnValue(
      createChainMock([{ title: 'Test Raid', maxAttendees: 20 }]),
    );
    signupsService.getRosterWithAssignments.mockResolvedValue(
      makeRoster() as unknown as RosterReturn,
    );
    await command.handleInteraction(interaction as unknown as HandleParam);
    const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
      components: unknown[];
    };
    expect(call.components).toHaveLength(0);
  });
});

describe('RosterViewCommand — autocomplete: match & empty', () => {
  let command: RosterViewCommand;
  let module: TestingModule;
  let mockDb: { select: jest.Mock };

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    mockDb = makeDefaultDb();
    module = await buildModule(mockDb);
    command = module.get(RosterViewCommand);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();
    restoreClientUrl();
  });

  it('should respond with matching events', async () => {
    const mockRespond = jest.fn().mockResolvedValue(undefined);
    mockDb.select.mockReturnValue(
      createChainMock([
        { id: 1, title: 'Test Raid' },
        { id: 2, title: 'Test Dungeon' },
      ]),
    );
    const interaction = {
      options: { getFocused: jest.fn().mockReturnValue('Test') },
      respond: mockRespond,
    };
    await command.handleAutocomplete(
      interaction as unknown as AutocompleteParam,
    );
    expect(mockRespond).toHaveBeenCalledWith([
      { name: 'Test Raid', value: '1' },
      { name: 'Test Dungeon', value: '2' },
    ]);
  });

  it('should respond with empty array when no match', async () => {
    const mockRespond = jest.fn().mockResolvedValue(undefined);
    mockDb.select.mockReturnValue(createChainMock([]));
    const interaction = {
      options: { getFocused: jest.fn().mockReturnValue('NonExistent') },
      respond: mockRespond,
    };
    await command.handleAutocomplete(
      interaction as unknown as AutocompleteParam,
    );
    expect(mockRespond).toHaveBeenCalledWith([]);
  });
});

describe('RosterViewCommand — autocomplete: upcoming & format', () => {
  let command: RosterViewCommand;
  let module: TestingModule;
  let mockDb: { select: jest.Mock };

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    mockDb = makeDefaultDb();
    module = await buildModule(mockDb);
    command = module.get(RosterViewCommand);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();
    restoreClientUrl();
  });

  it('should respond with all upcoming when query empty', async () => {
    const mockRespond = jest.fn().mockResolvedValue(undefined);
    mockDb.select.mockReturnValue(
      createChainMock([{ id: 5, title: 'Upcoming Event' }]),
    );
    const interaction = {
      options: { getFocused: jest.fn().mockReturnValue('') },
      respond: mockRespond,
    };
    await command.handleAutocomplete(
      interaction as unknown as AutocompleteParam,
    );
    expect(mockRespond).toHaveBeenCalledWith([
      { name: 'Upcoming Event', value: '5' },
    ]);
  });

  it('should return event IDs as strings', async () => {
    const mockRespond = jest.fn().mockResolvedValue(undefined);
    mockDb.select.mockReturnValue(
      createChainMock([{ id: 42, title: 'My Event' }]),
    );
    const interaction = {
      options: { getFocused: jest.fn().mockReturnValue('') },
      respond: mockRespond,
    };
    await command.handleAutocomplete(
      interaction as unknown as AutocompleteParam,
    );
    const callArgs = (mockRespond.mock.calls as unknown[][])[0][0] as {
      name: string;
      value: string;
    }[];
    expect(typeof callArgs[0].value).toBe('string');
    expect(callArgs[0].value).toBe('42');
  });
});
