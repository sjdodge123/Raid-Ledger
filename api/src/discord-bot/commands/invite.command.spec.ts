import { InviteCommand } from './invite.command';
import { EmbedBuilder } from 'discord.js';

const mockEmbed = new EmbedBuilder().setTitle('Test');
const mockRow = { toJSON: jest.fn() };

function createEmbedFactory() {
  return {
    buildEventInvite: jest
      .fn()
      .mockReturnValue({ embed: mockEmbed, row: mockRow }),
  };
}

function createSettingsService() {
  return {
    getBranding: jest.fn().mockResolvedValue({ communityName: 'Test Guild' }),
    getDefaultTimezone: jest.fn().mockResolvedValue('America/New_York'),
  };
}

function createEventsService() {
  return {
    findOne: jest.fn().mockResolvedValue({
      id: 42,
      title: 'Mythic Raid Night',
      description: 'Weekly raid',
      startTime: '2026-02-20T20:00:00.000Z',
      endTime: '2026-02-20T23:00:00.000Z',
      signupCount: 15,
      cancelledAt: null,
      game: { name: 'World of Warcraft', coverUrl: null },
    }),
    findAll: jest.fn().mockResolvedValue({
      data: [
        {
          id: 42,
          title: 'Mythic Raid Night',
          startTime: '2026-02-20T20:00:00.000Z',
        },
        { id: 43, title: 'PvP Arena', startTime: '2026-02-21T18:00:00.000Z' },
      ],
      total: 2,
      page: 1,
      limit: 25,
    }),
  };
}

function createMockServices() {
  return {
    clientService: { sendEmbedDM: jest.fn().mockResolvedValue(undefined) },
    embedFactory: createEmbedFactory(),
    settingsService: createSettingsService(),
    eventsService: createEventsService(),
    pugsService: {
      create: jest
        .fn()
        .mockResolvedValue({ id: 'pug-1', inviteCode: 'abc12345' }),
    },
    db: {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([]),
    },
  };
}

function buildCommand(services: ReturnType<typeof createMockServices>) {
  return new InviteCommand(
    services.db as never,
    services.clientService as never,
    services.embedFactory as never,
    services.settingsService as never,
    services.eventsService as never,
    services.pugsService as never,
  );
}

function makeNamedInviteInteraction(editReply: jest.Mock) {
  return {
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply,
    options: {
      getInteger: jest.fn().mockReturnValue(42),
      getUser: jest
        .fn()
        .mockReturnValue({ id: '999', username: 'target-user' }),
    },
    user: { id: 'invoker-discord-id', username: 'inviter-user' },
  };
}

function makeAnonymousInviteInteraction(editReply: jest.Mock) {
  return {
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply,
    options: {
      getInteger: jest.fn().mockReturnValue(42),
      getUser: jest.fn().mockReturnValue(null),
    },
    user: { id: 'invoker-discord-id', username: 'inviter-user' },
  };
}

describe('InviteCommand — commandName', () => {
  it('should be "invite"', () => {
    const services = createMockServices();
    const command = buildCommand(services);
    expect(command.commandName).toBe('invite');
  });
});

describe('InviteCommand — definition', () => {
  let command: InviteCommand;

  beforeEach(() => {
    command = buildCommand(createMockServices());
  });

  it('should return a slash command definition', () => {
    const def = command.getDefinition();
    expect(def.name).toBe('invite');
    expect(def.description).toBe(
      'Invite a Discord user or generate an invite link',
    );
    expect(def.options).toHaveLength(2);
  });

  it('should have event (required) and user (optional) options', () => {
    const def = command.getDefinition();
    const options = def.options as {
      name: string;
      required: boolean;
      autocomplete?: boolean;
    }[];
    expect(options[0].name).toBe('event');
    expect(options[0].required).toBe(true);
    expect(options[0].autocomplete).toBe(true);
    expect(options[1].name).toBe('user');
    expect(options[1].required).toBe(false);
  });
});

describe('InviteCommand — named invite success', () => {
  it('should create a named PUG and confirm success', async () => {
    const services = createMockServices();
    services.db.limit = jest.fn().mockResolvedValue([{ id: 1, role: 'admin' }]);
    const command = buildCommand(services);
    const mockEditReply = jest.fn().mockResolvedValue(undefined);
    const interaction = makeNamedInviteInteraction(mockEditReply);
    await command.handleInteraction(interaction as never);
    expect(services.eventsService.findOne).toHaveBeenCalledWith(42);
    expect(services.pugsService.create).toHaveBeenCalledWith(
      42,
      1,
      true,
      expect.objectContaining({ discordUsername: 'target-user', role: 'dps' }),
    );
    expect(mockEditReply).toHaveBeenCalledWith(
      'Invite sent to <@999> for **Mythic Raid Night**',
    );
  });
});

describe('InviteCommand — named invite errors', () => {
  let services: ReturnType<typeof createMockServices>;
  let command: InviteCommand;
  let mockEditReply: jest.Mock;

  beforeEach(() => {
    services = createMockServices();
    services.db.limit = jest.fn().mockResolvedValue([{ id: 1, role: 'admin' }]);
    command = buildCommand(services);
    mockEditReply = jest.fn().mockResolvedValue(undefined);
  });

  it('should reply with error if event not found', async () => {
    services.eventsService.findOne.mockRejectedValue(
      new Error('Event not found'),
    );
    const interaction = makeNamedInviteInteraction(mockEditReply);
    await command.handleInteraction(interaction as never);
    expect(mockEditReply).toHaveBeenCalledWith('Event not found');
    expect(services.pugsService.create).not.toHaveBeenCalled();
  });

  it('should reply with error if event is cancelled', async () => {
    services.eventsService.findOne.mockResolvedValue({
      id: 42,
      title: 'Cancelled Event',
      cancelledAt: '2026-02-20T00:00:00.000Z',
      startTime: '2026-02-20T20:00:00.000Z',
      endTime: '2026-02-20T23:00:00.000Z',
      signupCount: 0,
      game: null,
    });
    const interaction = makeNamedInviteInteraction(mockEditReply);
    await command.handleInteraction(interaction as never);
    expect(mockEditReply).toHaveBeenCalledWith('Event not found');
    expect(services.pugsService.create).not.toHaveBeenCalled();
  });
});

describe('InviteCommand — anonymous invite', () => {
  it('should create an anonymous PUG and return invite URL', async () => {
    const services = createMockServices();
    services.db.limit = jest.fn().mockResolvedValue([{ id: 1, role: 'admin' }]);
    const command = buildCommand(services);
    const mockEditReply = jest.fn().mockResolvedValue(undefined);
    process.env.CLIENT_URL = 'http://localhost:5173';
    const interaction = makeAnonymousInviteInteraction(mockEditReply);
    await command.handleInteraction(interaction as never);
    expect(services.pugsService.create).toHaveBeenCalledWith(
      42,
      1,
      true,
      expect.objectContaining({ role: 'dps' }),
    );
    expect(mockEditReply).toHaveBeenCalledWith(
      expect.stringContaining('/i/abc12345'),
    );
    delete process.env.CLIENT_URL;
  });
});

describe('InviteCommand — no RL account', () => {
  it('should reply with error if invoker has no RL account', async () => {
    const services = createMockServices();
    services.db.limit = jest.fn().mockResolvedValue([]);
    const command = buildCommand(services);
    const mockEditReply = jest.fn().mockResolvedValue(undefined);
    const interaction = {
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: mockEditReply,
      options: {
        getInteger: jest.fn().mockReturnValue(42),
        getUser: jest.fn().mockReturnValue(null),
      },
      user: { id: 'unknown-user', username: 'nobody' },
    };
    await command.handleInteraction(interaction as never);
    expect(mockEditReply).toHaveBeenCalledWith(
      'You need a linked Raid Ledger account to use this command.',
    );
  });
});

describe('InviteCommand — autocomplete matching', () => {
  let command: InviteCommand;
  let services: ReturnType<typeof createMockServices>;
  let mockAutocomplete: {
    options: { getFocused: jest.Mock };
    respond: jest.Mock;
  };

  beforeEach(() => {
    services = createMockServices();
    command = buildCommand(services);
    mockAutocomplete = {
      options: { getFocused: jest.fn().mockReturnValue('') },
      respond: jest.fn().mockResolvedValue(undefined),
    };
  });

  it('should return matching events', async () => {
    mockAutocomplete.options.getFocused.mockReturnValue('mythic');
    await command.handleAutocomplete(mockAutocomplete as never);
    expect(services.eventsService.findAll).toHaveBeenCalledWith({
      page: 1,
      upcoming: 'true',
      limit: 25,
    });
    const calls = mockAutocomplete.respond.mock.calls as [
      { name: string; value: number }[],
    ][];
    expect(calls[0][0]).toHaveLength(1);
  });

  it('should return all events when query is empty', async () => {
    await command.handleAutocomplete(mockAutocomplete as never);
    const calls = mockAutocomplete.respond.mock.calls as [
      { name: string; value: number }[],
    ][];
    expect(calls[0][0]).toHaveLength(2);
  });
});

describe('InviteCommand — autocomplete error & format', () => {
  let command: InviteCommand;
  let services: ReturnType<typeof createMockServices>;

  beforeEach(() => {
    services = createMockServices();
    command = buildCommand(services);
  });

  it('should respond with empty array on error', async () => {
    services.eventsService.findAll.mockRejectedValue(new Error('DB error'));
    const mockAutocomplete = {
      options: { getFocused: jest.fn().mockReturnValue('') },
      respond: jest.fn().mockResolvedValue(undefined),
    };
    await command.handleAutocomplete(mockAutocomplete as never);
    expect(mockAutocomplete.respond).toHaveBeenCalledWith([]);
  });

  it('should format event names with date and time', async () => {
    const mockAutocomplete = {
      options: { getFocused: jest.fn().mockReturnValue('') },
      respond: jest.fn().mockResolvedValue(undefined),
    };
    await command.handleAutocomplete(mockAutocomplete as never);
    const calls = mockAutocomplete.respond.mock.calls as [
      { name: string; value: number }[],
    ][];
    expect(calls[0][0][0].name).toContain('Mythic Raid Night');
    expect(calls[0][0][0].name).toContain('Feb');
  });
});
