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

function makeCountSelectChain(rows: unknown[] = []) {
  const chain: Record<string, jest.Mock> = {};
  chain.from = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockResolvedValue(rows);
  return chain;
}

function makeUpdateChain() {
  const chain: Record<string, jest.Mock> = {};
  chain.set = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockResolvedValue(undefined);
  return chain;
}

const mockEvent = {
  id: 42,
  title: 'Raid Night',
  creatorId: 10,
  gameId: 5,
  recurrenceGroupId: 'rec-uuid-123',
  notificationChannelOverride: null,
  duration: [
    new Date('2026-04-01T20:00:00Z'),
    new Date('2026-04-01T23:00:00Z'),
  ],
};

const mockCreatorUser = { id: 10, role: 'member' };
const mockAdminUser = { id: 99, role: 'admin' };
const mockOperatorUser = { id: 88, role: 'operator' };

const mockUpdatedEvent = {
  events: {
    id: 42,
    title: 'Raid Night',
    description: null,
    creatorId: 10,
    gameId: 5,
    recurrenceGroupId: 'rec-uuid-123',
    notificationChannelOverride: 'channel-override-id',
    duration: [
      new Date('2026-04-01T20:00:00Z'),
      new Date('2026-04-01T23:00:00Z'),
    ],
    maxAttendees: null,
    slotConfig: null,
  },
  games: { name: 'World of Warcraft', coverUrl: 'https://example.com/art.jpg' },
};

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

async function buildModule(mockDb: { select: jest.Mock; update: jest.Mock }) {
  return Test.createTestingModule({
    providers: [
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
    ],
  }).compile();
}

const raidsCh = { id: 'ch-999', name: 'raids', type: ChannelType.GuildText };

describe('BindCommand ROK-599 routing — event option routing', () => {
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

  it('rejects a non-numeric event ID', async () => {
    const interaction = mockEventBindInteraction({
      eventValue: 'not-a-number',
    });
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringMatching(/invalid event/i),
    );
  });

  it('routes to event bind when event option is provided', async () => {
    mockDb.select = jest.fn().mockReturnValue(makeSelectChain([]));
    const interaction = mockEventBindInteraction({ eventValue: '42' });
    await command.handleInteraction(interaction as unknown as HandleParam);
    const svc = command[
      'channelBindingsService'
    ] as jest.Mocked<ChannelBindingsService>;
    expect(svc.bind).not.toHaveBeenCalled();
  });
});

describe('BindCommand ROK-599 routing — event not found', () => {
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

  it('replies not-found when event does not exist', async () => {
    mockDb.select = jest.fn().mockReturnValue(makeSelectChain([]));
    const interaction = mockEventBindInteraction();
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringMatching(/event not found/i),
    );
  });
});

describe('BindCommand ROK-599 routing — user not found', () => {
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

  it('replies account-required when no RL account', async () => {
    mockDb.select = jest
      .fn()
      .mockReturnValueOnce(makeSelectChain([mockEvent]))
      .mockReturnValueOnce(makeSelectChain([]));
    const interaction = mockEventBindInteraction();
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringMatching(/raid ledger account/i),
    );
  });
});

describe('BindCommand ROK-599 routing — permission checks', () => {
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

  it('rejects non-creator member', async () => {
    const nonCreatorUser = { id: 55, role: 'member' };
    mockDb.select = jest
      .fn()
      .mockReturnValueOnce(makeSelectChain([mockEvent]))
      .mockReturnValueOnce(makeSelectChain([nonCreatorUser]));
    const interaction = mockEventBindInteraction({ channelOption: raidsCh });
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringMatching(/only modify events you created/i),
    );
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('allows the event creator', async () => {
    mockDb.select = jest
      .fn()
      .mockReturnValueOnce(makeSelectChain([mockEvent]))
      .mockReturnValueOnce(makeSelectChain([mockCreatorUser]))
      .mockReturnValueOnce(makeSelectChain([mockUpdatedEvent]))
      .mockReturnValueOnce(makeCountSelectChain([{ count: 3 }]));
    mockDb.update = jest.fn().mockReturnValue(makeUpdateChain());
    const interaction = mockEventBindInteraction({ channelOption: raidsCh });
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(mockDb.update).toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.arrayContaining([expect.anything()]) as unknown,
      }),
    );
  });

  it('allows an admin to bind any event', async () => {
    mockDb.select = jest
      .fn()
      .mockReturnValueOnce(makeSelectChain([mockEvent]))
      .mockReturnValueOnce(makeSelectChain([mockAdminUser]))
      .mockReturnValueOnce(makeSelectChain([mockUpdatedEvent]))
      .mockReturnValueOnce(makeCountSelectChain([{ count: 0 }]));
    mockDb.update = jest.fn().mockReturnValue(makeUpdateChain());
    const interaction = mockEventBindInteraction({
      discordUserId: 'admin-discord-id',
      channelOption: raidsCh,
    });
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('allows an operator to bind any event', async () => {
    mockDb.select = jest
      .fn()
      .mockReturnValueOnce(makeSelectChain([mockEvent]))
      .mockReturnValueOnce(makeSelectChain([mockOperatorUser]))
      .mockReturnValueOnce(makeSelectChain([mockUpdatedEvent]))
      .mockReturnValueOnce(makeCountSelectChain([{ count: 0 }]));
    mockDb.update = jest.fn().mockReturnValue(makeUpdateChain());
    const interaction = mockEventBindInteraction({
      discordUserId: 'operator-discord-id',
      channelOption: raidsCh,
    });
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(mockDb.update).toHaveBeenCalled();
  });
});

describe('BindCommand ROK-599 routing — missing channel and game', () => {
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

  it('replies with usage hint when neither provided', async () => {
    mockDb.select = jest
      .fn()
      .mockReturnValueOnce(makeSelectChain([mockEvent]))
      .mockReturnValueOnce(makeSelectChain([mockCreatorUser]));
    const interaction = mockEventBindInteraction({
      channelOption: null,
      gameOption: null,
    });
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringMatching(/provide.*channel.*game/i),
    );
    expect(mockDb.update).not.toHaveBeenCalled();
  });
});
