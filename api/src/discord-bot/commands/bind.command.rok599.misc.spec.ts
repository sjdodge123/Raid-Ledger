/**
 * ROK-599: Tests for BindCommand — per-event bind operations.
 * Covers notification channel override, game reassignment, permission checks,
 * and autocomplete for the new 'event' option.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BindCommand } from './bind.command';
import { ChannelBindingsService } from '../services/channel-bindings.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { ChannelType } from 'discord.js';

function makeSelectChain(rows: unknown[] = []) {
  const chain: Record<string, jest.Mock> = {};
  chain.from = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockReturnValue(chain);
  chain.limit = jest.fn().mockResolvedValue(rows);
  chain.leftJoin = jest.fn().mockReturnValue(chain);
  chain.orderBy = jest.fn().mockResolvedValue(rows);
  return chain;
}

function makeUpdateChain() {
  const chain: Record<string, jest.Mock> = {};
  chain.set = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockResolvedValue(undefined);
  return chain;
}

const mockCreatorUser = { id: 10, role: 'member' };
const mockAdminUser = { id: 99, role: 'admin' };

function buildMockDb(selectCalls: unknown[][]) {
  let callIndex = 0;
  const selectFn = jest.fn().mockImplementation(() => {
    const rows = selectCalls[callIndex] ?? [];
    callIndex++;
    return makeSelectChain(rows);
  });
  return {
    select: selectFn,
    update: jest.fn().mockReturnValue(makeUpdateChain()),
  };
}

type InteractionOverrides = {
  guildId?: string | null;
  discordUserId?: string;
  eventValue?: string | null;
  channelOption?: object | null;
  gameOption?: string | null;
};

function mockEventBindInteraction(overrides: InteractionOverrides = {}) {
  const {
    guildId = 'guild-123',
    discordUserId = 'discord-user-100',
    eventValue = '42',
    channelOption = null,
    gameOption = null,
  } = overrides;
  return {
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    guildId,
    user: { id: discordUserId },
    channel: {
      id: 'channel-456',
      name: 'general',
      type: ChannelType.GuildText,
    },
    options: {
      getString: jest.fn().mockImplementation((name: string) => {
        if (name === 'event') return eventValue;
        if (name === 'game') return gameOption;
        if (name === 'series') return null;
        return null;
      }),
      getChannel: jest.fn().mockReturnValue(channelOption),
    },
  };
}

type HandleParam = Parameters<BindCommand['handleInteraction']>[0];

function makeModuleProviders(mockDb: { select: jest.Mock; update: jest.Mock }) {
  return [
    BindCommand,
    {
      provide: ChannelBindingsService,
      useValue: {
        bind: jest
          .fn()
          .mockResolvedValue({ binding: {}, replacedChannelIds: [] }),
        detectBehavior: jest.fn().mockReturnValue('game-announcements'),
      },
    },
    { provide: DrizzleAsyncProvider, useValue: mockDb },
    { provide: EventEmitter2, useValue: { emit: jest.fn() } },
  ];
}

async function buildModule(mockDb: { select: jest.Mock; update: jest.Mock }) {
  return Test.createTestingModule({
    providers: makeModuleProviders(mockDb),
  }).compile();
}

describe('BindCommand ROK-599 misc — guild guard', () => {
  let command: BindCommand;

  beforeEach(async () => {
    const mockDb = buildMockDb([]);
    const module: TestingModule = await buildModule(mockDb);
    command = module.get(BindCommand);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('rejects event bind when used outside a guild', async () => {
    const interaction = mockEventBindInteraction({ guildId: null });
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(interaction.editReply).toHaveBeenCalledWith(
      'This command can only be used in a server.',
    );
  });
});

describe('BindCommand ROK-599 misc — getDefinition', () => {
  let command: BindCommand;

  beforeEach(async () => {
    const mockDb = buildMockDb([]);
    const module: TestingModule = await buildModule(mockDb);
    command = module.get(BindCommand);
  });

  it('includes an "event" option with autocomplete', () => {
    const definition = command.getDefinition();
    const options = definition.options as
      | Array<{ name: string; autocomplete?: boolean }>
      | undefined;
    const eventOption = options?.find((o) => o.name === 'event');
    expect(eventOption).toBeDefined();
    expect(eventOption?.autocomplete).toBe(true);
  });
});

type AutocompleteParam = Parameters<BindCommand['handleAutocomplete']>[0];

function makeAutocompleteInteraction(
  overrides: {
    focusedName?: string;
    focusedValue?: string;
    discordUserId?: string;
  } = {},
) {
  const {
    focusedName = 'event',
    focusedValue = '',
    discordUserId = 'discord-user-100',
  } = overrides;
  return {
    options: {
      getFocused: jest
        .fn()
        .mockReturnValue({ name: focusedName, value: focusedValue }),
    },
    user: { id: discordUserId },
    respond: jest.fn().mockResolvedValue(undefined),
  };
}

function makeEventsAutocompleteChain(rows: unknown[]) {
  return {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        orderBy: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue(rows),
        }),
      }),
    }),
  };
}

describe('BindCommand ROK-599 misc — autocomplete: admin events', () => {
  let command: BindCommand;
  let mockDb: ReturnType<typeof buildMockDb>;

  beforeEach(async () => {
    mockDb = buildMockDb([]);
    const module: TestingModule = await buildModule(mockDb);
    command = module.get(BindCommand);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('responds with upcoming events for admin user', async () => {
    const mockEvents = [
      {
        id: 1,
        title: 'Raid Alpha',
        duration: [
          new Date('2026-04-01T20:00:00Z'),
          new Date('2026-04-01T23:00:00Z'),
        ],
      },
      {
        id: 2,
        title: 'Raid Beta',
        duration: [
          new Date('2026-04-08T20:00:00Z'),
          new Date('2026-04-08T23:00:00Z'),
        ],
      },
    ];
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([mockAdminUser]))
      .mockReturnValueOnce(makeEventsAutocompleteChain(mockEvents));
    const interaction = makeAutocompleteInteraction({
      discordUserId: 'admin-discord-id',
    });
    await command.handleAutocomplete(
      interaction as unknown as AutocompleteParam,
    );
    expect(interaction.respond).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          name: expect.stringContaining('Raid Alpha') as unknown,
          value: '1',
        }),
      ]),
    );
  });
});

describe('BindCommand ROK-599 misc — autocomplete: member events', () => {
  let command: BindCommand;
  let mockDb: ReturnType<typeof buildMockDb>;

  beforeEach(async () => {
    mockDb = buildMockDb([]);
    const module: TestingModule = await buildModule(mockDb);
    command = module.get(BindCommand);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('responds with only own events for non-admin', async () => {
    const ownEvents = [
      {
        id: 42,
        title: 'My Event',
        duration: [
          new Date('2026-04-01T20:00:00Z'),
          new Date('2026-04-01T23:00:00Z'),
        ],
      },
    ];
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([{ id: 10, role: 'member' }]))
      .mockReturnValueOnce(makeEventsAutocompleteChain(ownEvents));
    const interaction = makeAutocompleteInteraction({
      discordUserId: 'member-discord-id',
    });
    await command.handleAutocomplete(
      interaction as unknown as AutocompleteParam,
    );
    expect(interaction.respond).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ value: '42' })]),
    );
  });
});

describe('BindCommand ROK-599 misc — autocomplete: format & empty', () => {
  let command: BindCommand;
  let mockDb: ReturnType<typeof buildMockDb>;

  beforeEach(async () => {
    mockDb = buildMockDb([]);
    const module: TestingModule = await buildModule(mockDb);
    command = module.get(BindCommand);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('formats autocomplete result as "Title (Month Day)"', async () => {
    const mockEvents = [
      {
        id: 42,
        title: 'Summer Raid',
        duration: [
          new Date('2026-06-15T20:00:00Z'),
          new Date('2026-06-15T23:00:00Z'),
        ],
      },
    ];
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([mockAdminUser]))
      .mockReturnValueOnce(makeEventsAutocompleteChain(mockEvents));
    const interaction = makeAutocompleteInteraction();
    await command.handleAutocomplete(
      interaction as unknown as AutocompleteParam,
    );
    const respondArg = (
      interaction.respond.mock.calls as unknown[][]
    )[0][0] as Array<{ name: string; value: string }>;
    expect(respondArg[0].name).toMatch(/Summer Raid/);
    expect(respondArg[0].name).toMatch(/Jun.*15|June.*15/i);
    expect(respondArg[0].value).toBe('42');
  });

  it('responds with empty array when no accessible events', async () => {
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([mockCreatorUser]))
      .mockReturnValueOnce(makeEventsAutocompleteChain([]));
    const interaction = makeAutocompleteInteraction();
    await command.handleAutocomplete(
      interaction as unknown as AutocompleteParam,
    );
    expect(interaction.respond).toHaveBeenCalledWith([]);
  });
});
