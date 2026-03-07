/**
 * ROK-599: Tests for UnbindCommand — clearing the per-event notification channel override.
 * Covers the handleEventUnbind path: event lookup, permission checks,
 * clearing the override, emitting event.updated, and autocomplete.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UnbindCommand } from './unbind.command';
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

function makeUpdateChain() {
  const chain: Record<string, jest.Mock> = {};
  chain.set = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockResolvedValue(undefined);
  return chain;
}

const mockEventWithOverride = {
  id: 42,
  title: 'Raid Night',
  creatorId: 10,
  gameId: 5,
  recurrenceGroupId: 'rec-uuid-123',
  notificationChannelOverride: 'override-channel-id',
  duration: [
    new Date('2026-04-01T20:00:00Z'),
    new Date('2026-04-01T23:00:00Z'),
  ],
};

const mockEventWithoutOverride = {
  ...mockEventWithOverride,
  notificationChannelOverride: null,
};

const mockCreatorUser = { id: 10, role: 'member' };
const mockAdminUser = { id: 99, role: 'admin' };
const mockOperatorUser = { id: 88, role: 'operator' };
const mockOtherUser = { id: 55, role: 'member' };

const mockUpdatedEvent = {
  events: {
    id: 42,
    title: 'Raid Night',
    description: null,
    gameId: 5,
    recurrenceGroupId: 'rec-uuid-123',
    notificationChannelOverride: null,
    duration: [
      new Date('2026-04-01T20:00:00Z'),
      new Date('2026-04-01T23:00:00Z'),
    ],
    maxAttendees: null,
    slotConfig: null,
  },
  games: { name: 'World of Warcraft', coverUrl: 'https://example.com/art.jpg' },
};

type InteractionOverrides = {
  guildId?: string | null;
  discordUserId?: string;
  eventValue?: string | null;
};

function mockEventUnbindInteraction(overrides: InteractionOverrides = {}) {
  const {
    guildId = 'guild-123',
    discordUserId = 'discord-user-100',
    eventValue = '42',
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
        if (name === 'series') return null;
        return null;
      }),
      getChannel: jest.fn().mockReturnValue(null),
    },
  };
}

type HandleParam = Parameters<UnbindCommand['handleInteraction']>[0];

async function buildModule(mockDb: { select: jest.Mock; update: jest.Mock }) {
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

describe('UnbindCommand ROK-599 — guards', () => {
  let command: UnbindCommand;
  let mockDb: { select: jest.Mock; update: jest.Mock };

  beforeEach(async () => {
    mockDb = {
      select: jest.fn(),
      update: jest.fn().mockReturnValue(makeUpdateChain()),
    };
    const module: TestingModule = await buildModule(mockDb);
    command = module.get(UnbindCommand);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('rejects event unbind outside a guild', async () => {
    const interaction = mockEventUnbindInteraction({ guildId: null });
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(interaction.editReply).toHaveBeenCalledWith(
      'This command can only be used in a server.',
    );
  });

  it('rejects a non-numeric event ID', async () => {
    const interaction = mockEventUnbindInteraction({
      eventValue: 'not-a-number',
    });
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringMatching(/invalid event/i),
    );
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('replies not-found when event does not exist', async () => {
    mockDb.select = jest.fn().mockReturnValue(makeSelectChain([]));
    const interaction = mockEventUnbindInteraction();
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringMatching(/event not found/i),
    );
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('replies account-required when no RL account', async () => {
    mockDb.select = jest
      .fn()
      .mockReturnValueOnce(makeSelectChain([mockEventWithOverride]))
      .mockReturnValueOnce(makeSelectChain([]));
    const interaction = mockEventUnbindInteraction();
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringMatching(/raid ledger account/i),
    );
  });
});

describe('UnbindCommand ROK-599 — permission checks', () => {
  let command: UnbindCommand;
  let mockDb: { select: jest.Mock; update: jest.Mock };

  beforeEach(async () => {
    mockDb = {
      select: jest.fn(),
      update: jest.fn().mockReturnValue(makeUpdateChain()),
    };
    const module: TestingModule = await buildModule(mockDb);
    command = module.get(UnbindCommand);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('rejects non-creator member', async () => {
    mockDb.select = jest
      .fn()
      .mockReturnValueOnce(makeSelectChain([mockEventWithOverride]))
      .mockReturnValueOnce(makeSelectChain([mockOtherUser]));
    const interaction = mockEventUnbindInteraction({
      discordUserId: 'other-user-discord',
    });
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringMatching(/only modify events you created/i),
    );
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('allows the event creator', async () => {
    mockDb.select = jest
      .fn()
      .mockReturnValueOnce(makeSelectChain([mockEventWithOverride]))
      .mockReturnValueOnce(makeSelectChain([mockCreatorUser]))
      .mockReturnValueOnce(makeSelectChain([mockUpdatedEvent]));
    mockDb.update = jest.fn().mockReturnValue(makeUpdateChain());
    const interaction = mockEventUnbindInteraction();
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('allows an admin', async () => {
    mockDb.select = jest
      .fn()
      .mockReturnValueOnce(makeSelectChain([mockEventWithOverride]))
      .mockReturnValueOnce(makeSelectChain([mockAdminUser]))
      .mockReturnValueOnce(makeSelectChain([mockUpdatedEvent]));
    mockDb.update = jest.fn().mockReturnValue(makeUpdateChain());
    const interaction = mockEventUnbindInteraction({
      discordUserId: 'admin-discord-id',
    });
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('allows an operator', async () => {
    mockDb.select = jest
      .fn()
      .mockReturnValueOnce(makeSelectChain([mockEventWithOverride]))
      .mockReturnValueOnce(makeSelectChain([mockOperatorUser]))
      .mockReturnValueOnce(makeSelectChain([mockUpdatedEvent]));
    mockDb.update = jest.fn().mockReturnValue(makeUpdateChain());
    const interaction = mockEventUnbindInteraction({
      discordUserId: 'operator-discord-id',
    });
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(mockDb.update).toHaveBeenCalled();
  });
});

describe('UnbindCommand ROK-599 — no override present', () => {
  let command: UnbindCommand;
  let mockDb: { select: jest.Mock; update: jest.Mock };

  beforeEach(async () => {
    mockDb = {
      select: jest.fn(),
      update: jest.fn().mockReturnValue(makeUpdateChain()),
    };
    const module: TestingModule = await buildModule(mockDb);
    command = module.get(UnbindCommand);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('replies "no override to clear" when no override set', async () => {
    mockDb.select = jest
      .fn()
      .mockReturnValueOnce(makeSelectChain([mockEventWithoutOverride]))
      .mockReturnValueOnce(makeSelectChain([mockCreatorUser]));
    const interaction = mockEventUnbindInteraction();
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringMatching(/no notification channel override/i),
    );
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('includes the event title in the message', async () => {
    mockDb.select = jest
      .fn()
      .mockReturnValueOnce(makeSelectChain([mockEventWithoutOverride]))
      .mockReturnValueOnce(makeSelectChain([mockCreatorUser]));
    const interaction = mockEventUnbindInteraction();
    await command.handleInteraction(interaction as unknown as HandleParam);
    const replyArg = (
      interaction.editReply.mock.calls as unknown[][]
    )[0][0] as string;
    expect(replyArg).toContain('Raid Night');
  });
});

describe('UnbindCommand ROK-599 — clearing the override', () => {
  let command: UnbindCommand;
  let eventEmitter: jest.Mocked<EventEmitter2>;
  let mockDb: { select: jest.Mock; update: jest.Mock };

  function setupClearOverrideMocks() {
    mockDb.select = jest
      .fn()
      .mockReturnValueOnce(makeSelectChain([mockEventWithOverride]))
      .mockReturnValueOnce(makeSelectChain([mockCreatorUser]))
      .mockReturnValueOnce(makeSelectChain([mockUpdatedEvent]));
    mockDb.update = jest.fn().mockReturnValue(makeUpdateChain());
  }

  beforeEach(async () => {
    mockDb = {
      select: jest.fn(),
      update: jest.fn().mockReturnValue(makeUpdateChain()),
    };
    const module: TestingModule = await buildModule(mockDb);
    command = module.get(UnbindCommand);
    eventEmitter = module.get(EventEmitter2);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('sets notificationChannelOverride to null', async () => {
    const updateChain = makeUpdateChain();
    setupClearOverrideMocks();
    mockDb.update = jest.fn().mockReturnValue(updateChain);
    const interaction = mockEventUnbindInteraction();
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ notificationChannelOverride: null }),
    );
  });

  it('emits event.updated with null override', async () => {
    setupClearOverrideMocks();
    const interaction = mockEventUnbindInteraction();
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      APP_EVENT_EVENTS.UPDATED,
      expect.objectContaining({
        eventId: 42,
        notificationChannelOverride: null,
      }),
    );
  });

  it('emits with game data intact', async () => {
    setupClearOverrideMocks();
    const interaction = mockEventUnbindInteraction();
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      APP_EVENT_EVENTS.UPDATED,
      expect.objectContaining({
        event: expect.objectContaining({
          game: expect.objectContaining({
            name: 'World of Warcraft',
          }) as unknown,
        }) as unknown,
      }),
    );
  });

  it('emits with recurrenceGroupId intact', async () => {
    setupClearOverrideMocks();
    const interaction = mockEventUnbindInteraction();
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      APP_EVENT_EVENTS.UPDATED,
      expect.objectContaining({ recurrenceGroupId: 'rec-uuid-123' }),
    );
  });

  it('replies with success embed', async () => {
    setupClearOverrideMocks();
    const interaction = mockEventUnbindInteraction();
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.arrayContaining([expect.anything()]) as unknown,
      }),
    );
  });

  it('includes event title in success reply', async () => {
    setupClearOverrideMocks();
    const interaction = mockEventUnbindInteraction();
    await command.handleInteraction(interaction as unknown as HandleParam);
    const replyArg = (
      interaction.editReply.mock.calls as unknown[][]
    )[0][0] as {
      embeds: { data: { description: string } }[];
    };
    expect(replyArg.embeds[0].data.description ?? '').toContain('Raid Night');
  });

  it('mentions fallback to default channel', async () => {
    setupClearOverrideMocks();
    const interaction = mockEventUnbindInteraction();
    await command.handleInteraction(interaction as unknown as HandleParam);
    const replyArg = (
      interaction.editReply.mock.calls as unknown[][]
    )[0][0] as {
      embeds: { data: { description: string } }[];
    };
    expect((replyArg.embeds[0].data.description ?? '').toLowerCase()).toContain(
      'default',
    );
  });
});

describe('UnbindCommand ROK-599 — definition & routing', () => {
  let command: UnbindCommand;
  let mockDb: { select: jest.Mock; update: jest.Mock };

  beforeEach(async () => {
    mockDb = {
      select: jest.fn(),
      update: jest.fn().mockReturnValue(makeUpdateChain()),
    };
    const module: TestingModule = await buildModule(mockDb);
    command = module.get(UnbindCommand);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('includes "event" option with autocomplete', () => {
    const options = command.getDefinition().options as
      | Array<{ name: string; autocomplete?: boolean }>
      | undefined;
    const eventOption = options?.find((o) => o.name === 'event');
    expect(eventOption).toBeDefined();
    expect(eventOption?.autocomplete).toBe(true);
  });

  it('has description that mentions "override"', () => {
    const options = command.getDefinition().options as
      | Array<{ name: string; description: string }>
      | undefined;
    const eventOption = options?.find((o) => o.name === 'event');
    expect(eventOption?.description.toLowerCase()).toContain('override');
  });

  it('routes to event unbind (not channel unbind)', async () => {
    mockDb.select = jest.fn().mockReturnValue(makeSelectChain([]));
    const interaction = mockEventUnbindInteraction({ eventValue: '99' });
    await command.handleInteraction(interaction as unknown as HandleParam);
    const svc = command[
      'channelBindingsService'
    ] as jest.Mocked<ChannelBindingsService>;
    expect(svc.unbind).not.toHaveBeenCalled();
  });
});

describe('UnbindCommand ROK-599 — autocomplete', () => {
  let command: UnbindCommand;
  let mockDb: { select: jest.Mock; update: jest.Mock };

  type AutocompleteParam = Parameters<UnbindCommand['handleAutocomplete']>[0];

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

  beforeEach(async () => {
    mockDb = {
      select: jest.fn(),
      update: jest.fn().mockReturnValue(makeUpdateChain()),
    };
    const module: TestingModule = await buildModule(mockDb);
    command = module.get(UnbindCommand);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('responds with events the user can manage', async () => {
    const mockEvents = [
      {
        id: 42,
        title: 'Raid Night',
        duration: [
          new Date('2026-04-01T20:00:00Z'),
          new Date('2026-04-01T23:00:00Z'),
        ],
      },
    ];
    mockDb.select = jest
      .fn()
      .mockReturnValueOnce(makeSelectChain([mockCreatorUser]))
      .mockReturnValueOnce(makeEventsAutocompleteChain(mockEvents));
    const interaction = makeAutocompleteInteraction();
    await command.handleAutocomplete(
      interaction as unknown as AutocompleteParam,
    );
    expect(interaction.respond).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          name: expect.stringContaining('Raid Night') as unknown,
          value: '42',
        }),
      ]),
    );
  });

  it('admin sees all upcoming events', async () => {
    const mockEvents = [
      {
        id: 1,
        title: 'Event One',
        duration: [
          new Date('2026-04-01T20:00:00Z'),
          new Date('2026-04-01T23:00:00Z'),
        ],
      },
      {
        id: 2,
        title: 'Event Two',
        duration: [
          new Date('2026-04-08T20:00:00Z'),
          new Date('2026-04-08T23:00:00Z'),
        ],
      },
    ];
    mockDb.select = jest
      .fn()
      .mockReturnValueOnce(makeSelectChain([mockAdminUser]))
      .mockReturnValueOnce(makeEventsAutocompleteChain(mockEvents));
    const interaction = makeAutocompleteInteraction({
      discordUserId: 'admin-discord-id',
    });
    await command.handleAutocomplete(
      interaction as unknown as AutocompleteParam,
    );
    const respondArg = (
      interaction.respond.mock.calls as unknown[][]
    )[0][0] as unknown[];
    expect(respondArg).toHaveLength(2);
  });

  it('responds with empty array when no events', async () => {
    mockDb.select = jest
      .fn()
      .mockReturnValueOnce(makeSelectChain([mockCreatorUser]))
      .mockReturnValueOnce(makeEventsAutocompleteChain([]));
    const interaction = makeAutocompleteInteraction();
    await command.handleAutocomplete(
      interaction as unknown as AutocompleteParam,
    );
    expect(interaction.respond).toHaveBeenCalledWith([]);
  });
});
