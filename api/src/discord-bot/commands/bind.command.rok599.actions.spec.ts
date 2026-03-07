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
import { APP_EVENT_EVENTS } from '../discord-bot.constants';

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

const channelOption = {
  id: 'override-channel-999',
  name: 'raid-announcements',
  type: ChannelType.GuildText,
};

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
    channelOption: chOpt = null,
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
      getChannel: jest.fn().mockReturnValue(chOpt),
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

function getEmbedDescription(
  interaction: ReturnType<typeof mockEventBindInteraction>,
) {
  const replyArg = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
    embeds: { data: { description: string } }[];
  };
  return replyArg.embeds[0].data.description ?? '';
}

/** Setup select mocks for a channel override test with re-fetch and signup count. */
function setupChannelOverrideMocks(
  mockDb: { select: jest.Mock; update: jest.Mock },
  updatedEvent = mockUpdatedEvent,
  signupCount = 0,
) {
  mockDb.select = jest
    .fn()
    .mockReturnValueOnce(makeSelectChain([mockEvent]))
    .mockReturnValueOnce(makeSelectChain([mockCreatorUser]))
    .mockReturnValueOnce(makeSelectChain([updatedEvent]))
    .mockReturnValueOnce(makeCountSelectChain([{ count: signupCount }]));
  mockDb.update = jest.fn().mockReturnValue(makeUpdateChain());
}

describe('BindCommand ROK-599 actions — channel override', () => {
  let command: BindCommand;
  let eventEmitter: jest.Mocked<EventEmitter2>;
  let mockDb: { select: jest.Mock; update: jest.Mock };

  beforeEach(async () => {
    mockDb = {
      select: jest.fn(),
      update: jest.fn().mockReturnValue(makeUpdateChain()),
    };
    const module: TestingModule = await buildModule(mockDb);
    command = module.get(BindCommand);
    eventEmitter = module.get(EventEmitter2);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('updates notificationChannelOverride on the event', async () => {
    const updateChain = makeUpdateChain();
    setupChannelOverrideMocks(mockDb);
    mockDb.update = jest.fn().mockReturnValue(updateChain);
    const interaction = mockEventBindInteraction({ channelOption });
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(mockDb.update).toHaveBeenCalled();
    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        notificationChannelOverride: 'override-channel-999',
      }),
    );
  });

  it('includes the channel name in success reply', async () => {
    setupChannelOverrideMocks(mockDb);
    const interaction = mockEventBindInteraction({ channelOption });
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(getEmbedDescription(interaction)).toContain('raid-announcements');
  });

  it('emits event.updated with notificationChannelOverride', async () => {
    const updatedWithOverride = {
      ...mockUpdatedEvent,
      events: {
        ...mockUpdatedEvent.events,
        notificationChannelOverride: 'override-channel-999',
      },
    };
    setupChannelOverrideMocks(mockDb, updatedWithOverride, 5);
    const interaction = mockEventBindInteraction({ channelOption });
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      APP_EVENT_EVENTS.UPDATED,
      expect.objectContaining({
        eventId: 42,
        notificationChannelOverride: 'override-channel-999',
      }),
    );
  });

  it('replies with success embed after override', async () => {
    setupChannelOverrideMocks(mockDb);
    const interaction = mockEventBindInteraction({ channelOption });
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.arrayContaining([expect.anything()]) as unknown,
      }),
    );
  });
});

describe('BindCommand ROK-599 actions — game reassignment: none/general', () => {
  let command: BindCommand;
  let mockDb: { select: jest.Mock; update: jest.Mock };

  beforeEach(async () => {
    mockDb = {
      select: jest.fn(),
      update: jest.fn().mockReturnValue(makeUpdateChain()),
    };
    const module: TestingModule = await buildModule(mockDb);
    command = module.get(BindCommand);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('sets gameId to null when game is "none"', async () => {
    const updateChain = makeUpdateChain();
    const noGameEvent = {
      ...mockUpdatedEvent,
      events: { ...mockUpdatedEvent.events, gameId: null },
    };
    mockDb.select = jest
      .fn()
      .mockReturnValueOnce(makeSelectChain([mockEvent]))
      .mockReturnValueOnce(makeSelectChain([mockCreatorUser]))
      .mockReturnValueOnce(makeSelectChain([noGameEvent]))
      .mockReturnValueOnce(makeCountSelectChain([{ count: 0 }]));
    mockDb.update = jest.fn().mockReturnValue(updateChain);
    const interaction = mockEventBindInteraction({ gameOption: 'none' });
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ gameId: null }),
    );
  });

  it('sets gameId to null for "general" (case-insensitive)', async () => {
    const updateChain = makeUpdateChain();
    const noGameEvent = {
      ...mockUpdatedEvent,
      events: { ...mockUpdatedEvent.events, gameId: null },
    };
    mockDb.select = jest
      .fn()
      .mockReturnValueOnce(makeSelectChain([mockEvent]))
      .mockReturnValueOnce(makeSelectChain([mockCreatorUser]))
      .mockReturnValueOnce(makeSelectChain([noGameEvent]))
      .mockReturnValueOnce(makeCountSelectChain([{ count: 0 }]));
    mockDb.update = jest.fn().mockReturnValue(updateChain);
    const interaction = mockEventBindInteraction({ gameOption: 'General' });
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ gameId: null }),
    );
  });

  it('replies with game-removed message for "none"', async () => {
    const updatedNoGame = {
      events: { ...mockUpdatedEvent.events, gameId: null },
      games: null,
    };
    mockDb.select = jest
      .fn()
      .mockReturnValueOnce(makeSelectChain([mockEvent]))
      .mockReturnValueOnce(makeSelectChain([mockCreatorUser]))
      .mockReturnValueOnce(makeSelectChain([updatedNoGame]))
      .mockReturnValueOnce(makeCountSelectChain([{ count: 0 }]));
    mockDb.update = jest.fn().mockReturnValue(makeUpdateChain());
    const interaction = mockEventBindInteraction({ gameOption: 'none' });
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(getEmbedDescription(interaction).toLowerCase()).toContain('general');
  });
});

describe('BindCommand ROK-599 actions — game reassignment: named game', () => {
  let command: BindCommand;
  let eventEmitter: jest.Mocked<EventEmitter2>;
  let mockDb: { select: jest.Mock; update: jest.Mock };

  beforeEach(async () => {
    mockDb = {
      select: jest.fn(),
      update: jest.fn().mockReturnValue(makeUpdateChain()),
    };
    const module: TestingModule = await buildModule(mockDb);
    command = module.get(BindCommand);
    eventEmitter = module.get(EventEmitter2);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('updates gameId when valid game name provided', async () => {
    const mockGame = { id: 7, name: 'Final Fantasy XIV' };
    const updateChain = makeUpdateChain();
    mockDb.select = jest
      .fn()
      .mockReturnValueOnce(makeSelectChain([mockEvent]))
      .mockReturnValueOnce(makeSelectChain([mockCreatorUser]))
      .mockReturnValueOnce(makeSelectChain([mockGame]))
      .mockReturnValueOnce(
        makeSelectChain([
          {
            events: { ...mockUpdatedEvent.events, gameId: 7 },
            games: { name: 'Final Fantasy XIV', coverUrl: null },
          },
        ]),
      )
      .mockReturnValueOnce(makeCountSelectChain([{ count: 2 }]));
    mockDb.update = jest.fn().mockReturnValue(updateChain);
    const interaction = mockEventBindInteraction({
      gameOption: 'Final Fantasy XIV',
    });
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ gameId: 7 }),
    );
  });

  it('replies game-not-found when name does not match', async () => {
    mockDb.select = jest
      .fn()
      .mockReturnValueOnce(makeSelectChain([mockEvent]))
      .mockReturnValueOnce(makeSelectChain([mockCreatorUser]))
      .mockReturnValueOnce(makeSelectChain([]));
    const interaction = mockEventBindInteraction({
      gameOption: 'Unknown Game XYZ',
    });
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringMatching(/not found/i),
    );
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('emits event.updated with new gameId', async () => {
    const mockGame = { id: 7, name: 'Final Fantasy XIV' };
    mockDb.select = jest
      .fn()
      .mockReturnValueOnce(makeSelectChain([mockEvent]))
      .mockReturnValueOnce(makeSelectChain([mockCreatorUser]))
      .mockReturnValueOnce(makeSelectChain([mockGame]))
      .mockReturnValueOnce(
        makeSelectChain([
          {
            events: {
              ...mockUpdatedEvent.events,
              gameId: 7,
              notificationChannelOverride: null,
            },
            games: { name: 'Final Fantasy XIV', coverUrl: null },
          },
        ]),
      )
      .mockReturnValueOnce(makeCountSelectChain([{ count: 4 }]));
    mockDb.update = jest.fn().mockReturnValue(makeUpdateChain());
    const interaction = mockEventBindInteraction({
      gameOption: 'Final Fantasy XIV',
    });
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      APP_EVENT_EVENTS.UPDATED,
      expect.objectContaining({ eventId: 42, gameId: 7 }),
    );
  });
});

describe('BindCommand ROK-599 actions — game removal events', () => {
  let command: BindCommand;
  let eventEmitter: jest.Mocked<EventEmitter2>;
  let mockDb: { select: jest.Mock; update: jest.Mock };

  beforeEach(async () => {
    mockDb = {
      select: jest.fn(),
      update: jest.fn().mockReturnValue(makeUpdateChain()),
    };
    const module: TestingModule = await buildModule(mockDb);
    command = module.get(BindCommand);
    eventEmitter = module.get(EventEmitter2);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  function setupGameRemovalMocks() {
    const updatedNoGame = {
      events: {
        ...mockUpdatedEvent.events,
        gameId: null,
        notificationChannelOverride: null,
      },
      games: null,
    };
    mockDb.select = jest
      .fn()
      .mockReturnValueOnce(makeSelectChain([mockEvent]))
      .mockReturnValueOnce(makeSelectChain([mockCreatorUser]))
      .mockReturnValueOnce(makeSelectChain([updatedNoGame]))
      .mockReturnValueOnce(makeCountSelectChain([{ count: 0 }]));
    mockDb.update = jest.fn().mockReturnValue(makeUpdateChain());
  }

  it('emits event.updated with null gameId', async () => {
    setupGameRemovalMocks();
    const interaction = mockEventBindInteraction({ gameOption: 'none' });
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      APP_EVENT_EVENTS.UPDATED,
      expect.objectContaining({ eventId: 42, gameId: null }),
    );
  });

  it('emits null game in event payload', async () => {
    setupGameRemovalMocks();
    const interaction = mockEventBindInteraction({ gameOption: 'none' });
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      APP_EVENT_EVENTS.UPDATED,
      expect.objectContaining({
        event: expect.objectContaining({ game: null }) as unknown,
      }),
    );
  });
});

describe('BindCommand ROK-599 actions — combined override + game', () => {
  let command: BindCommand;
  let eventEmitter: jest.Mocked<EventEmitter2>;
  let mockDb: { select: jest.Mock; update: jest.Mock };

  beforeEach(async () => {
    mockDb = {
      select: jest.fn(),
      update: jest.fn().mockReturnValue(makeUpdateChain()),
    };
    const module: TestingModule = await buildModule(mockDb);
    command = module.get(BindCommand);
    eventEmitter = module.get(EventEmitter2);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  function setupCombinedMocks() {
    const mockGame = { id: 7, name: 'Final Fantasy XIV' };
    const combinedUpdated = {
      events: {
        ...mockUpdatedEvent.events,
        gameId: 7,
        notificationChannelOverride: 'override-channel-999',
      },
      games: { name: 'Final Fantasy XIV', coverUrl: null },
    };
    mockDb.update = jest.fn().mockImplementation(() => makeUpdateChain());
    mockDb.select = jest
      .fn()
      .mockReturnValueOnce(makeSelectChain([mockEvent]))
      .mockReturnValueOnce(makeSelectChain([mockCreatorUser]))
      .mockReturnValueOnce(makeSelectChain([mockGame]))
      .mockReturnValueOnce(makeSelectChain([combinedUpdated]))
      .mockReturnValueOnce(makeCountSelectChain([{ count: 3 }]));
  }

  it('applies both channel override and game change', async () => {
    setupCombinedMocks();
    const interaction = mockEventBindInteraction({
      channelOption,
      gameOption: 'Final Fantasy XIV',
    });
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(mockDb.update).toHaveBeenCalledTimes(2);
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      APP_EVENT_EVENTS.UPDATED,
      expect.objectContaining({
        gameId: 7,
        notificationChannelOverride: 'override-channel-999',
      }),
    );
  });

  it('includes both changes in reply embed', async () => {
    setupCombinedMocks();
    const interaction = mockEventBindInteraction({
      channelOption,
      gameOption: 'Final Fantasy XIV',
    });
    await command.handleInteraction(interaction as unknown as HandleParam);
    const description = getEmbedDescription(interaction);
    expect(description).toContain('raid-announcements');
    expect(description).toContain('Final Fantasy XIV');
  });
});
