import { Test, TestingModule } from '@nestjs/testing';
import { ComponentType } from 'discord.js';
import { EventsListCommand } from './events-list.command';
import { EventsService } from '../../events/events.service';
import { UsersService } from '../../users/users.service';
import { MagicLinkService } from '../../auth/magic-link.service';
import { EMBED_COLORS } from '../discord-bot.constants';

const originalClientUrl = process.env.CLIENT_URL;

type FindAllReturn = Awaited<ReturnType<EventsService['findAll']>>;
type HandleParam = Parameters<EventsListCommand['handleInteraction']>[0];

const makeEvent = (overrides = {}) => ({
  id: 1,
  title: 'Test Raid',
  startTime: '2030-12-25T20:00:00.000Z',
  endTime: '2030-12-25T22:00:00.000Z',
  signupCount: 5,
  maxAttendees: 20,
  game: { name: 'WoW', coverUrl: null },
  ...overrides,
});

function makeProviders() {
  return [
    EventsListCommand,
    {
      provide: EventsService,
      useValue: { findAll: jest.fn(), findOne: jest.fn() },
    },
    { provide: UsersService, useValue: { findByDiscordId: jest.fn() } },
    { provide: MagicLinkService, useValue: { generateLink: jest.fn() } },
  ];
}

async function buildModule() {
  return Test.createTestingModule({
    providers: makeProviders(),
  }).compile();
}

function restoreClientUrl() {
  if (originalClientUrl !== undefined) {
    process.env.CLIENT_URL = originalClientUrl;
  } else {
    delete process.env.CLIENT_URL;
  }
}

function makeCollectorSpy() {
  let collectHandler: ((i: Record<string, unknown>) => void) | undefined;
  const spy = {
    on: jest
      .fn()
      .mockImplementation(
        (event: string, handler: (i: Record<string, unknown>) => void) => {
          if (event === 'collect') collectHandler = handler;
          return spy;
        },
      ),
  };
  return { spy, getCollectHandler: () => collectHandler };
}

function makeSelectInteraction(
  eventId: number,
  userId: string,
  updateMock: jest.Mock,
) {
  return {
    componentType: ComponentType.StringSelect,
    customId: 'event_select',
    values: [String(eventId)],
    user: { id: userId },
    update: updateMock,
  };
}

/**
 * Triggers handleInteraction and simulates a StringSelect event selection.
 */
async function triggerEventSelect(
  command: EventsListCommand,
  eventsService: jest.Mocked<EventsService>,
  selectedEventId: number,
  discordUserId: string,
  cachedEvents: ReturnType<typeof makeEvent>[],
) {
  const { spy, getCollectHandler } = makeCollectorSpy();
  const updateMock = jest.fn().mockResolvedValue(undefined);
  const replyMsg = {
    createMessageComponentCollector: jest.fn().mockReturnValue(spy),
  };
  const interaction = {
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(replyMsg),
    user: { id: discordUserId },
  };
  eventsService.findAll.mockResolvedValue({
    data: cachedEvents,
    meta: { total: cachedEvents.length, page: 1, limit: 10, totalPages: 1 },
  } as unknown as FindAllReturn);
  await command.handleInteraction(interaction as unknown as HandleParam);
  const selectInteraction = makeSelectInteraction(
    selectedEventId,
    discordUserId,
    updateMock,
  );
  getCollectHandler()!(selectInteraction as unknown as Record<string, unknown>);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { updateMock };
}

function getUpdateEmbedData(updateMock: jest.Mock) {
  return (updateMock.mock.calls as unknown[][])[0][0] as {
    embeds: {
      data: {
        title?: string;
        description?: string;
        color?: number;
        thumbnail?: { url: string };
      };
    }[];
    components: {
      components: {
        data: { custom_id?: string; label?: string; url?: string };
      }[];
    }[];
  };
}

describe('EventsListCommand — detail: title', () => {
  let module: TestingModule;
  let command: EventsListCommand;
  let eventsService: jest.Mocked<EventsService>;
  let usersService: jest.Mocked<UsersService>;

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    module = await buildModule();
    command = module.get(EventsListCommand);
    eventsService = module.get(EventsService);
    usersService = module.get(UsersService);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();
    restoreClientUrl();
  });

  it('should show event title in detail embed', async () => {
    const event = makeEvent({ id: 42, title: 'Dragon Boss Kill' });
    eventsService.findOne = jest.fn().mockResolvedValue(event);
    usersService.findByDiscordId = jest.fn().mockResolvedValue(null);
    const { updateMock } = await triggerEventSelect(
      command,
      eventsService,
      42,
      'user-123',
      [event],
    );
    expect(getUpdateEmbedData(updateMock).embeds[0].data.title).toBe(
      'Dragon Boss Kill',
    );
  });
});

describe('EventsListCommand — detail: game name', () => {
  let module: TestingModule;
  let command: EventsListCommand;
  let eventsService: jest.Mocked<EventsService>;
  let usersService: jest.Mocked<UsersService>;

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    module = await buildModule();
    command = module.get(EventsListCommand);
    eventsService = module.get(EventsService);
    usersService = module.get(UsersService);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();
    restoreClientUrl();
  });

  it('should include game name in description', async () => {
    const event = makeEvent({
      id: 43,
      game: { name: 'Final Fantasy XIV', coverUrl: null },
    });
    eventsService.findOne = jest.fn().mockResolvedValue(event);
    usersService.findByDiscordId = jest.fn().mockResolvedValue(null);
    const { updateMock } = await triggerEventSelect(
      command,
      eventsService,
      43,
      'user-123',
      [event],
    );
    expect(getUpdateEmbedData(updateMock).embeds[0].data.description).toContain(
      'Final Fantasy XIV',
    );
  });

  it('should show "No game" when game is null', async () => {
    const event = makeEvent({ id: 44, game: null });
    eventsService.findOne = jest.fn().mockResolvedValue(event);
    usersService.findByDiscordId = jest.fn().mockResolvedValue(null);
    const { updateMock } = await triggerEventSelect(
      command,
      eventsService,
      44,
      'user-123',
      [event],
    );
    expect(getUpdateEmbedData(updateMock).embeds[0].data.description).toContain(
      'No game',
    );
  });
});

describe('EventsListCommand — detail: thumbnail present', () => {
  let module: TestingModule;
  let command: EventsListCommand;
  let eventsService: jest.Mocked<EventsService>;
  let usersService: jest.Mocked<UsersService>;

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    module = await buildModule();
    command = module.get(EventsListCommand);
    eventsService = module.get(EventsService);
    usersService = module.get(UsersService);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();
    restoreClientUrl();
  });

  it('should set thumbnail when coverUrl is present', async () => {
    const event = makeEvent({
      id: 45,
      game: { name: 'WoW', coverUrl: 'https://cdn.example.com/wow.jpg' },
    });
    eventsService.findOne = jest.fn().mockResolvedValue(event);
    usersService.findByDiscordId = jest.fn().mockResolvedValue(null);
    const { updateMock } = await triggerEventSelect(
      command,
      eventsService,
      45,
      'user-123',
      [event],
    );
    expect(getUpdateEmbedData(updateMock).embeds[0].data.thumbnail?.url).toBe(
      'https://cdn.example.com/wow.jpg',
    );
  });

  it('should NOT set thumbnail when coverUrl is null', async () => {
    const event = makeEvent({ id: 46, game: { name: 'WoW', coverUrl: null } });
    eventsService.findOne = jest.fn().mockResolvedValue(event);
    usersService.findByDiscordId = jest.fn().mockResolvedValue(null);
    const { updateMock } = await triggerEventSelect(
      command,
      eventsService,
      46,
      'user-123',
      [event],
    );
    expect(
      getUpdateEmbedData(updateMock).embeds[0].data.thumbnail,
    ).toBeUndefined();
  });
});

describe('EventsListCommand — detail: truncation', () => {
  let module: TestingModule;
  let command: EventsListCommand;
  let eventsService: jest.Mocked<EventsService>;
  let usersService: jest.Mocked<UsersService>;

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    module = await buildModule();
    command = module.get(EventsListCommand);
    eventsService = module.get(EventsService);
    usersService = module.get(UsersService);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();
    restoreClientUrl();
  });

  it('should truncate description longer than 1024 chars', async () => {
    const event = makeEvent({ id: 47, description: 'A'.repeat(1100) });
    eventsService.findOne = jest.fn().mockResolvedValue(event);
    usersService.findByDiscordId = jest.fn().mockResolvedValue(null);
    const { updateMock } = await triggerEventSelect(
      command,
      eventsService,
      47,
      'user-123',
      [event],
    );
    const desc =
      getUpdateEmbedData(updateMock).embeds[0].data.description ?? '';
    expect(desc).toContain('...');
    expect(desc).not.toContain('A'.repeat(1100));
  });

  it('should not truncate at exactly 1024 chars', async () => {
    const event = makeEvent({ id: 48, description: 'B'.repeat(1024) });
    eventsService.findOne = jest.fn().mockResolvedValue(event);
    usersService.findByDiscordId = jest.fn().mockResolvedValue(null);
    const { updateMock } = await triggerEventSelect(
      command,
      eventsService,
      48,
      'user-123',
      [event],
    );
    const desc =
      getUpdateEmbedData(updateMock).embeds[0].data.description ?? '';
    expect(desc).toContain('B'.repeat(1024));
    expect(desc).not.toContain('B'.repeat(1024) + '...');
  });
});

describe('EventsListCommand — detail: signups with max', () => {
  let module: TestingModule;
  let command: EventsListCommand;
  let eventsService: jest.Mocked<EventsService>;
  let usersService: jest.Mocked<UsersService>;

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    module = await buildModule();
    command = module.get(EventsListCommand);
    eventsService = module.get(EventsService);
    usersService = module.get(UsersService);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();
    restoreClientUrl();
  });

  it('should show "7/25" when maxAttendees is set', async () => {
    const event = makeEvent({ id: 49, signupCount: 7, maxAttendees: 25 });
    eventsService.findOne = jest.fn().mockResolvedValue(event);
    usersService.findByDiscordId = jest.fn().mockResolvedValue(null);
    const { updateMock } = await triggerEventSelect(
      command,
      eventsService,
      49,
      'user-123',
      [event],
    );
    expect(getUpdateEmbedData(updateMock).embeds[0].data.description).toContain(
      '7/25',
    );
  });

  it('should show "4 signed up" when maxAttendees is null', async () => {
    const event = makeEvent({ id: 50, signupCount: 4, maxAttendees: null });
    eventsService.findOne = jest.fn().mockResolvedValue(event);
    usersService.findByDiscordId = jest.fn().mockResolvedValue(null);
    const { updateMock } = await triggerEventSelect(
      command,
      eventsService,
      50,
      'user-123',
      [event],
    );
    expect(getUpdateEmbedData(updateMock).embeds[0].data.description).toContain(
      '4 signed up',
    );
  });
});

describe('EventsListCommand — detail: duration format', () => {
  let module: TestingModule;
  let command: EventsListCommand;
  let eventsService: jest.Mocked<EventsService>;
  let usersService: jest.Mocked<UsersService>;

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    module = await buildModule();
    command = module.get(EventsListCommand);
    eventsService = module.get(EventsService);
    usersService = module.get(UsersService);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();
    restoreClientUrl();
  });

  it('should format 1-hour duration as singular', async () => {
    const event = makeEvent({
      id: 51,
      startTime: '2030-12-25T20:00:00.000Z',
      endTime: '2030-12-25T21:00:00.000Z',
    });
    eventsService.findOne = jest.fn().mockResolvedValue(event);
    usersService.findByDiscordId = jest.fn().mockResolvedValue(null);
    const { updateMock } = await triggerEventSelect(
      command,
      eventsService,
      51,
      'user-123',
      [event],
    );
    const desc =
      getUpdateEmbedData(updateMock).embeds[0].data.description ?? '';
    expect(desc).toContain('1 hour');
    expect(desc).not.toContain('1 hours');
  });

  it('should format 2-hour duration as plural', async () => {
    const event = makeEvent({
      id: 52,
      startTime: '2030-12-25T20:00:00.000Z',
      endTime: '2030-12-25T22:00:00.000Z',
    });
    eventsService.findOne = jest.fn().mockResolvedValue(event);
    usersService.findByDiscordId = jest.fn().mockResolvedValue(null);
    const { updateMock } = await triggerEventSelect(
      command,
      eventsService,
      52,
      'user-123',
      [event],
    );
    expect(getUpdateEmbedData(updateMock).embeds[0].data.description).toContain(
      '2 hours',
    );
  });

  it('should format fractional duration', async () => {
    const event = makeEvent({
      id: 53,
      startTime: '2030-12-25T20:00:00.000Z',
      endTime: '2030-12-25T21:30:00.000Z',
    });
    eventsService.findOne = jest.fn().mockResolvedValue(event);
    usersService.findByDiscordId = jest.fn().mockResolvedValue(null);
    const { updateMock } = await triggerEventSelect(
      command,
      eventsService,
      53,
      'user-123',
      [event],
    );
    expect(getUpdateEmbedData(updateMock).embeds[0].data.description).toContain(
      '1.5 hours',
    );
  });
});

describe('EventsListCommand — detail: creator & back button', () => {
  let module: TestingModule;
  let command: EventsListCommand;
  let eventsService: jest.Mocked<EventsService>;
  let usersService: jest.Mocked<UsersService>;

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    module = await buildModule();
    command = module.get(EventsListCommand);
    eventsService = module.get(EventsService);
    usersService = module.get(UsersService);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();
    restoreClientUrl();
  });

  it('should include creator username', async () => {
    const event = makeEvent({ id: 54, creator: { username: 'RaidLeader' } });
    eventsService.findOne = jest.fn().mockResolvedValue(event);
    usersService.findByDiscordId = jest.fn().mockResolvedValue(null);
    const { updateMock } = await triggerEventSelect(
      command,
      eventsService,
      54,
      'user-123',
      [event],
    );
    expect(getUpdateEmbedData(updateMock).embeds[0].data.description).toContain(
      'RaidLeader',
    );
  });

  it('should show "Unknown" when creator is null', async () => {
    const event = makeEvent({ id: 55, creator: null });
    eventsService.findOne = jest.fn().mockResolvedValue(event);
    usersService.findByDiscordId = jest.fn().mockResolvedValue(null);
    const { updateMock } = await triggerEventSelect(
      command,
      eventsService,
      55,
      'user-123',
      [event],
    );
    expect(getUpdateEmbedData(updateMock).embeds[0].data.description).toContain(
      'Unknown',
    );
  });

  it('should include Back to list button', async () => {
    const event = makeEvent({ id: 56 });
    eventsService.findOne = jest.fn().mockResolvedValue(event);
    usersService.findByDiscordId = jest.fn().mockResolvedValue(null);
    const { updateMock } = await triggerEventSelect(
      command,
      eventsService,
      56,
      'user-123',
      [event],
    );
    const data = getUpdateEmbedData(updateMock);
    const allButtons = data.components.flatMap((row) => row.components);
    const backButton = allButtons.find(
      (b) => b.data.custom_id === 'events_back',
    );
    expect(backButton).toBeDefined();
    expect(backButton?.data.label).toBe('Back to list');
  });
});

describe('EventsListCommand — detail: embed color', () => {
  let module: TestingModule;
  let command: EventsListCommand;
  let eventsService: jest.Mocked<EventsService>;
  let usersService: jest.Mocked<UsersService>;

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    module = await buildModule();
    command = module.get(EventsListCommand);
    eventsService = module.get(EventsService);
    usersService = module.get(UsersService);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();
    restoreClientUrl();
  });

  it('should use announcement embed color', async () => {
    const event = makeEvent({ id: 57 });
    eventsService.findOne = jest.fn().mockResolvedValue(event);
    usersService.findByDiscordId = jest.fn().mockResolvedValue(null);
    const { updateMock } = await triggerEventSelect(
      command,
      eventsService,
      57,
      'user-123',
      [event],
    );
    expect(getUpdateEmbedData(updateMock).embeds[0].data.color).toBe(
      EMBED_COLORS.ANNOUNCEMENT,
    );
  });
});

describe('EventsListCommand — detail: magic link URL', () => {
  let module: TestingModule;
  let command: EventsListCommand;
  let eventsService: jest.Mocked<EventsService>;
  let usersService: jest.Mocked<UsersService>;
  let magicLinkService: jest.Mocked<MagicLinkService>;

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    module = await buildModule();
    command = module.get(EventsListCommand);
    eventsService = module.get(EventsService);
    usersService = module.get(UsersService);
    magicLinkService = module.get(MagicLinkService);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();
    restoreClientUrl();
  });

  it('should use magic link URL when user is linked', async () => {
    process.env.CLIENT_URL = 'https://raidledger.com';
    const event = makeEvent({ id: 60 });
    eventsService.findOne = jest.fn().mockResolvedValue(event);
    usersService.findByDiscordId = jest
      .fn()
      .mockResolvedValue({ id: 77, username: 'Player1' });
    magicLinkService.generateLink = jest
      .fn()
      .mockResolvedValue('https://raidledger.com/events/60?token=abc123');
    const { updateMock } = await triggerEventSelect(
      command,
      eventsService,
      60,
      'discord-user-60',
      [event],
    );
    expect(magicLinkService.generateLink).toHaveBeenCalledWith(
      77,
      '/events/60',
      'https://raidledger.com',
    );
    const data = getUpdateEmbedData(updateMock);
    const allButtons = data.components.flatMap((row) => row.components);
    const viewButton = allButtons.find((b) => b.data.url !== undefined);
    expect(viewButton?.data.url).toBe(
      'https://raidledger.com/events/60?token=abc123',
    );
  });
});

describe('EventsListCommand — detail: plain URL fallback', () => {
  let module: TestingModule;
  let command: EventsListCommand;
  let eventsService: jest.Mocked<EventsService>;
  let usersService: jest.Mocked<UsersService>;
  let magicLinkService: jest.Mocked<MagicLinkService>;

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    module = await buildModule();
    command = module.get(EventsListCommand);
    eventsService = module.get(EventsService);
    usersService = module.get(UsersService);
    magicLinkService = module.get(MagicLinkService);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();
    restoreClientUrl();
  });

  it('should fall back to plain URL when no linked account', async () => {
    process.env.CLIENT_URL = 'https://raidledger.com';
    const event = makeEvent({ id: 61 });
    eventsService.findOne = jest.fn().mockResolvedValue(event);
    usersService.findByDiscordId = jest.fn().mockResolvedValue(null);
    const { updateMock } = await triggerEventSelect(
      command,
      eventsService,
      61,
      'discord-user-61',
      [event],
    );
    expect(magicLinkService.generateLink).not.toHaveBeenCalled();
    const data = getUpdateEmbedData(updateMock);
    const allButtons = data.components.flatMap((row) => row.components);
    const viewButton = allButtons.find((b) => b.data.url !== undefined);
    expect(viewButton?.data.url).toBe('https://raidledger.com/events/61');
  });

  it('should fall back to plain URL when magic link returns null', async () => {
    process.env.CLIENT_URL = 'https://raidledger.com';
    const event = makeEvent({ id: 62 });
    eventsService.findOne = jest.fn().mockResolvedValue(event);
    usersService.findByDiscordId = jest
      .fn()
      .mockResolvedValue({ id: 88, username: 'Player2' });
    magicLinkService.generateLink = jest.fn().mockResolvedValue(null);
    const { updateMock } = await triggerEventSelect(
      command,
      eventsService,
      62,
      'discord-user-62',
      [event],
    );
    const data = getUpdateEmbedData(updateMock);
    const allButtons = data.components.flatMap((row) => row.components);
    const viewButton = allButtons.find((b) => b.data.url !== undefined);
    expect(viewButton?.data.url).toBe('https://raidledger.com/events/62');
  });
});

describe('EventsListCommand — detail: no CLIENT_URL', () => {
  let module: TestingModule;
  let command: EventsListCommand;
  let eventsService: jest.Mocked<EventsService>;
  let usersService: jest.Mocked<UsersService>;

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    module = await buildModule();
    command = module.get(EventsListCommand);
    eventsService = module.get(EventsService);
    usersService = module.get(UsersService);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();
    restoreClientUrl();
  });

  it('should not include View button when no CLIENT_URL', async () => {
    delete process.env.CLIENT_URL;
    const event = makeEvent({ id: 63 });
    eventsService.findOne = jest.fn().mockResolvedValue(event);
    usersService.findByDiscordId = jest.fn().mockResolvedValue(null);
    const { updateMock } = await triggerEventSelect(
      command,
      eventsService,
      63,
      'discord-user-63',
      [event],
    );
    const data = getUpdateEmbedData(updateMock);
    const allButtons = data.components.flatMap((row) => row.components);
    const viewButton = allButtons.find((b) =>
      b.data.label?.includes('View in Raid Ledger'),
    );
    expect(viewButton).toBeUndefined();
  });
});
