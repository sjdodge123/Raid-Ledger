import { Test, TestingModule } from '@nestjs/testing';
import { ComponentType } from 'discord.js';
import { EventsListCommand } from './events-list.command';
import { EventsService } from '../../events/events.service';
import { UsersService } from '../../users/users.service';
import { MagicLinkService } from '../../auth/magic-link.service';

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

function makeFindAllResult(data: ReturnType<typeof makeEvent>[]) {
  return {
    data,
    meta: { total: data.length, page: 1, limit: 10, totalPages: 1 },
  } as unknown as FindAllReturn;
}

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
        (ev: string, handler: (i: Record<string, unknown>) => void) => {
          if (ev === 'collect') collectHandler = handler;
          return spy;
        },
      ),
  };
  return { spy, getCollectHandler: () => collectHandler };
}

function makeSelectInteraction(eventId: number, updateMock: jest.Mock) {
  return {
    componentType: ComponentType.StringSelect,
    customId: 'event_select',
    values: [String(eventId)],
    user: { id: 'user-del-test' },
    update: updateMock,
  };
}

/** Triggers event selection via collector. */
async function triggerEventSelectAndGetUpdate(
  command: EventsListCommand,
  eventsService: jest.Mocked<EventsService>,
  selectedEventId: number,
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
    user: { id: 'user-del-test' },
  };
  eventsService.findAll.mockResolvedValue(makeFindAllResult(cachedEvents));
  await command.handleInteraction(interaction as unknown as HandleParam);
  const selectI = makeSelectInteraction(selectedEventId, updateMock);
  getCollectHandler()!(selectI as unknown as Record<string, unknown>);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { updateMock };
}

/** Triggers handleInteraction and returns the collectHandler + updateMock. */
async function triggerBackButton(
  command: EventsListCommand,
  eventsService: jest.Mocked<EventsService>,
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
  eventsService.findAll.mockResolvedValueOnce(makeFindAllResult(cachedEvents));
  await command.handleInteraction(interaction as unknown as HandleParam);
  return { collectHandler: getCollectHandler()!, updateMock };
}

function makeBackInteraction(userId: string, updateMock: jest.Mock) {
  return {
    componentType: ComponentType.Button,
    customId: 'events_back',
    user: { id: userId },
    update: updateMock,
  };
}

describe('EventsListCommand — event deleted: not in cache', () => {
  let module: TestingModule;
  let command: EventsListCommand;
  let eventsService: jest.Mocked<EventsService>;

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    module = await buildModule();
    command = module.get(EventsListCommand);
    eventsService = module.get(EventsService);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();
    restoreClientUrl();
  });

  it('should show friendly message when event gone from cache & DB', async () => {
    eventsService.findOne = jest.fn().mockRejectedValue(new Error('Not found'));
    const cachedEvent = makeEvent({ id: 70, title: 'Cached Event' });
    const { updateMock } = await triggerEventSelectAndGetUpdate(
      command,
      eventsService,
      99,
      [cachedEvent],
    );
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('no longer available') as unknown,
        embeds: expect.arrayContaining([expect.anything()]) as unknown,
        components: expect.arrayContaining([expect.anything()]) as unknown,
      }),
    );
  });
});

describe('EventsListCommand — event deleted: cached fallback', () => {
  let module: TestingModule;
  let command: EventsListCommand;
  let eventsService: jest.Mocked<EventsService>;

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    module = await buildModule();
    command = module.get(EventsListCommand);
    eventsService = module.get(EventsService);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();
    restoreClientUrl();
  });

  it('should use cached data as fallback when findOne fails', async () => {
    eventsService.findOne = jest.fn().mockRejectedValue(new Error('DB error'));
    const cachedEvent = makeEvent({ id: 71, title: 'Still Here' });
    const { updateMock } = await triggerEventSelectAndGetUpdate(
      command,
      eventsService,
      71,
      [cachedEvent],
    );
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.arrayContaining([expect.anything()]) as unknown,
      }),
    );
  });
});

describe('EventsListCommand — event deleted: unexpected error', () => {
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

  it('should restore list on unexpected error during detail fetch', async () => {
    eventsService.findOne = jest.fn().mockResolvedValue(makeEvent({ id: 72 }));
    usersService.findByDiscordId = jest
      .fn()
      .mockRejectedValue(new Error('DB timeout'));
    process.env.CLIENT_URL = 'https://raidledger.com';
    const cachedEvent = makeEvent({ id: 72 });
    const { updateMock } = await triggerEventSelectAndGetUpdate(
      command,
      eventsService,
      72,
      [cachedEvent],
    );
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Something went wrong') as unknown,
        embeds: expect.arrayContaining([expect.anything()]) as unknown,
        components: expect.arrayContaining([expect.anything()]) as unknown,
      }),
    );
  });
});

describe('EventsListCommand — back: re-fetch success', () => {
  let module: TestingModule;
  let command: EventsListCommand;
  let eventsService: jest.Mocked<EventsService>;

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    module = await buildModule();
    command = module.get(EventsListCommand);
    eventsService = module.get(EventsService);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();
    restoreClientUrl();
  });

  it('should re-fetch events and show list', async () => {
    const cachedEvents = [makeEvent({ id: 80, title: 'Old Event' })];
    const freshEvents = [
      makeEvent({ id: 80, title: 'Old Event' }),
      makeEvent({ id: 81, title: 'New Event' }),
    ];
    const { collectHandler, updateMock } = await triggerBackButton(
      command,
      eventsService,
      'user-back-1',
      cachedEvents,
    );
    eventsService.findAll.mockResolvedValueOnce(makeFindAllResult(freshEvents));
    collectHandler(
      makeBackInteraction('user-back-1', updateMock) as unknown as Record<
        string,
        unknown
      >,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(eventsService.findAll).toHaveBeenCalledTimes(2);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.arrayContaining([expect.anything()]) as unknown,
        components: expect.arrayContaining([expect.anything()]) as unknown,
      }),
    );
  });
});

describe('EventsListCommand — back: empty & fallback', () => {
  let module: TestingModule;
  let command: EventsListCommand;
  let eventsService: jest.Mocked<EventsService>;

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    module = await buildModule();
    command = module.get(EventsListCommand);
    eventsService = module.get(EventsService);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();
    restoreClientUrl();
  });

  it('should show "No upcoming events" if re-fetch empty', async () => {
    const cachedEvents = [makeEvent({ id: 82 })];
    const { collectHandler, updateMock } = await triggerBackButton(
      command,
      eventsService,
      'user-back-2',
      cachedEvents,
    );
    eventsService.findAll.mockResolvedValueOnce(makeFindAllResult([]));
    collectHandler(
      makeBackInteraction('user-back-2', updateMock) as unknown as Record<
        string,
        unknown
      >,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'No upcoming events found.',
        embeds: [],
        components: [],
      }),
    );
  });

  it('should fall back to cached events on re-fetch failure', async () => {
    const cachedEvents = [makeEvent({ id: 83, title: 'Cached Fallback' })];
    const { collectHandler, updateMock } = await triggerBackButton(
      command,
      eventsService,
      'user-back-3',
      cachedEvents,
    );
    eventsService.findAll.mockRejectedValueOnce(new Error('Network error'));
    collectHandler(
      makeBackInteraction('user-back-3', updateMock) as unknown as Record<
        string,
        unknown
      >,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.arrayContaining([expect.anything()]) as unknown,
        components: expect.arrayContaining([expect.anything()]) as unknown,
      }),
    );
  });
});

describe('EventsListCommand — back: content reset', () => {
  let module: TestingModule;
  let command: EventsListCommand;
  let eventsService: jest.Mocked<EventsService>;

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    module = await buildModule();
    command = module.get(EventsListCommand);
    eventsService = module.get(EventsService);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();
    restoreClientUrl();
  });

  it('should restore content to empty string when going back', async () => {
    const cachedEvents = [makeEvent({ id: 84 })];
    const { collectHandler, updateMock } = await triggerBackButton(
      command,
      eventsService,
      'user-back-4',
      cachedEvents,
    );
    eventsService.findAll.mockResolvedValueOnce(
      makeFindAllResult(cachedEvents),
    );
    collectHandler(
      makeBackInteraction('user-back-4', updateMock) as unknown as Record<
        string,
        unknown
      >,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ content: '' }),
    );
  });
});

describe('EventsListCommand — dropdown: max & single', () => {
  let module: TestingModule;
  let command: EventsListCommand;
  let eventsService: jest.Mocked<EventsService>;

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    module = await buildModule();
    command = module.get(EventsListCommand);
    eventsService = module.get(EventsService);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();
    restoreClientUrl();
  });

  function makeDropdownInteraction() {
    return {
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue({
        createMessageComponentCollector: jest
          .fn()
          .mockReturnValue({ on: jest.fn().mockReturnThis() }),
      }),
      user: { id: '999' },
    };
  }

  function getSelectMenu(interaction: { editReply: jest.Mock }) {
    const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
      components: {
        components: {
          options: {
            data: { value: string; label: string; description: string };
          }[];
        }[];
      }[];
    };
    return call.components[0].components[0];
  }

  it('should include all 10 events at max', async () => {
    const events = Array.from({ length: 10 }, (_, i) =>
      makeEvent({ id: i + 1, title: `Event ${i + 1}` }),
    );
    const interaction = makeDropdownInteraction();
    eventsService.findAll.mockResolvedValue(makeFindAllResult(events));
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(getSelectMenu(interaction).options).toHaveLength(10);
  });

  it('should include single event as option', async () => {
    const interaction = makeDropdownInteraction();
    eventsService.findAll.mockResolvedValue(
      makeFindAllResult([makeEvent({ id: 5, title: 'Solo Event' })]),
    );
    await command.handleInteraction(interaction as unknown as HandleParam);
    const menu = getSelectMenu(interaction);
    expect(menu.options).toHaveLength(1);
    expect(menu.options[0].data.value).toBe('5');
    expect(menu.options[0].data.label).toBe('Solo Event');
  });
});

describe('EventsListCommand — dropdown: value & desc', () => {
  let module: TestingModule;
  let command: EventsListCommand;
  let eventsService: jest.Mocked<EventsService>;

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    module = await buildModule();
    command = module.get(EventsListCommand);
    eventsService = module.get(EventsService);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();
    restoreClientUrl();
  });

  function makeDropdownInteraction() {
    return {
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue({
        createMessageComponentCollector: jest
          .fn()
          .mockReturnValue({ on: jest.fn().mockReturnThis() }),
      }),
      user: { id: '999' },
    };
  }

  function getSelectMenu(interaction: { editReply: jest.Mock }) {
    const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
      components: {
        components: {
          options: {
            data: { value: string; label: string; description: string };
          }[];
        }[];
      }[];
    };
    return call.components[0].components[0];
  }

  it('should use event id as dropdown value', async () => {
    const interaction = makeDropdownInteraction();
    eventsService.findAll.mockResolvedValue(
      makeFindAllResult([makeEvent({ id: 999 })]),
    );
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(getSelectMenu(interaction).options[0].data.value).toBe('999');
  });

  it('should include game name in description', async () => {
    const interaction = makeDropdownInteraction();
    eventsService.findAll.mockResolvedValue(
      makeFindAllResult([
        makeEvent({ id: 1, game: { name: 'EverQuest', coverUrl: null } }),
      ]),
    );
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(getSelectMenu(interaction).options[0].data.description).toContain(
      'EverQuest',
    );
  });

  it('should show "No game" in description when null', async () => {
    const interaction = makeDropdownInteraction();
    eventsService.findAll.mockResolvedValue(
      makeFindAllResult([makeEvent({ id: 1, game: null })]),
    );
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(getSelectMenu(interaction).options[0].data.description).toContain(
      'No game',
    );
  });
});

describe('EventsListCommand — dropdown: truncation', () => {
  let module: TestingModule;
  let command: EventsListCommand;
  let eventsService: jest.Mocked<EventsService>;

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    module = await buildModule();
    command = module.get(EventsListCommand);
    eventsService = module.get(EventsService);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();
    restoreClientUrl();
  });

  it('should truncate title to 100 chars', async () => {
    const longTitle = 'X'.repeat(150);
    const interaction = {
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue({
        createMessageComponentCollector: jest
          .fn()
          .mockReturnValue({ on: jest.fn().mockReturnThis() }),
      }),
      user: { id: '999' },
    };
    eventsService.findAll.mockResolvedValue(
      makeFindAllResult([makeEvent({ id: 1, title: longTitle })]),
    );
    await command.handleInteraction(interaction as unknown as HandleParam);
    const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
      components: {
        components: {
          options: { data: { label: string } }[];
        }[];
      }[];
    };
    const label = call.components[0].components[0].options[0].data.label;
    expect(label).toHaveLength(100);
    expect(label).toBe('X'.repeat(100));
  });
});

describe('EventsListCommand — View All button', () => {
  let module: TestingModule;
  let command: EventsListCommand;
  let eventsService: jest.Mocked<EventsService>;

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    module = await buildModule();
    command = module.get(EventsListCommand);
    eventsService = module.get(EventsService);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();
    restoreClientUrl();
  });

  it('should point to /events path', async () => {
    process.env.CLIENT_URL = 'https://myraid.com';
    const interaction = {
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue({
        createMessageComponentCollector: jest
          .fn()
          .mockReturnValue({ on: jest.fn().mockReturnThis() }),
      }),
      user: { id: '999' },
    };
    eventsService.findAll.mockResolvedValue(makeFindAllResult([makeEvent()]));
    await command.handleInteraction(interaction as unknown as HandleParam);
    const call = (interaction.editReply.mock.calls as unknown[][])[0][0] as {
      components: {
        components: { data: { url?: string; label?: string } }[];
      }[];
    };
    const buttonRow = call.components[1];
    const viewAllButton = buttonRow.components[0];
    expect(viewAllButton.data.url).toBe('https://myraid.com/events');
    expect(viewAllButton.data.label).toBe('View All in Raid Ledger');
  });
});
