import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UnbindCommand } from './unbind.command';
import { ChannelBindingsService } from '../services/channel-bindings.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  type APIEmbed,
} from 'discord.js';
import { colorForState } from '../embeds/embed-chrome.helpers';
import { COMMAND_REPLY_AUTHORS } from './command-reply-chrome.helpers';
import { EMBED_COLORS } from '../discord-bot.constants';

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

// ROK-1628: the channel unbind path looks the caller up by Discord id, so the
// default stub answers with a privileged account.
const mockDb = makeDb([{ id: 1, role: 'admin' }]);

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

type HandleParam = Parameters<UnbindCommand['handleInteraction']>[0];

function castInteraction(interaction: ReturnType<typeof mockInteraction>) {
  return interaction as unknown as HandleParam;
}

async function buildModule(db: unknown = mockDb) {
  return Test.createTestingModule({
    providers: [
      UnbindCommand,
      {
        provide: ChannelBindingsService,
        useValue: { unbind: jest.fn().mockResolvedValue(['general-lobby']) },
      },
      { provide: DrizzleAsyncProvider, useValue: db },
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

  // ROK-1628: Discord hides the command from ordinary members by default. A
  // server admin can override this per guild, so the handler check is the gate.
  it('defaults to the Manage Server permission', () => {
    expect(command.getDefinition().default_member_permissions).toBe(
      String(PermissionFlagsBits.ManageGuild),
    );
  });
});

describe('UnbindCommand — channel unbind permission (ROK-1628)', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  async function runAs(rows: unknown[]) {
    const module: TestingModule = await buildModule(makeDb(rows));
    const command = module.get(UnbindCommand);
    const bindingsService = module.get<
      ChannelBindingsService,
      jest.Mocked<ChannelBindingsService>
    >(ChannelBindingsService);
    const interaction = mockInteraction();
    await command.handleInteraction(castInteraction(interaction));
    return { interaction, bindingsService };
  }

  it('unbinds nothing for a caller with no linked account', async () => {
    const { interaction, bindingsService } = await runAs([]);

    expect(interaction.editReply).toHaveBeenCalledWith(
      'You need a linked Raid Ledger account.',
    );
    expect(bindingsService.unbind).not.toHaveBeenCalled();
  });

  it('unbinds nothing for a linked member', async () => {
    const { interaction, bindingsService } = await runAs([
      { id: 7, role: 'member' },
    ]);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringMatching(/operator/i),
    );
    expect(bindingsService.unbind).not.toHaveBeenCalled();
  });

  it('unbinds for an operator', async () => {
    const { bindingsService } = await runAs([{ id: 8, role: 'operator' }]);

    expect(bindingsService.unbind).toHaveBeenCalled();
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
    bindingsService.unbind.mockResolvedValue(['general-lobby']);
    const interaction = mockInteraction();
    await command.handleInteraction(castInteraction(interaction));
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.arrayContaining([expect.anything()]) as unknown,
      }),
    );
  });

  it('should reply with not-found message when no binding exists', async () => {
    bindingsService.unbind.mockResolvedValue([]);
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
    bindingsService.unbind.mockResolvedValue([]);
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

describe('UnbindCommand — shared command-reply chrome (ROK-1462 D5/AC2)', () => {
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

  /** The single embed the command replied with, as raw JSON. */
  function repliedEmbed(
    interaction: ReturnType<typeof mockInteraction>,
  ): APIEmbed {
    const arg = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
      embeds: { toJSON(): APIEmbed }[];
    };
    return arg.embeds[0].toJSON();
  }

  it('replies with the slate BINDING REMOVED chrome, not a red title', async () => {
    bindingsService.unbind.mockResolvedValue(['general-lobby']);
    const interaction = mockInteraction();

    await command.handleInteraction(castInteraction(interaction));
    const embed = repliedEmbed(interaction);

    expect(embed.author?.name).toBe(COMMAND_REPLY_AUTHORS.UNBIND_REMOVED);
    expect(embed.color).toBe(colorForState('done'));
    expect(embed.color).not.toBe(EMBED_COLORS.ERROR);
    // AC2: the same `#channel -> Purpose` title slot `/bind` uses.
    expect(embed.title).toBe('#general → General Lobby');
  });

  it('carries the community footer the other replies carry', async () => {
    bindingsService.unbind.mockResolvedValue(['general-lobby']);
    const interaction = mockInteraction();

    await command.handleInteraction(castInteraction(interaction));

    expect(repliedEmbed(interaction).footer?.text).toBeTruthy();
  });
});
