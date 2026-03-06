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

// ─── Shared fixtures ──────────────────────────────────────────────────────────

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

function makeDbMock(): MockDb {
  const mock = createDrizzleMock();
  mock.limit.mockResolvedValue([makePlan()]);
  mock.returning.mockResolvedValue([makePlan()]);
  return mock;
}

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

describe('EventPlansService — processPollClose', () => {
  let service: EventPlansService;
  let db: MockDb;
  let discordClient: ReturnType<typeof makeDiscordMock>;
  let eventsService: { create: jest.Mock };
  let signupsService: { signup: jest.Mock };

  beforeEach(async () => {
    db = makeDbMock();
    discordClient = makeDiscordMock();
    const queue = makeQueueMock();
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
  });

  describe('processPollClose', () => {
    beforeEach(() => {
      db.limit.mockResolvedValue([makePlan()]);
      db.returning.mockResolvedValue([makePlan()]);
      setupRegisteredUsersResponse(db, REGISTERED_USER_IDS);
    });

    it('should skip if plan is not found', async () => {
      db.limit.mockResolvedValue([]);
      await service.processPollClose(PLAN_ID);
      expect(db.update).not.toHaveBeenCalled();
    });

    it('should skip if plan is not in polling status', async () => {
      db.limit.mockResolvedValue([makePlan({ status: 'completed' })]);
      await service.processPollClose(PLAN_ID);
      expect(db.update).not.toHaveBeenCalled();
    });

    it('should expire plan if Discord poll fetch fails', async () => {
      discordClient._mockClient.channels.fetch.mockRejectedValue(
        new Error('Discord down'),
      );
      await service.processPollClose(PLAN_ID);
      expect(db.update).toHaveBeenCalled();
    });

    it('should expire plan when there are no votes', async () => {
      discordClient._mockTextChannel.messages.fetch.mockResolvedValue({
        poll: { answers: new Map() },
      });
      await service.processPollClose(PLAN_ID);
      expect(db.update).toHaveBeenCalled();
    });

    describe('registered-user vote filtering', () => {
      it('should only count registered user votes for winner determination', async () => {
        discordClient._mockTextChannel.messages.fetch.mockResolvedValue({
          poll: {
            answers: new Map([
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
          },
        });
        setupRegisteredUsersResponse(db, REGISTERED_USER_IDS);

        await service.processPollClose(PLAN_ID);

        const createCall = eventsService.create.mock.calls[0] as [
          number,
          { startTime: string },
        ];
        expect(createCall[1].startTime).toBe('2026-03-11T18:00:00.000Z');
      });

      it('should not count unregistered user votes for "None" in standard mode', async () => {
        discordClient._mockTextChannel.messages.fetch.mockResolvedValue({
          poll: {
            answers: new Map([
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
          },
        });
        setupRegisteredUsersResponse(db, REGISTERED_USER_IDS);

        await service.processPollClose(PLAN_ID);
        expect(eventsService.create).toHaveBeenCalled();
      });
    });

    describe('standard mode', () => {
      it('should create event when a time slot wins with most registered votes', async () => {
        discordClient._mockTextChannel.messages.fetch.mockResolvedValue({
          poll: {
            answers: new Map([
              [0, makePollAnswer(REGISTERED_USER_IDS.slice(0, 5))],
              [1, makePollAnswer(REGISTERED_USER_IDS.slice(0, 2))],
              [2, makePollAnswer(REGISTERED_USER_IDS.slice(0, 1))],
              [3, makePollAnswer([])],
            ]),
          },
        });
        setupRegisteredUsersResponse(db, REGISTERED_USER_IDS);

        await service.processPollClose(PLAN_ID);
        expect(eventsService.create).toHaveBeenCalled();
      });

      it('should expire plan when "None" wins with most registered votes', async () => {
        discordClient._mockTextChannel.messages.fetch.mockResolvedValue({
          poll: {
            answers: new Map([
              [0, makePollAnswer(REGISTERED_USER_IDS.slice(0, 3))],
              [1, makePollAnswer(REGISTERED_USER_IDS.slice(0, 2))],
              [2, makePollAnswer(REGISTERED_USER_IDS.slice(0, 1))],
              [3, makePollAnswer(REGISTERED_USER_IDS.slice(0, 4))],
            ]),
          },
        });
        setupRegisteredUsersResponse(db, REGISTERED_USER_IDS);

        await service.processPollClose(PLAN_ID);
        expect(eventsService.create).not.toHaveBeenCalled();
        expect(db.update).toHaveBeenCalled();
      });

      it('should expire plan when "None" ties with top time slot', async () => {
        discordClient._mockTextChannel.messages.fetch.mockResolvedValue({
          poll: {
            answers: new Map([
              [0, makePollAnswer(REGISTERED_USER_IDS.slice(0, 3))],
              [1, makePollAnswer(REGISTERED_USER_IDS.slice(0, 2))],
              [2, makePollAnswer(REGISTERED_USER_IDS.slice(0, 1))],
              [3, makePollAnswer(REGISTERED_USER_IDS.slice(0, 3))],
            ]),
          },
        });
        setupRegisteredUsersResponse(db, REGISTERED_USER_IDS);

        await service.processPollClose(PLAN_ID);
        expect(eventsService.create).not.toHaveBeenCalled();
      });

      it('should create event even with some "None" votes when a time slot wins', async () => {
        discordClient._mockTextChannel.messages.fetch.mockResolvedValue({
          poll: {
            answers: new Map([
              [0, makePollAnswer(REGISTERED_USER_IDS.slice(0, 4))],
              [1, makePollAnswer(REGISTERED_USER_IDS.slice(0, 2))],
              [2, makePollAnswer(REGISTERED_USER_IDS.slice(0, 1))],
              [3, makePollAnswer(REGISTERED_USER_IDS.slice(0, 2))],
            ]),
          },
        });
        setupRegisteredUsersResponse(db, REGISTERED_USER_IDS);

        await service.processPollClose(PLAN_ID);
        expect(eventsService.create).toHaveBeenCalled();
      });
    });

    describe('all_or_nothing mode', () => {
      const slotConfig = {
        type: 'mmo',
        tank: 1,
        healer: 1,
        dps: 3,
        flex: 0,
        bench: 0,
      };
      const allOrNothingPlan = makePlan({
        pollMode: 'all_or_nothing',
        slotConfig,
      });

      beforeEach(() => {
        db.limit.mockResolvedValue([allOrNothingPlan]);
        setupRegisteredUsersResponse(db, REGISTERED_USER_IDS);
      });

      it('should trigger re-poll when "None" votes exist and no slot meets roster threshold', async () => {
        discordClient._mockTextChannel.messages.fetch.mockResolvedValue({
          poll: {
            answers: new Map([
              [0, makePollAnswer(REGISTERED_USER_IDS.slice(0, 3))],
              [1, makePollAnswer(REGISTERED_USER_IDS.slice(0, 2))],
              [2, makePollAnswer(REGISTERED_USER_IDS.slice(0, 1))],
              [3, makePollAnswer([REGISTERED_USER_IDS[4]])],
            ]),
          },
        });
        db.limit.mockResolvedValue([allOrNothingPlan]);
        db.orderBy.mockResolvedValue([]);

        await service.processPollClose(PLAN_ID);
        expect(discordClient._mockTextChannel.send).toHaveBeenCalled();
      });

      it('should create event when roster threshold met despite "None" votes', async () => {
        discordClient._mockTextChannel.messages.fetch.mockResolvedValue({
          poll: {
            answers: new Map([
              [0, makePollAnswer(REGISTERED_USER_IDS.slice(0, 5))],
              [1, makePollAnswer(REGISTERED_USER_IDS.slice(0, 2))],
              [2, makePollAnswer(REGISTERED_USER_IDS.slice(0, 1))],
              [3, makePollAnswer([REGISTERED_USER_IDS[4]])],
            ]),
          },
        });

        await service.processPollClose(PLAN_ID);
        expect(eventsService.create).toHaveBeenCalled();
      });

      it('should create event when zero "None" votes in all_or_nothing mode', async () => {
        discordClient._mockTextChannel.messages.fetch.mockResolvedValue({
          poll: {
            answers: new Map([
              [0, makePollAnswer(REGISTERED_USER_IDS.slice(0, 5))],
              [1, makePollAnswer(REGISTERED_USER_IDS.slice(0, 3))],
              [2, makePollAnswer(REGISTERED_USER_IDS.slice(0, 1))],
              [3, makePollAnswer([])],
            ]),
          },
        });

        await service.processPollClose(PLAN_ID);
        expect(eventsService.create).toHaveBeenCalled();
      });

      it('should re-poll when "None" votes exist with no slotConfig (threshold=0)', async () => {
        const noSlotPlan = makePlan({
          pollMode: 'all_or_nothing',
          slotConfig: null,
        });
        db.limit.mockResolvedValue([noSlotPlan]);
        db.orderBy.mockResolvedValue([]);

        discordClient._mockTextChannel.messages.fetch.mockResolvedValue({
          poll: {
            answers: new Map([
              [0, makePollAnswer(REGISTERED_USER_IDS.slice(0, 5))],
              [1, makePollAnswer(REGISTERED_USER_IDS.slice(0, 3))],
              [2, makePollAnswer(REGISTERED_USER_IDS.slice(0, 1))],
              [3, makePollAnswer([REGISTERED_USER_IDS[4]])],
            ]),
          },
        });

        await service.processPollClose(PLAN_ID);
        expect(discordClient._mockTextChannel.send).toHaveBeenCalled();
      });

      it('should expire plan when re-poll Discord post fails', async () => {
        discordClient._mockTextChannel.messages.fetch.mockResolvedValue({
          poll: {
            answers: new Map([
              [0, makePollAnswer(REGISTERED_USER_IDS.slice(0, 3))],
              [3, makePollAnswer([REGISTERED_USER_IDS[4]])],
            ]),
          },
        });
        db.limit.mockResolvedValue([allOrNothingPlan]);
        db.orderBy.mockResolvedValue([]);
        discordClient.deleteMessage.mockResolvedValue(undefined);
        discordClient._mockTextChannel.send.mockRejectedValueOnce(
          new Error('Could not post'),
        );
        db.returning.mockResolvedValue([
          makePlan({ status: 'expired', pollMode: 'all_or_nothing' }),
        ]);

        await service.processPollClose(PLAN_ID);
        expect(db.update).toHaveBeenCalled();
      });
    });

    describe('winner determination', () => {
      beforeEach(() => {
        setupRegisteredUsersResponse(db, REGISTERED_USER_IDS);
      });

      it('should pick the option with the highest registered votes', async () => {
        discordClient._mockTextChannel.messages.fetch.mockResolvedValue({
          poll: {
            answers: new Map([
              [0, makePollAnswer(REGISTERED_USER_IDS.slice(0, 3))],
              [1, makePollAnswer(REGISTERED_USER_IDS.slice(0, 4))],
              [2, makePollAnswer(REGISTERED_USER_IDS.slice(0, 2))],
              [3, makePollAnswer([])],
            ]),
          },
        });

        await service.processPollClose(PLAN_ID);
        const createCall = eventsService.create.mock.calls[0] as [
          number,
          { startTime: string },
        ];
        expect(createCall[1].startTime).toBe('2026-03-11T18:00:00.000Z');
      });

      it('should pick the earliest date when registered votes are tied', async () => {
        discordClient._mockTextChannel.messages.fetch.mockResolvedValue({
          poll: {
            answers: new Map([
              [0, makePollAnswer(REGISTERED_USER_IDS.slice(0, 3))],
              [1, makePollAnswer(REGISTERED_USER_IDS.slice(0, 2))],
              [2, makePollAnswer(REGISTERED_USER_IDS.slice(0, 3))],
              [3, makePollAnswer([])],
            ]),
          },
        });

        await service.processPollClose(PLAN_ID);
        const createCall = eventsService.create.mock.calls[0] as [
          number,
          { startTime: string },
        ];
        expect(createCall[1].startTime).toBe('2026-03-10T18:00:00.000Z');
      });

      it('should auto-signup the creator after event creation', async () => {
        discordClient._mockTextChannel.messages.fetch.mockResolvedValue({
          poll: {
            answers: new Map([
              [0, makePollAnswer(REGISTERED_USER_IDS.slice(0, 5))],
              [3, makePollAnswer([])],
            ]),
          },
        });

        await service.processPollClose(PLAN_ID);
        expect(signupsService.signup).toHaveBeenCalledWith(99, CREATOR_ID);
      });

      it('should mark plan as completed after successful event creation', async () => {
        discordClient._mockTextChannel.messages.fetch.mockResolvedValue({
          poll: {
            answers: new Map([
              [0, makePollAnswer(REGISTERED_USER_IDS.slice(0, 5))],
              [3, makePollAnswer([])],
            ]),
          },
        });

        await service.processPollClose(PLAN_ID);
        expect(db.update).toHaveBeenCalled();
      });
    });
  });

  // ─── handleRepoll round increment ────────────────────────────────────────────

  describe('re-poll round tracking', () => {
    it('should increment pollRound when re-poll is triggered', async () => {
      const plan = makePlan({ pollMode: 'all_or_nothing', pollRound: 1 });
      db.limit.mockResolvedValue([plan]);
      db.orderBy.mockResolvedValue([]);

      discordClient._mockTextChannel.messages.fetch.mockResolvedValue({
        poll: {
          answers: new Map([
            [0, makePollAnswer(REGISTERED_USER_IDS.slice(0, 3))],
            [3, makePollAnswer([REGISTERED_USER_IDS[4]])],
          ]),
        },
      });

      setupRegisteredUsersResponse(db, REGISTERED_USER_IDS);

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
    });
  });
});
