import { Test, TestingModule } from '@nestjs/testing';
import { EventsListCommand } from './events-list.command';
import { EventsService } from '../../events/events.service';
import { UsersService } from '../../users/users.service';
import { MagicLinkService } from '../../auth/magic-link.service';
import { EMBED_COLORS } from '../discord-bot.constants';

const originalClientUrl = process.env.CLIENT_URL;

type FindAllReturn = Awaited<ReturnType<EventsService['findAll']>>;
type HandleParam = Parameters<EventsListCommand['handleInteraction']>[0];

const mockCollector = { on: jest.fn().mockReturnThis() };
const mockReplyMessage = {
  createMessageComponentCollector: jest.fn().mockReturnValue(mockCollector),
};

const mockInteraction = () => ({
  deferReply: jest.fn().mockResolvedValue(undefined),
  editReply: jest.fn().mockResolvedValue(mockReplyMessage),
  user: { id: '123456' },
});

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

function makeFindAllResult(
  data: ReturnType<typeof makeEvent>[],
  total?: number,
) {
  return {
    data,
    meta: {
      total: total ?? data.length,
      page: 1,
      limit: 10,
      totalPages: Math.ceil((total ?? data.length) / 10),
    },
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

function getEmbedData(interaction: ReturnType<typeof mockInteraction>) {
  return (interaction.editReply.mock.calls as unknown[][])[0][0] as {
    embeds: {
      data: { color?: number; description?: string; footer?: { text: string } };
    }[];
    components: unknown[];
  };
}

function restoreClientUrl() {
  if (originalClientUrl !== undefined) {
    process.env.CLIENT_URL = originalClientUrl;
  } else {
    delete process.env.CLIENT_URL;
  }
}

describe('EventsListCommand — definition', () => {
  let command: EventsListCommand;
  let module: TestingModule;

  beforeEach(async () => {
    delete process.env.CLIENT_URL;
    module = await buildModule();
    command = module.get(EventsListCommand);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();
    restoreClientUrl();
  });

  it('should return a command definition named "events"', () => {
    expect(command.getDefinition().name).toBe('events');
  });

  it('should have a description', () => {
    expect(command.getDefinition().description).toBeTruthy();
  });
});

describe('EventsListCommand — defer & empty', () => {
  let command: EventsListCommand;
  let module: TestingModule;
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

  it('should defer reply as ephemeral', async () => {
    const interaction = mockInteraction();
    eventsService.findAll.mockResolvedValue(makeFindAllResult([makeEvent()]));
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
  });

  it('should reply with no events when empty', async () => {
    const interaction = mockInteraction();
    eventsService.findAll.mockResolvedValue(makeFindAllResult([]));
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(interaction.editReply).toHaveBeenCalledWith(
      'No upcoming events found.',
    );
  });
});

describe('EventsListCommand — findAll & embed', () => {
  let command: EventsListCommand;
  let module: TestingModule;
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

  it('should call findAll with upcoming filter', async () => {
    const interaction = mockInteraction();
    eventsService.findAll.mockResolvedValue(makeFindAllResult([makeEvent()]));
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(eventsService.findAll).toHaveBeenCalledWith({
      upcoming: 'true',
      limit: 10,
      page: 1,
    });
  });

  it('should build an embed with event details', async () => {
    const interaction = mockInteraction();
    eventsService.findAll.mockResolvedValue(makeFindAllResult([makeEvent()]));
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.arrayContaining([expect.anything()]) as unknown,
      }),
    );
  });

  it('should handle service errors gracefully', async () => {
    const interaction = mockInteraction();
    eventsService.findAll.mockRejectedValue(new Error('Database error'));
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(interaction.editReply).toHaveBeenCalledWith(
      'Failed to fetch upcoming events. Please try again later.',
    );
  });
});

describe('EventsListCommand — embed content: color & game', () => {
  let command: EventsListCommand;
  let module: TestingModule;
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

  it('should use announcement color', async () => {
    const interaction = mockInteraction();
    eventsService.findAll.mockResolvedValue(makeFindAllResult([makeEvent()]));
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(getEmbedData(interaction).embeds[0].data.color).toBe(
      EMBED_COLORS.ANNOUNCEMENT,
    );
  });

  it('should display "No game" when event has no game', async () => {
    const interaction = mockInteraction();
    eventsService.findAll.mockResolvedValue(
      makeFindAllResult([makeEvent({ game: null })]),
    );
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(getEmbedData(interaction).embeds[0].data.description).toContain(
      'No game',
    );
  });
});

describe('EventsListCommand — embed content: roster & footer', () => {
  let command: EventsListCommand;
  let module: TestingModule;
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

  it('should show roster as "N/max" when maxAttendees set', async () => {
    const interaction = mockInteraction();
    eventsService.findAll.mockResolvedValue(
      makeFindAllResult([makeEvent({ signupCount: 5, maxAttendees: 20 })]),
    );
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(getEmbedData(interaction).embeds[0].data.description).toContain(
      '5/20',
    );
  });

  it('should show "N signed up" when maxAttendees is null', async () => {
    const interaction = mockInteraction();
    eventsService.findAll.mockResolvedValue(
      makeFindAllResult([makeEvent({ signupCount: 3, maxAttendees: null })]),
    );
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(getEmbedData(interaction).embeds[0].data.description).toContain(
      '3 signed up',
    );
  });

  it('should include total count in the footer', async () => {
    const interaction = mockInteraction();
    eventsService.findAll.mockResolvedValue(
      makeFindAllResult(
        [makeEvent(), makeEvent({ id: 2, title: 'Event 2' })],
        10,
      ),
    );
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(getEmbedData(interaction).embeds[0].data.footer?.text).toContain(
      '10',
    );
  });
});

describe('EventsListCommand — components: with & without URL', () => {
  let command: EventsListCommand;
  let module: TestingModule;
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

  it('should include select menu and button when CLIENT_URL set', async () => {
    process.env.CLIENT_URL = 'https://raidledger.com';
    const interaction = mockInteraction();
    eventsService.findAll.mockResolvedValue(makeFindAllResult([makeEvent()]));
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(getEmbedData(interaction).components.length).toBe(2);
  });

  it('should include only select menu when no CLIENT_URL', async () => {
    delete process.env.CLIENT_URL;
    const interaction = mockInteraction();
    eventsService.findAll.mockResolvedValue(makeFindAllResult([makeEvent()]));
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(getEmbedData(interaction).components).toHaveLength(1);
  });

  it('should attach a component collector', async () => {
    const interaction = mockInteraction();
    eventsService.findAll.mockResolvedValue(makeFindAllResult([makeEvent()]));
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(
      mockReplyMessage.createMessageComponentCollector,
    ).toHaveBeenCalledWith(expect.objectContaining({ time: 5 * 60 * 1000 }));
  });
});

describe('EventsListCommand — collector: timeout end handler', () => {
  let command: EventsListCommand;
  let module: TestingModule;
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

  it('should remove components on timeout', async () => {
    let endHandler: (() => void) | undefined;
    const collectorWithEnd = {
      on: jest.fn().mockImplementation((event: string, handler: () => void) => {
        if (event === 'end') endHandler = handler;
        return collectorWithEnd;
      }),
    };
    const replyWithCollector = {
      createMessageComponentCollector: jest
        .fn()
        .mockReturnValue(collectorWithEnd),
    };
    const interaction = {
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(replyWithCollector),
      user: { id: '999' },
    };
    eventsService.findAll.mockResolvedValue(makeFindAllResult([makeEvent()]));
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(endHandler).toBeDefined();
    endHandler!();
    expect(interaction.editReply).toHaveBeenLastCalledWith({ components: [] });
  });
});

describe('EventsListCommand — collector: event handlers', () => {
  let command: EventsListCommand;
  let module: TestingModule;
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

  it('should register both collect and end handlers', async () => {
    const registeredEvents: string[] = [];
    const collectorCapture = {
      on: jest.fn().mockImplementation((event: string) => {
        registeredEvents.push(event);
        return collectorCapture;
      }),
    };
    const replyCapture = {
      createMessageComponentCollector: jest
        .fn()
        .mockReturnValue(collectorCapture),
    };
    const interaction = {
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(replyCapture),
      user: { id: '999' },
    };
    eventsService.findAll.mockResolvedValue(makeFindAllResult([makeEvent()]));
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(registeredEvents).toContain('collect');
    expect(registeredEvents).toContain('end');
  });
});

describe('EventsListCommand — collector: user filter', () => {
  let command: EventsListCommand;
  let module: TestingModule;
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

  it('should filter to only the original user', async () => {
    let capturedFilter: ((i: { user: { id: string } }) => boolean) | undefined;
    const collectorFilter = { on: jest.fn().mockReturnThis() };
    const replyFilter = {
      createMessageComponentCollector: jest
        .fn()
        .mockImplementation(
          (opts: { filter?: (i: { user: { id: string } }) => boolean }) => {
            capturedFilter = opts.filter;
            return collectorFilter;
          },
        ),
    };
    const interaction = {
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(replyFilter),
      user: { id: 'original-user-id' },
    };
    eventsService.findAll.mockResolvedValue(makeFindAllResult([makeEvent()]));
    await command.handleInteraction(interaction as unknown as HandleParam);
    expect(capturedFilter).toBeDefined();
    expect(capturedFilter!({ user: { id: 'original-user-id' } })).toBe(true);
    expect(capturedFilter!({ user: { id: 'intruder-user-id' } })).toBe(false);
  });
});
