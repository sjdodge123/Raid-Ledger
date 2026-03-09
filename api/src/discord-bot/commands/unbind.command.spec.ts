import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UnbindCommand } from './unbind.command';
import { ChannelBindingsService } from '../services/channel-bindings.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { ChannelType, MessageFlags } from 'discord.js';

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
  channel: {
    id: 'channel-456',
    name: 'general',
    type: ChannelType.GuildText,
  },
  options: {
    getChannel: jest.fn().mockReturnValue(null),
    getString: jest.fn().mockReturnValue(null),
  },
  ...overrides,
});

type HandleParam = Parameters<UnbindCommand['handleInteraction']>[0];

function castInteraction(interaction: ReturnType<typeof mockInteraction>) {
  return interaction as unknown as HandleParam;
}

async function buildModule() {
  return Test.createTestingModule({
    providers: [
      UnbindCommand,
      {
        provide: ChannelBindingsService,
        useValue: { unbind: jest.fn().mockResolvedValue(true) },
      },
      { provide: DrizzleAsyncProvider, useValue: mockDb },
      { provide: EventEmitter2, useValue: { emit: jest.fn() } },
    ],
  }).compile();
}

describe('UnbindCommand — definition', () => {
  let command: UnbindCommand;

  beforeEach(async () => {
    const module: TestingModule = await buildModule();
    command = module.get(UnbindCommand);
  });

  it('should return a command definition named "unbind"', () => {
    expect(command.getDefinition().name).toBe('unbind');
  });

  it('should not allow DM permission', () => {
    expect(command.getDefinition().dm_permission).toBe(false);
  });

  it('should have a description', () => {
    expect(command.getDefinition().description).toBeTruthy();
  });
});

describe('UnbindCommand — guard: defer & DM', () => {
  let command: UnbindCommand;
  let bindingsService: jest.Mocked<ChannelBindingsService>;

  beforeEach(async () => {
    const module: TestingModule = await buildModule();
    command = module.get(UnbindCommand);
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
    expect(bindingsService.unbind).not.toHaveBeenCalled();
  });
});

describe('UnbindCommand — guard: no channel', () => {
  let command: UnbindCommand;
  let bindingsService: jest.Mocked<ChannelBindingsService>;

  beforeEach(async () => {
    const module: TestingModule = await buildModule();
    command = module.get(UnbindCommand);
    bindingsService = module.get(ChannelBindingsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should reject when no channel option and no current channel', async () => {
    const interaction = mockInteraction({
      channel: null,
      options: {
        getChannel: jest.fn().mockReturnValue(null),
        getString: jest.fn().mockReturnValue(null),
      },
    });
    await command.handleInteraction(castInteraction(interaction));
    expect(interaction.editReply).toHaveBeenCalledWith(
      'Could not determine the target channel.',
    );
    expect(bindingsService.unbind).not.toHaveBeenCalled();
  });
});

describe('UnbindCommand — unbind current channel', () => {
  let command: UnbindCommand;
  let bindingsService: jest.Mocked<ChannelBindingsService>;

  beforeEach(async () => {
    const module: TestingModule = await buildModule();
    command = module.get(UnbindCommand);
    bindingsService = module.get(ChannelBindingsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should unbind the current channel when no option provided', async () => {
    const interaction = mockInteraction();
    await command.handleInteraction(castInteraction(interaction));
    expect(bindingsService.unbind).toHaveBeenCalledWith(
      'guild-123',
      'channel-456',
      null,
    );
  });

  it('should unbind the specified channel when option is provided', async () => {
    const interaction = mockInteraction({
      options: {
        getChannel: jest.fn().mockReturnValue({
          id: 'channel-999',
          name: 'raids',
          type: ChannelType.GuildText,
        }),
        getString: jest.fn().mockReturnValue(null),
      },
    });
    await command.handleInteraction(castInteraction(interaction));
    expect(bindingsService.unbind).toHaveBeenCalledWith(
      'guild-123',
      'channel-999',
      null,
    );
  });
});

describe('UnbindCommand — unbind replies', () => {
  let command: UnbindCommand;
  let bindingsService: jest.Mocked<ChannelBindingsService>;

  beforeEach(async () => {
    const module: TestingModule = await buildModule();
    command = module.get(UnbindCommand);
    bindingsService = module.get(ChannelBindingsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should reply with success embed when binding is removed', async () => {
    bindingsService.unbind.mockResolvedValue(true);
    const interaction = mockInteraction();
    await command.handleInteraction(castInteraction(interaction));
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.arrayContaining([expect.anything()]) as unknown,
      }),
    );
  });

  it('should reply with not-found message when no binding exists', async () => {
    bindingsService.unbind.mockResolvedValue(false);
    const interaction = mockInteraction();
    await command.handleInteraction(castInteraction(interaction));
    const replyArg = (interaction.editReply.mock.calls as unknown[][])[0][0];
    expect(typeof replyArg).toBe('string');
    expect(replyArg as string).toMatch(/No binding found/);
  });

  it('should reply with error message when service throws', async () => {
    bindingsService.unbind.mockRejectedValue(new Error('DB error'));
    const interaction = mockInteraction();
    await command.handleInteraction(castInteraction(interaction));
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringMatching(/Failed to unbind/),
    );
  });

  it('should include channel name in the not-found message', async () => {
    bindingsService.unbind.mockResolvedValue(false);
    const interaction = mockInteraction({
      channel: {
        id: 'channel-456',
        name: 'general',
        type: ChannelType.GuildText,
      },
    });
    await command.handleInteraction(castInteraction(interaction));
    const replyArg = (interaction.editReply.mock.calls as unknown[][])[0][0];
    expect(replyArg as string).toContain('general');
  });
});
