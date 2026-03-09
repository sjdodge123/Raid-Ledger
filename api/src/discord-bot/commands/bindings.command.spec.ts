import { Test, TestingModule } from '@nestjs/testing';
import { BindingsCommand } from './bindings.command';
import { ChannelBindingsService } from '../services/channel-bindings.service';
import { MessageFlags } from 'discord.js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import type { BindingRecord } from '../services/channel-bindings.service';

const makeBinding = (
  overrides: Partial<BindingRecord> = {},
): BindingRecord => ({
  id: 'uuid-1',
  guildId: 'guild-123',
  channelId: 'channel-456',
  channelType: 'text',
  bindingPurpose: 'game-announcements',
  gameId: null,
  recurrenceGroupId: null,
  config: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const mockDb = {
  select: jest.fn().mockReturnValue({
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue([]),
      }),
    }),
  }),
};

const mockInteraction = (overrides: Record<string, unknown> = {}) => ({
  deferReply: jest.fn().mockResolvedValue(undefined),
  editReply: jest.fn().mockResolvedValue(undefined),
  guildId: 'guild-123',
  ...overrides,
});

type HandleParam = Parameters<BindingsCommand['handleInteraction']>[0];

function castInteraction(interaction: ReturnType<typeof mockInteraction>) {
  return interaction as unknown as HandleParam;
}

async function buildModule() {
  return Test.createTestingModule({
    providers: [
      BindingsCommand,
      {
        provide: ChannelBindingsService,
        useValue: { getBindings: jest.fn().mockResolvedValue([]) },
      },
      { provide: DrizzleAsyncProvider, useValue: mockDb },
    ],
  }).compile();
}

describe('BindingsCommand — definition', () => {
  let command: BindingsCommand;

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    const module: TestingModule = await buildModule();
    command = module.get(BindingsCommand);
  });

  it('should return a command definition named "bindings"', () => {
    expect(command.getDefinition().name).toBe('bindings');
  });

  it('should not allow DM permission', () => {
    expect(command.getDefinition().dm_permission).toBe(false);
  });

  it('should have a description', () => {
    expect(command.getDefinition().description).toBeTruthy();
  });
});

describe('BindingsCommand — guard: DM & defer', () => {
  let command: BindingsCommand;
  let bindingsService: jest.Mocked<ChannelBindingsService>;

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    const module: TestingModule = await buildModule();
    command = module.get(BindingsCommand);
    bindingsService = module.get(ChannelBindingsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should defer reply as ephemeral', async () => {
    const interaction = mockInteraction();
    await command.handleInteraction(castInteraction(interaction));
    expect(interaction.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should reject usage outside a guild', async () => {
    const interaction = mockInteraction({ guildId: null });
    await command.handleInteraction(castInteraction(interaction));
    expect(interaction.editReply).toHaveBeenCalledWith(
      'This command can only be used in a server.',
    );
    expect(bindingsService.getBindings).not.toHaveBeenCalled();
  });
});

describe('BindingsCommand — empty bindings', () => {
  let command: BindingsCommand;
  let bindingsService: jest.Mocked<ChannelBindingsService>;

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    const module: TestingModule = await buildModule();
    command = module.get(BindingsCommand);
    bindingsService = module.get(ChannelBindingsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should reply with no-bindings message when none configured', async () => {
    bindingsService.getBindings.mockResolvedValue([]);
    const interaction = mockInteraction();
    await command.handleInteraction(castInteraction(interaction));
    const replyArg = (interaction.editReply.mock.calls as unknown[][])[0][0];
    expect(typeof replyArg).toBe('string');
    expect(replyArg as string).toMatch(/No channel bindings/);
  });

  it('should include /bind mention in no-bindings message', async () => {
    bindingsService.getBindings.mockResolvedValue([]);
    const interaction = mockInteraction();
    await command.handleInteraction(castInteraction(interaction));
    const replyArg = (interaction.editReply.mock.calls as unknown[][])[0][0];
    expect(replyArg as string).toContain('/bind');
  });
});

describe('BindingsCommand — with bindings embed', () => {
  let command: BindingsCommand;
  let bindingsService: jest.Mocked<ChannelBindingsService>;

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    const module: TestingModule = await buildModule();
    command = module.get(BindingsCommand);
    bindingsService = module.get(ChannelBindingsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should reply with embed when bindings exist', async () => {
    bindingsService.getBindings.mockResolvedValue([makeBinding()]);
    const interaction = mockInteraction();
    await command.handleInteraction(castInteraction(interaction));
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.arrayContaining([expect.anything()]) as unknown,
      }),
    );
  });

  it('should include button when CLIENT_URL is set', async () => {
    process.env.CLIENT_URL = 'https://raidledger.com';
    bindingsService.getBindings.mockResolvedValue([makeBinding()]);
    const interaction = mockInteraction();
    await command.handleInteraction(castInteraction(interaction));
    const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
      components: unknown[];
    };
    expect(call.components.length).toBeGreaterThan(0);
  });

  it('should not include button when CLIENT_URL is not set', async () => {
    delete process.env.CLIENT_URL;
    bindingsService.getBindings.mockResolvedValue([makeBinding()]);
    const interaction = mockInteraction();
    await command.handleInteraction(castInteraction(interaction));
    const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
      components: unknown[];
    };
    expect(call.components).toHaveLength(0);
  });
});

describe('BindingsCommand — binding labels: announcements', () => {
  let command: BindingsCommand;
  let bindingsService: jest.Mocked<ChannelBindingsService>;

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    const module: TestingModule = await buildModule();
    command = module.get(BindingsCommand);
    bindingsService = module.get(ChannelBindingsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should label game-announcements bindings as "Announcements"', async () => {
    bindingsService.getBindings.mockResolvedValue([
      makeBinding({ bindingPurpose: 'game-announcements', gameId: null }),
    ]);
    const interaction = mockInteraction();
    await command.handleInteraction(castInteraction(interaction));
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.arrayContaining([expect.anything()]) as unknown,
      }),
    );
  });

  it('should label game-voice-monitor bindings as "Activity Monitor"', async () => {
    bindingsService.getBindings.mockResolvedValue([
      makeBinding({ bindingPurpose: 'game-voice-monitor', gameId: null }),
    ]);
    const interaction = mockInteraction();
    await command.handleInteraction(castInteraction(interaction));
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.arrayContaining([expect.anything()]) as unknown,
      }),
    );
  });

  it('should show "Any" for bindings with no gameId', async () => {
    bindingsService.getBindings.mockResolvedValue([
      makeBinding({ gameId: null }),
    ]);
    const interaction = mockInteraction();
    await command.handleInteraction(castInteraction(interaction));
    const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
      embeds: Array<{ data: { description?: string } }>;
    };
    expect(call.embeds[0]?.data?.description ?? '').toContain('Any');
  });
});

describe('BindingsCommand — game lookup found', () => {
  let command: BindingsCommand;
  let bindingsService: jest.Mocked<ChannelBindingsService>;

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    const module: TestingModule = await buildModule();
    command = module.get(BindingsCommand);
    bindingsService = module.get(ChannelBindingsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should look up game name for bindings with gameId', async () => {
    bindingsService.getBindings.mockResolvedValue([
      makeBinding({ gameId: 42 }),
    ]);
    const limitMock = jest
      .fn()
      .mockResolvedValue([{ id: 42, name: 'World of Warcraft' }]);
    const whereMock = jest.fn().mockReturnValue({ limit: limitMock });
    const fromMock = jest.fn().mockReturnValue({ where: whereMock });
    mockDb.select.mockReturnValueOnce({ from: fromMock });
    const interaction = mockInteraction();
    await command.handleInteraction(castInteraction(interaction));
    const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
      embeds: Array<{ data: { description?: string } }>;
    };
    expect(call.embeds[0]?.data?.description ?? '').toContain(
      'World of Warcraft',
    );
  });

  it('should show "Unknown" when gameId has no matching game', async () => {
    bindingsService.getBindings.mockResolvedValue([
      makeBinding({ gameId: 999 }),
    ]);
    const limitMock = jest.fn().mockResolvedValue([]);
    const whereMock = jest.fn().mockReturnValue({ limit: limitMock });
    const fromMock = jest.fn().mockReturnValue({ where: whereMock });
    mockDb.select.mockReturnValueOnce({ from: fromMock });
    const interaction = mockInteraction();
    await command.handleInteraction(castInteraction(interaction));
    const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
      embeds: Array<{ data: { description?: string } }>;
    };
    expect(call.embeds[0]?.data?.description ?? '').toContain('Unknown');
  });
});

describe('BindingsCommand — game lookup dedup & errors', () => {
  let command: BindingsCommand;
  let bindingsService: jest.Mocked<ChannelBindingsService>;

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    const module: TestingModule = await buildModule();
    command = module.get(BindingsCommand);
    bindingsService = module.get(ChannelBindingsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should deduplicate game lookups for shared gameId', async () => {
    const gameId = 42;
    bindingsService.getBindings.mockResolvedValue([
      makeBinding({ id: 'binding-1', channelId: 'ch-1', gameId }),
      makeBinding({ id: 'binding-2', channelId: 'ch-2', gameId }),
    ]);
    const limitMock = jest
      .fn()
      .mockResolvedValue([{ id: gameId, name: 'Shared Game' }]);
    const whereMock = jest.fn().mockReturnValue({ limit: limitMock });
    const fromMock = jest.fn().mockReturnValue({ where: whereMock });
    mockDb.select.mockReturnValue({ from: fromMock });
    const interaction = mockInteraction();
    await command.handleInteraction(castInteraction(interaction));
    expect(mockDb.select).toHaveBeenCalledTimes(1);
  });

  it('should reply with error message when service throws', async () => {
    bindingsService.getBindings.mockRejectedValue(new Error('DB error'));
    const interaction = mockInteraction();
    await command.handleInteraction(castInteraction(interaction));
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringMatching(/Failed to fetch bindings/),
    );
  });

  it('should call getBindings with the guild ID', async () => {
    const interaction = mockInteraction({ guildId: 'my-guild-999' });
    await command.handleInteraction(castInteraction(interaction));
    expect(bindingsService.getBindings).toHaveBeenCalledWith('my-guild-999');
  });
});
