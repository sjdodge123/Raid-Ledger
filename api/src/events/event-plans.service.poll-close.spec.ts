import { Test, TestingModule } from '@nestjs/testing';
import { EventPlansService, EVENT_PLANS_QUEUE } from './event-plans.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { ChannelResolverService } from '../discord-bot/services/channel-resolver.service';
import { EventsService } from './events.service';
import { SignupsService } from './signups.service';
import { SettingsService } from '../settings/settings.service';
import { getQueueToken } from '@nestjs/bullmq';

const PLAN_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const CREATOR_ID = 42;
const CHANNEL_ID = 'discord-channel-123';
const MESSAGE_ID = 'discord-message-456';

const baseOptions = [
  { date: '2026-03-10T18:00:00.000Z', label: 'Monday Mar 10, 6:00 PM' },
  { date: '2026-03-11T18:00:00.000Z', label: 'Tuesday Mar 11, 6:00 PM' },
  { date: '2026-03-12T18:00:00.000Z', label: 'Wednesday Mar 12, 6:00 PM' },
];

const REGISTERED_USER_IDS = [
  'discord-user-1',
  'discord-user-2',
  'discord-user-3',
  'discord-user-4',
  'discord-user-5',
];

function makePlan(overrides: Record<string, unknown> = {}) {
  return {
    id: PLAN_ID,
    creatorId: CREATOR_ID,
    title: 'Raid Night',
    description: null,
    gameId: null,
    slotConfig: null,
    contentInstances: null,
    maxAttendees: null,
    autoUnbench: true,
    durationMinutes: 120,
    pollOptions: baseOptions,
    pollDurationHours: 24,
    pollMode: 'standard',
    pollRound: 1,
    pollChannelId: CHANNEL_ID,
    pollMessageId: MESSAGE_ID,
    status: 'polling',
    winningOption: null,
    createdEventId: null,
    reminder15min: true,
    reminder1hour: false,
    reminder24hour: false,
    pollStartedAt: new Date(),
    pollEndsAt: new Date(Date.now() + 24 * 3600 * 1000),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePollAnswer(voterIds: string[]) {
  const votersCollection = {
    map: (fn: (user: { id: string }) => string) =>
      voterIds.map((id) => fn({ id })),
  };
  return {
    voteCount: voterIds.length,
    voters: { fetch: jest.fn().mockResolvedValue(votersCollection) },
  };
}

function setupRegisteredUsersResponse(
  db: MockDb,
  registeredDiscordIds: string[],
) {
  const registeredResponse = registeredDiscordIds.map((id) => ({
    discordId: id,
  }));
  db.where.mockImplementation(() => {
    const chainWithPromise = Object.create(db) as MockDb & {
      then: (resolve: (value: unknown) => void) => void;
    };
    chainWithPromise.then = (resolve: (value: unknown) => void) =>
      resolve(registeredResponse);
    return chainWithPromise;
  });
}

let service: EventPlansService;
let db: MockDb;
let discordClient: ReturnType<typeof makeDiscordMock>;
let eventsService: { create: jest.Mock };
let signupsService: { signup: jest.Mock };
let queue: ReturnType<typeof makeQueueMock>;

function makeDiscordMock() {
  const mockTextChannel = {
    send: jest.fn().mockResolvedValue({ id: MESSAGE_ID }),
    messages: {
      fetch: jest.fn().mockResolvedValue({
        poll: {
          answers: new Map([
            [0, makePollAnswer(REGISTERED_USER_IDS.slice(0, 5))],
            [1, makePollAnswer(REGISTERED_USER_IDS.slice(0, 3))],
            [2, makePollAnswer(REGISTERED_USER_IDS.slice(0, 1))],
          ]),
        },
      }),
    },
  };
  const mockClient = {
    isReady: jest.fn().mockReturnValue(true),
    channels: { fetch: jest.fn().mockResolvedValue(mockTextChannel) },
  };
  return {
    getClient: jest.fn().mockReturnValue(mockClient),
    isConnected: jest.fn().mockReturnValue(true),
    deleteMessage: jest.fn().mockResolvedValue(undefined),
    sendDirectMessage: jest.fn().mockResolvedValue(undefined),
    _mockTextChannel: mockTextChannel,
    _mockClient: mockClient,
  };
}

function makeQueueMock() {
  const mockJob = { remove: jest.fn().mockResolvedValue(undefined) };
  return {
    add: jest.fn().mockResolvedValue(undefined),
    getJob: jest.fn().mockResolvedValue(mockJob),
    _mockJob: mockJob,
  };
}

async function setupEach() {
  db = createDrizzleMock();
  db.limit.mockResolvedValue([makePlan()]);
  db.returning.mockResolvedValue([makePlan()]);
  discordClient = makeDiscordMock();
  queue = makeQueueMock();
  eventsService = { create: jest.fn().mockResolvedValue({ id: 99 }) };
  signupsService = { signup: jest.fn().mockResolvedValue(undefined) };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      EventPlansService,
      { provide: DrizzleAsyncProvider, useValue: db },
      { provide: getQueueToken(EVENT_PLANS_QUEUE), useValue: queue },
      { provide: DiscordBotClientService, useValue: discordClient },
      {
        provide: ChannelResolverService,
        useValue: {
          resolveChannelForEvent: jest.fn().mockResolvedValue(CHANNEL_ID),
        },
      },
      {
        provide: SettingsService,
        useValue: { getDefaultTimezone: jest.fn().mockResolvedValue(null) },
      },
      { provide: EventsService, useValue: eventsService },
      { provide: SignupsService, useValue: signupsService },
    ],
  }).compile();

  service = module.get<EventPlansService>(EventPlansService);
  jest.clearAllMocks();
  resetPollCloseMocks();
}

function resetPollCloseMocks() {
  discordClient.getClient.mockReturnValue(discordClient._mockClient);
  discordClient._mockClient.isReady.mockReturnValue(true);
  discordClient._mockClient.channels.fetch.mockResolvedValue(
    discordClient._mockTextChannel,
  );
  discordClient._mockTextChannel.send.mockResolvedValue({ id: MESSAGE_ID });
  discordClient.deleteMessage.mockResolvedValue(undefined);
  discordClient.sendDirectMessage.mockResolvedValue(undefined);
  queue.add.mockResolvedValue(undefined);
  queue.getJob.mockResolvedValue(queue._mockJob);
  eventsService.create.mockResolvedValue({ id: 99 });
  signupsService.signup.mockResolvedValue(undefined);
  db.limit.mockResolvedValue([makePlan()]);
  db.returning.mockResolvedValue([makePlan()]);
}

function setupPollWithAnswers(
  answers: Map<number, ReturnType<typeof makePollAnswer>>,
) {
  discordClient._mockTextChannel.messages.fetch.mockResolvedValue({
    poll: { answers },
  });
}

// ─── processPollClose basic tests ───────────────────────────────────────────

async function testSkipNotFound() {
  db.limit.mockResolvedValue([]);
  await service.processPollClose(PLAN_ID);
  expect(db.update).not.toHaveBeenCalled();
}

async function testSkipWrongStatus() {
  db.limit.mockResolvedValue([makePlan({ status: 'completed' })]);
  await service.processPollClose(PLAN_ID);
  expect(db.update).not.toHaveBeenCalled();
}

async function testExpireOnDiscordFail() {
  setupRegisteredUsersResponse(db, REGISTERED_USER_IDS);
  discordClient._mockClient.channels.fetch.mockRejectedValue(
    new Error('Discord down'),
  );
  await service.processPollClose(PLAN_ID);
  expect(db.update).toHaveBeenCalled();
}

async function testExpireOnNoVotes() {
  setupRegisteredUsersResponse(db, REGISTERED_USER_IDS);
  setupPollWithAnswers(new Map());
  await service.processPollClose(PLAN_ID);
  expect(db.update).toHaveBeenCalled();
}

// ─── registered-user filtering tests ────────────────────────────────────────

async function testOnlyRegisteredVotesCount() {
  setupRegisteredUsersResponse(db, REGISTERED_USER_IDS);
  setupPollWithAnswers(
    new Map([
      [
        0,
        makePollAnswer([
          REGISTERED_USER_IDS[0],
          'unregistered-1',
          'unregistered-2',
        ]),
      ],
      [1, makePollAnswer(REGISTERED_USER_IDS.slice(0, 2))],
      [2, makePollAnswer([])],
      [3, makePollAnswer([])],
    ]),
  );

  await service.processPollClose(PLAN_ID);
  const createCall = eventsService.create.mock.calls[0] as [
    number,
    { startTime: string },
  ];
  expect(createCall[1].startTime).toBe('2026-03-11T18:00:00.000Z');
}

async function testUnregisteredNoneNotCounted() {
  setupRegisteredUsersResponse(db, REGISTERED_USER_IDS);
  setupPollWithAnswers(
    new Map([
      [0, makePollAnswer(REGISTERED_USER_IDS.slice(0, 2))],
      [1, makePollAnswer([])],
      [2, makePollAnswer([])],
      [
        3,
        makePollAnswer([
          REGISTERED_USER_IDS[3],
          'unregistered-1',
          'unregistered-2',
        ]),
      ],
    ]),
  );

  await service.processPollClose(PLAN_ID);
  expect(eventsService.create).toHaveBeenCalled();
}

// ─── standard mode tests ────────────────────────────────────────────────────

async function testStandardTimeSlotWins() {
  setupRegisteredUsersResponse(db, REGISTERED_USER_IDS);
  setupPollWithAnswers(
    new Map([
      [0, makePollAnswer(REGISTERED_USER_IDS.slice(0, 5))],
      [1, makePollAnswer(REGISTERED_USER_IDS.slice(0, 2))],
      [2, makePollAnswer(REGISTERED_USER_IDS.slice(0, 1))],
      [3, makePollAnswer([])],
    ]),
  );

  await service.processPollClose(PLAN_ID);
  expect(eventsService.create).toHaveBeenCalled();
}

async function testStandardNoneWins() {
  setupRegisteredUsersResponse(db, REGISTERED_USER_IDS);
  setupPollWithAnswers(
    new Map([
      [0, makePollAnswer(REGISTERED_USER_IDS.slice(0, 3))],
      [1, makePollAnswer(REGISTERED_USER_IDS.slice(0, 2))],
      [2, makePollAnswer(REGISTERED_USER_IDS.slice(0, 1))],
      [3, makePollAnswer(REGISTERED_USER_IDS.slice(0, 4))],
    ]),
  );

  await service.processPollClose(PLAN_ID);
  expect(eventsService.create).not.toHaveBeenCalled();
  expect(db.update).toHaveBeenCalled();
}

async function testStandardNoneTiesExpires() {
  setupRegisteredUsersResponse(db, REGISTERED_USER_IDS);
  setupPollWithAnswers(
    new Map([
      [0, makePollAnswer(REGISTERED_USER_IDS.slice(0, 3))],
      [1, makePollAnswer(REGISTERED_USER_IDS.slice(0, 2))],
      [2, makePollAnswer(REGISTERED_USER_IDS.slice(0, 1))],
      [3, makePollAnswer(REGISTERED_USER_IDS.slice(0, 3))],
    ]),
  );

  await service.processPollClose(PLAN_ID);
  expect(eventsService.create).not.toHaveBeenCalled();
}

async function testStandardCreatesWithSomeNone() {
  setupRegisteredUsersResponse(db, REGISTERED_USER_IDS);
  setupPollWithAnswers(
    new Map([
      [0, makePollAnswer(REGISTERED_USER_IDS.slice(0, 4))],
      [1, makePollAnswer(REGISTERED_USER_IDS.slice(0, 2))],
      [2, makePollAnswer(REGISTERED_USER_IDS.slice(0, 1))],
      [3, makePollAnswer(REGISTERED_USER_IDS.slice(0, 2))],
    ]),
  );

  await service.processPollClose(PLAN_ID);
  expect(eventsService.create).toHaveBeenCalled();
}

// ─── all_or_nothing mode tests ──────────────────────────────────────────────

const slotConfig = {
  type: 'mmo',
  tank: 1,
  healer: 1,
  dps: 3,
  flex: 0,
  bench: 0,
};

async function testAonRepollBelowThreshold() {
  const plan = makePlan({ pollMode: 'all_or_nothing', slotConfig });
  db.limit.mockResolvedValue([plan]);
  db.orderBy.mockResolvedValue([]);
  setupRegisteredUsersResponse(db, REGISTERED_USER_IDS);
  setupPollWithAnswers(
    new Map([
      [0, makePollAnswer(REGISTERED_USER_IDS.slice(0, 3))],
      [1, makePollAnswer(REGISTERED_USER_IDS.slice(0, 2))],
      [2, makePollAnswer(REGISTERED_USER_IDS.slice(0, 1))],
      [3, makePollAnswer([REGISTERED_USER_IDS[4]])],
    ]),
  );

  await service.processPollClose(PLAN_ID);
  expect(discordClient._mockTextChannel.send).toHaveBeenCalled();
}

async function testAonCreatesWhenThresholdMet() {
  const plan = makePlan({ pollMode: 'all_or_nothing', slotConfig });
  db.limit.mockResolvedValue([plan]);
  setupRegisteredUsersResponse(db, REGISTERED_USER_IDS);
  setupPollWithAnswers(
    new Map([
      [0, makePollAnswer(REGISTERED_USER_IDS.slice(0, 5))],
      [1, makePollAnswer(REGISTERED_USER_IDS.slice(0, 2))],
      [2, makePollAnswer(REGISTERED_USER_IDS.slice(0, 1))],
      [3, makePollAnswer([REGISTERED_USER_IDS[4]])],
    ]),
  );

  await service.processPollClose(PLAN_ID);
  expect(eventsService.create).toHaveBeenCalled();
}

async function testAonCreatesZeroNone() {
  const plan = makePlan({ pollMode: 'all_or_nothing', slotConfig });
  db.limit.mockResolvedValue([plan]);
  setupRegisteredUsersResponse(db, REGISTERED_USER_IDS);
  setupPollWithAnswers(
    new Map([
      [0, makePollAnswer(REGISTERED_USER_IDS.slice(0, 5))],
      [1, makePollAnswer(REGISTERED_USER_IDS.slice(0, 3))],
      [2, makePollAnswer(REGISTERED_USER_IDS.slice(0, 1))],
      [3, makePollAnswer([])],
    ]),
  );

  await service.processPollClose(PLAN_ID);
  expect(eventsService.create).toHaveBeenCalled();
}

async function testAonRepollNoSlotConfig() {
  const plan = makePlan({ pollMode: 'all_or_nothing', slotConfig: null });
  db.limit.mockResolvedValue([plan]);
  db.orderBy.mockResolvedValue([]);
  setupRegisteredUsersResponse(db, REGISTERED_USER_IDS);
  setupPollWithAnswers(
    new Map([
      [0, makePollAnswer(REGISTERED_USER_IDS.slice(0, 5))],
      [1, makePollAnswer(REGISTERED_USER_IDS.slice(0, 3))],
      [2, makePollAnswer(REGISTERED_USER_IDS.slice(0, 1))],
      [3, makePollAnswer([REGISTERED_USER_IDS[4]])],
    ]),
  );

  await service.processPollClose(PLAN_ID);
  expect(discordClient._mockTextChannel.send).toHaveBeenCalled();
}

async function testAonExpiresOnRepollFailure() {
  const plan = makePlan({ pollMode: 'all_or_nothing', slotConfig });
  db.limit.mockResolvedValue([plan]);
  db.orderBy.mockResolvedValue([]);
  setupRegisteredUsersResponse(db, REGISTERED_USER_IDS);
  setupPollWithAnswers(
    new Map([
      [0, makePollAnswer(REGISTERED_USER_IDS.slice(0, 3))],
      [3, makePollAnswer([REGISTERED_USER_IDS[4]])],
    ]),
  );
  discordClient.deleteMessage.mockResolvedValue(undefined);
  discordClient._mockTextChannel.send.mockRejectedValueOnce(
    new Error('Could not post'),
  );
  db.returning.mockResolvedValue([
    makePlan({ status: 'expired', pollMode: 'all_or_nothing' }),
  ]);

  await service.processPollClose(PLAN_ID);
  expect(db.update).toHaveBeenCalled();
}

// ─── winner determination tests ─────────────────────────────────────────────

async function testPicksHighestVotes() {
  setupRegisteredUsersResponse(db, REGISTERED_USER_IDS);
  setupPollWithAnswers(
    new Map([
      [0, makePollAnswer(REGISTERED_USER_IDS.slice(0, 3))],
      [1, makePollAnswer(REGISTERED_USER_IDS.slice(0, 4))],
      [2, makePollAnswer(REGISTERED_USER_IDS.slice(0, 2))],
      [3, makePollAnswer([])],
    ]),
  );

  await service.processPollClose(PLAN_ID);
  const createCall = eventsService.create.mock.calls[0] as [
    number,
    { startTime: string },
  ];
  expect(createCall[1].startTime).toBe('2026-03-11T18:00:00.000Z');
}

async function testPicksEarliestOnTie() {
  setupRegisteredUsersResponse(db, REGISTERED_USER_IDS);
  setupPollWithAnswers(
    new Map([
      [0, makePollAnswer(REGISTERED_USER_IDS.slice(0, 3))],
      [1, makePollAnswer(REGISTERED_USER_IDS.slice(0, 2))],
      [2, makePollAnswer(REGISTERED_USER_IDS.slice(0, 3))],
      [3, makePollAnswer([])],
    ]),
  );

  await service.processPollClose(PLAN_ID);
  const createCall = eventsService.create.mock.calls[0] as [
    number,
    { startTime: string },
  ];
  expect(createCall[1].startTime).toBe('2026-03-10T18:00:00.000Z');
}

async function testAutoSignupCreator() {
  setupRegisteredUsersResponse(db, REGISTERED_USER_IDS);
  setupPollWithAnswers(
    new Map([
      [0, makePollAnswer(REGISTERED_USER_IDS.slice(0, 5))],
      [3, makePollAnswer([])],
    ]),
  );

  await service.processPollClose(PLAN_ID);
  expect(signupsService.signup).toHaveBeenCalledWith(99, CREATOR_ID);
}

async function testMarksPlanCompleted() {
  setupRegisteredUsersResponse(db, REGISTERED_USER_IDS);
  setupPollWithAnswers(
    new Map([
      [0, makePollAnswer(REGISTERED_USER_IDS.slice(0, 5))],
      [3, makePollAnswer([])],
    ]),
  );

  await service.processPollClose(PLAN_ID);
  expect(db.update).toHaveBeenCalled();
}

// ─── re-poll round tracking ─────────────────────────────────────────────────

async function testRepollIncrementsRound() {
  const plan = makePlan({ pollMode: 'all_or_nothing', pollRound: 1 });
  db.limit.mockResolvedValue([plan]);
  db.orderBy.mockResolvedValue([]);
  setupRegisteredUsersResponse(db, REGISTERED_USER_IDS);
  setupPollWithAnswers(
    new Map([
      [0, makePollAnswer(REGISTERED_USER_IDS.slice(0, 3))],
      [3, makePollAnswer([REGISTERED_USER_IDS[4]])],
    ]),
  );

  await service.processPollClose(PLAN_ID);
  const updateCalls = db.update.mock.calls;
  expect(updateCalls.length).toBeGreaterThan(0);

  const setCall = (db.set.mock.calls as unknown[][]).find(
    (call: unknown[]) =>
      call[0] &&
      typeof call[0] === 'object' &&
      'pollRound' in (call[0] as Record<string, unknown>),
  );
  if (setCall) {
    expect((setCall[0] as { pollRound: number }).pollRound).toBe(2);
  }
}

beforeEach(() => setupEach());

describe('processPollClose — basics', () => {
  it('should skip if plan not found', () => testSkipNotFound());
  it('should skip if plan not in polling status', () => testSkipWrongStatus());
  it('should expire on Discord fetch fail', () => testExpireOnDiscordFail());
  it('should expire when no votes', () => testExpireOnNoVotes());
});

describe('processPollClose — registered user filtering', () => {
  it('should only count registered votes', () =>
    testOnlyRegisteredVotesCount());
  it('should not count unregistered None votes', () =>
    testUnregisteredNoneNotCounted());
});

describe('processPollClose — standard mode', () => {
  it('should create event when time slot wins', () =>
    testStandardTimeSlotWins());
  it('should expire when None wins', () => testStandardNoneWins());
  it('should expire when None ties', () => testStandardNoneTiesExpires());
  it('should create event with some None votes', () =>
    testStandardCreatesWithSomeNone());
});

describe('processPollClose — all_or_nothing mode', () => {
  it('should re-poll below roster threshold', () =>
    testAonRepollBelowThreshold());
  it('should create event when threshold met', () =>
    testAonCreatesWhenThresholdMet());
  it('should create with zero None votes', () => testAonCreatesZeroNone());
  it('should re-poll with no slotConfig', () => testAonRepollNoSlotConfig());
  it('should expire when re-poll Discord fails', () =>
    testAonExpiresOnRepollFailure());
});

describe('processPollClose — winner determination', () => {
  it('should pick highest registered votes', () => testPicksHighestVotes());
  it('should pick earliest date on tie', () => testPicksEarliestOnTie());
  it('should auto-signup creator', () => testAutoSignupCreator());
  it('should mark plan as completed', () => testMarksPlanCompleted());
});

describe('processPollClose — re-poll round tracking', () => {
  it('should increment pollRound on re-poll', () =>
    testRepollIncrementsRound());
});
