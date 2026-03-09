import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BindCommand } from './bind.command';
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

function makeMockBinding() {
  return {
    id: 'binding-uuid',
    guildId: 'guild-123',
    channelId: 'channel-456',
    channelType: 'text',
    bindingPurpose: 'game-announcements',
    gameId: null,
    config: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

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

type HandleParam = Parameters<BindCommand['handleInteraction']>[0];

function castInteraction(interaction: ReturnType<typeof mockInteraction>) {
  return interaction as unknown as HandleParam;
}

async function buildModule() {
  return Test.createTestingModule({
    providers: [
      BindCommand,
      {
        provide: ChannelBindingsService,
        useValue: {
          bind: jest.fn().mockResolvedValue({
            binding: makeMockBinding(),
            replacedChannelIds: [],
          }),
          detectBehavior: jest.fn().mockReturnValue('game-announcements'),
        },
      },
      { provide: DrizzleAsyncProvider, useValue: mockDb },
      { provide: EventEmitter2, useValue: { emit: jest.fn() } },
    ],
  }).compile();
}

describe('BindCommand — getDefinition', () => {
  let command: BindCommand;

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    const module: TestingModule = await buildModule();
    command = module.get(BindCommand);
  });

  it('should return a command definition named "bind"', () => {
    expect(command.getDefinition().name).toBe('bind');
  });

  it('should not allow DM permission', () => {
    expect(command.getDefinition().dm_permission).toBe(false);
  });
});

describe('BindCommand — handleInteraction basics', () => {
  let command: BindCommand;

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    const module: TestingModule = await buildModule();
    command = module.get(BindCommand);
  });

  it('should defer reply as ephemeral', async () => {
    const interaction = mockInteraction();
    await command.handleInteraction(castInteraction(interaction));
    expect(interaction.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should reject DM usage', async () => {
    const interaction = mockInteraction({ guildId: null });
    await command.handleInteraction(castInteraction(interaction));
    expect(interaction.editReply).toHaveBeenCalledWith(
      'This command can only be used in a server.',
    );
  });
});

describe('BindCommand — handleInteraction bind & reply', () => {
  let command: BindCommand;
  let bindingsService: jest.Mocked<ChannelBindingsService>;

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    const module: TestingModule = await buildModule();
    command = module.get(BindCommand);
    bindingsService = module.get(ChannelBindingsService);
  });

  it('should bind the current channel when no channel option is provided', async () => {
    const interaction = mockInteraction();
    await command.handleInteraction(castInteraction(interaction));
    expect(bindingsService.bind).toHaveBeenCalledWith(
      'guild-123',
      'channel-456',
      'text',
      'game-announcements',
      null,
      undefined,
      null,
    );
  });

  it('should reply with a success embed', async () => {
    const interaction = mockInteraction();
    await command.handleInteraction(castInteraction(interaction));
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.arrayContaining([expect.anything()]) as unknown,
      }),
    );
  });

  it('should include fine-tune button when CLIENT_URL is set', async () => {
    process.env.CLIENT_URL = 'https://raidledger.com';
    const interaction = mockInteraction();
    await command.handleInteraction(castInteraction(interaction));
    const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
      components: unknown[];
    };
    expect(call.components.length).toBeGreaterThan(0);
  });
});
