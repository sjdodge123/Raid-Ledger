import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BindCommand } from './bind.command';
import { ChannelBindingsService } from '../services/channel-bindings.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { ChannelType, MessageFlags, PermissionFlagsBits } from 'discord.js';

/** A Drizzle stub whose `select(...).limit()` resolves the given rows. */
function makeDb(rows: unknown[]) {
  return {
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue(rows),
        }),
      }),
    }),
  };
}

// ROK-1628: the channel bind path looks the caller up by Discord id, so the
// default stub answers with a privileged account.
const mockDb = makeDb([{ id: 1, role: 'admin' }]);

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
  user: { id: 'discord-user-1' },
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

async function buildModule(db: unknown = mockDb) {
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
      { provide: DrizzleAsyncProvider, useValue: db },
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

  // ROK-1628: Discord hides the command from ordinary members by default. A
  // server admin can override this per guild, so the handler check is the gate.
  it('defaults to the Manage Server permission', () => {
    expect(command.getDefinition().default_member_permissions).toBe(
      String(PermissionFlagsBits.ManageGuild),
    );
  });
});

describe('BindCommand — channel bind permission (ROK-1628)', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  async function runAs(rows: unknown[]) {
    const module: TestingModule = await buildModule(makeDb(rows));
    const command = module.get(BindCommand);
    const bindingsService = module.get<
      ChannelBindingsService,
      jest.Mocked<ChannelBindingsService>
    >(ChannelBindingsService);
    const emitter = module.get<EventEmitter2, jest.Mocked<EventEmitter2>>(
      EventEmitter2,
    );
    const interaction = mockInteraction();
    await command.handleInteraction(castInteraction(interaction));
    return { interaction, bindingsService, emitter };
  }

  it('binds nothing for a caller with no linked account', async () => {
    const { interaction, bindingsService, emitter } = await runAs([]);

    expect(interaction.editReply).toHaveBeenCalledWith(
      'You need a linked Raid Ledger account.',
    );
    expect(bindingsService.bind).not.toHaveBeenCalled();
    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it('binds nothing for a linked member', async () => {
    const { interaction, bindingsService, emitter } = await runAs([
      { id: 7, role: 'member' },
    ]);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringMatching(/operator/i),
    );
    expect(bindingsService.bind).not.toHaveBeenCalled();
    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it('binds for an operator', async () => {
    const { bindingsService } = await runAs([{ id: 8, role: 'operator' }]);

    expect(bindingsService.bind).toHaveBeenCalled();
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
