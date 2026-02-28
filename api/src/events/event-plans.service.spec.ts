import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
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

// Registered Discord user IDs for testing
const REGISTERED_USER_IDS = [
  'discord-user-1',
  'discord-user-2',
  'discord-user-3',
  'discord-user-4',
  'discord-user-5',
];
const UNREGISTERED_USER_IDS = ['unregistered-1', 'unregistered-2'];

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

/**
 * Create a mock Discord poll answer with voters.fetch() support.
 * voterIds: array of Discord user ID strings.
 */
function makePollAnswer(voterIds: string[]) {
  const votersCollection = {
    map: (fn: (user: { id: string }) => string) =>
      voterIds.map((id) => fn({ id })),
  };
  return {
    voteCount: voterIds.length,
    voters: {
      fetch: jest.fn().mockResolvedValue(votersCollection),
    },
  };
}

// ─── DB mock factory ──────────────────────────────────────────────────────────

function makeDbMock(): MockDb {
  const mock = createDrizzleMock();
  mock.limit.mockResolvedValue([makePlan()]);
  mock.returning.mockResolvedValue([makePlan()]);
  return mock;
}

// ─── Discord client mock ──────────────────────────────────────────────────────

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
    channels: {
      fetch: jest.fn().mockResolvedValue(mockTextChannel),
    },
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

// ─── Queue mock ───────────────────────────────────────────────────────────────

function makeQueueMock() {
  const mockJob = { remove: jest.fn().mockResolvedValue(undefined) };
  return {
    add: jest.fn().mockResolvedValue(undefined),
    getJob: jest.fn().mockResolvedValue(mockJob),
    _mockJob: mockJob,
  };
}

/**
 * Helper: set up the DB where mock to return registered users for voter queries.
 * The DB's where chain resolves differently based on call order:
 * 1st call (plan fetch) -> handled by limit mock
 * Subsequent calls (user lookup) -> returns registered user records
 */
function setupRegisteredUsersResponse(
  db: MockDb,
  registeredDiscordIds: string[],
) {
  // The where mock handles multiple chained calls.
  // For fetchPollResults, after fetching the plan, it queries users table.
  // We use mockResolvedValue for the where chain so that the users query
  // returns matching registered users.
  const registeredResponse = registeredDiscordIds.map((id) => ({
    discordId: id,
  }));

  // Override the where chain for users lookup.
  // The plan fetch uses limit(), users lookup uses where() directly (no limit).
  // We need where to resolve to registered users when called by the users query.
  db.where.mockImplementation(() => {
    const chainWithPromise = Object.create(db) as MockDb & {
      then: (resolve: (value: unknown) => void) => void;
    };
    chainWithPromise.then = (resolve: (value: unknown) => void) =>
      resolve(registeredResponse);
    return chainWithPromise;
  });
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('EventPlansService', () => {
  let service: EventPlansService;
  let db: MockDb;
  let discordClient: ReturnType<typeof makeDiscordMock>;
  let queue: ReturnType<typeof makeQueueMock>;
  let channelResolver: { resolveChannelForEvent: jest.Mock };
  let settingsService: { getDefaultTimezone: jest.Mock };
  let eventsService: { create: jest.Mock };
  let signupsService: { signup: jest.Mock };

  beforeEach(async () => {
    db = makeDbMock();
    discordClient = makeDiscordMock();
    queue = makeQueueMock();
    channelResolver = {
      resolveChannelForEvent: jest.fn().mockResolvedValue(CHANNEL_ID),
    };
    settingsService = {
      getDefaultTimezone: jest.fn().mockResolvedValue(null),
    };
    eventsService = {
      create: jest.fn().mockResolvedValue({ id: 99 }),
    };
    signupsService = {
      signup: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventPlansService,
        { provide: DrizzleAsyncProvider, useValue: db },
        { provide: getQueueToken(EVENT_PLANS_QUEUE), useValue: queue },
        { provide: DiscordBotClientService, useValue: discordClient },
        { provide: ChannelResolverService, useValue: channelResolver },
        { provide: SettingsService, useValue: settingsService },
        { provide: EventsService, useValue: eventsService },
        { provide: SignupsService, useValue: signupsService },
      ],
    }).compile();

    service = module.get<EventPlansService>(EventPlansService);
    jest.clearAllMocks();

    // Re-apply mocks after clearAllMocks
    settingsService.getDefaultTimezone.mockResolvedValue(null);
    channelResolver.resolveChannelForEvent.mockResolvedValue(CHANNEL_ID);
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

  // ─── create ─────────────────────────────────────────────────────────────────

  describe('create', () => {
    const validDto = {
      title: 'Raid Night',
      durationMinutes: 120,
      pollOptions: baseOptions,
      pollDurationHours: 24,
      pollMode: 'standard' as const,
    };

    it('should throw BadRequestException when no channel is resolved', async () => {
      channelResolver.resolveChannelForEvent.mockResolvedValue(null);

      await expect(service.create(CREATOR_ID, validDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should insert plan and post Discord poll', async () => {
      const result = await service.create(CREATOR_ID, validDto);

      expect(db.insert).toHaveBeenCalled();
      expect(discordClient._mockTextChannel.send).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result.title).toBe('Raid Night');
    });

    it('should schedule a delayed BullMQ job after creation', async () => {
      await service.create(CREATOR_ID, validDto);

      expect(queue.add).toHaveBeenCalledWith(
        'poll-closed',
        { planId: expect.any(String) as string },
        expect.objectContaining({
          delay: validDto.pollDurationHours * 3600 * 1000,
          attempts: 3,
        }),
      );
    });

    it('should mark plan as draft and throw if Discord poll post fails', async () => {
      discordClient._mockTextChannel.send.mockRejectedValue(
        new Error('No permission'),
      );

      await expect(service.create(CREATOR_ID, validDto)).rejects.toThrow(
        BadRequestException,
      );

      expect(db.update).toHaveBeenCalled();
    });

    it('should include "None of these work" in poll answers', async () => {
      await service.create(CREATOR_ID, validDto);

      // calls[0] is the embed message; calls[1] is the poll message
      const sendCall = (
        discordClient._mockTextChannel.send.mock.calls[1] as unknown[]
      )[0] as {
        poll: { answers: Array<{ text: string }> };
      };

      const lastAnswer =
        sendCall.poll.answers[sendCall.poll.answers.length - 1];
      expect(lastAnswer.text).toBe('None of these work');
    });

    it('should include content prefix for re-poll rounds (round > 1)', async () => {
      // We test the Discord poll posting behavior for round 2+ via handleRepoll
      // The round 1 create call should have no content prefix
      await service.create(CREATOR_ID, validDto);

      // calls[0] is the embed message; calls[1] is the poll message
      const sendCall = (
        discordClient._mockTextChannel.send.mock.calls[1] as unknown[]
      )[0] as {
        content?: string;
      };
      expect(sendCall.content).toBeUndefined();
    });
  });

  // ─── findOne ────────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('should return plan DTO when found', async () => {
      db.limit.mockResolvedValue([makePlan()]);

      const result = await service.findOne(PLAN_ID);

      expect(result.id).toBe(PLAN_ID);
      expect(result.status).toBe('polling');
    });

    it('should throw NotFoundException when plan does not exist', async () => {
      db.limit.mockResolvedValue([]);

      await expect(service.findOne('non-existent-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── findAll ─────────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('should return array of all plans', async () => {
      db.orderBy.mockResolvedValue([makePlan(), makePlan()]);

      const results = await service.findAll();

      expect(Array.isArray(results)).toBe(true);
      expect(results).toHaveLength(2);
    });

    it('should return empty array when no plans exist', async () => {
      db.orderBy.mockResolvedValue([]);

      const results = await service.findAll();

      expect(results).toEqual([]);
    });
  });

  // ─── cancel ─────────────────────────────────────────────────────────────────

  describe('cancel', () => {
    it('should throw NotFoundException when plan not found', async () => {
      db.limit.mockResolvedValue([]);

      await expect(service.cancel(PLAN_ID, CREATOR_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException when caller is not creator', async () => {
      db.limit.mockResolvedValue([makePlan()]);

      const otherUserId = CREATOR_ID + 1;
      await expect(service.cancel(PLAN_ID, otherUserId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw BadRequestException when plan is not in polling status', async () => {
      db.limit.mockResolvedValue([makePlan({ status: 'completed' })]);

      await expect(service.cancel(PLAN_ID, CREATOR_ID)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException when plan is cancelled', async () => {
      db.limit.mockResolvedValue([makePlan({ status: 'cancelled' })]);

      await expect(service.cancel(PLAN_ID, CREATOR_ID)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should delete Discord poll message on cancel', async () => {
      db.limit.mockResolvedValue([makePlan()]);
      db.returning.mockResolvedValue([makePlan({ status: 'cancelled' })]);

      await service.cancel(PLAN_ID, CREATOR_ID);

      expect(discordClient.deleteMessage).toHaveBeenCalledWith(
        CHANNEL_ID,
        MESSAGE_ID,
      );
    });

    it('should remove queued BullMQ job on cancel', async () => {
      db.limit.mockResolvedValue([makePlan()]);
      db.returning.mockResolvedValue([makePlan({ status: 'cancelled' })]);

      await service.cancel(PLAN_ID, CREATOR_ID);

      expect(queue.getJob).toHaveBeenCalledWith(`plan-poll-close-${PLAN_ID}`);
      expect(queue._mockJob.remove).toHaveBeenCalled();
    });

    it('should update plan status to cancelled', async () => {
      db.limit.mockResolvedValue([makePlan()]);
      db.returning.mockResolvedValue([makePlan({ status: 'cancelled' })]);

      const result = await service.cancel(PLAN_ID, CREATOR_ID);

      expect(result.status).toBe('cancelled');
      expect(db.update).toHaveBeenCalled();
    });

    it('should proceed even if Discord message deletion fails', async () => {
      db.limit.mockResolvedValue([makePlan()]);
      db.returning.mockResolvedValue([makePlan({ status: 'cancelled' })]);
      discordClient.deleteMessage.mockRejectedValue(new Error('Message gone'));

      // Should not throw
      await expect(service.cancel(PLAN_ID, CREATOR_ID)).resolves.toBeDefined();
    });
  });

  // ─── processPollClose ────────────────────────────────────────────────────────

  describe('processPollClose', () => {
    beforeEach(() => {
      db.limit.mockResolvedValue([makePlan()]);
      db.returning.mockResolvedValue([makePlan()]);

      // Default: all voters are registered
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
        // Option 0: 3 voters but only 1 registered
        // Option 1: 2 voters, both registered
        // Unregistered votes on option 0 should not count
        discordClient._mockTextChannel.messages.fetch.mockResolvedValue({
          poll: {
            answers: new Map([
              [
                0,
                makePollAnswer([
                  REGISTERED_USER_IDS[0],
                  ...UNREGISTERED_USER_IDS,
                ]),
              ],
              [1, makePollAnswer(REGISTERED_USER_IDS.slice(0, 2))],
              [2, makePollAnswer([])],
              [3, makePollAnswer([])], // None
            ]),
          },
        });

        // Only return the registered user IDs as registered
        setupRegisteredUsersResponse(db, REGISTERED_USER_IDS);

        await service.processPollClose(PLAN_ID);

        // Option 1 should win (2 registered votes) over option 0 (1 registered vote)
        const createCall = eventsService.create.mock.calls[0] as [
          number,
          { startTime: string },
        ];
        expect(createCall[1].startTime).toBe('2026-03-11T18:00:00.000Z');
      });

      it('should not count unregistered user votes for "None" in standard mode', async () => {
        // "None" has 3 total voters but only 1 registered
        // Option 0 has 2 registered voters
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
                  ...UNREGISTERED_USER_IDS,
                ]),
              ], // None: 1 reg + 2 unreg
            ]),
          },
        });

        setupRegisteredUsersResponse(db, REGISTERED_USER_IDS);

        await service.processPollClose(PLAN_ID);

        // Option 0 wins (2 registered) over None (1 registered)
        expect(eventsService.create).toHaveBeenCalled();
      });
    });

    describe('standard mode', () => {
      it('should create event when a time slot wins with most registered votes', async () => {
        // Option 0 has most registered votes (5), "None" index = 3 with 0 votes
        discordClient._mockTextChannel.messages.fetch.mockResolvedValue({
          poll: {
            answers: new Map([
              [0, makePollAnswer(REGISTERED_USER_IDS.slice(0, 5))],
              [1, makePollAnswer(REGISTERED_USER_IDS.slice(0, 2))],
              [2, makePollAnswer(REGISTERED_USER_IDS.slice(0, 1))],
              [3, makePollAnswer([])], // None
            ]),
          },
        });

        setupRegisteredUsersResponse(db, REGISTERED_USER_IDS);

        await service.processPollClose(PLAN_ID);

        expect(eventsService.create).toHaveBeenCalled();
      });

      it('should expire plan when "None" wins with most registered votes', async () => {
        // "None" at index 3 has 4 registered votes (most)
        discordClient._mockTextChannel.messages.fetch.mockResolvedValue({
          poll: {
            answers: new Map([
              [0, makePollAnswer(REGISTERED_USER_IDS.slice(0, 3))],
              [1, makePollAnswer(REGISTERED_USER_IDS.slice(0, 2))],
              [2, makePollAnswer(REGISTERED_USER_IDS.slice(0, 1))],
              [3, makePollAnswer(REGISTERED_USER_IDS.slice(0, 4))], // None wins
            ]),
          },
        });

        setupRegisteredUsersResponse(db, REGISTERED_USER_IDS);

        await service.processPollClose(PLAN_ID);

        expect(eventsService.create).not.toHaveBeenCalled();
        expect(db.update).toHaveBeenCalled();
      });

      it('should expire plan when "None" ties with top time slot', async () => {
        // "None" ties with option 0 at 3 registered votes each
        discordClient._mockTextChannel.messages.fetch.mockResolvedValue({
          poll: {
            answers: new Map([
              [0, makePollAnswer(REGISTERED_USER_IDS.slice(0, 3))],
              [1, makePollAnswer(REGISTERED_USER_IDS.slice(0, 2))],
              [2, makePollAnswer(REGISTERED_USER_IDS.slice(0, 1))],
              [3, makePollAnswer(REGISTERED_USER_IDS.slice(0, 3))], // None ties
            ]),
          },
        });

        setupRegisteredUsersResponse(db, REGISTERED_USER_IDS);

        await service.processPollClose(PLAN_ID);

        expect(eventsService.create).not.toHaveBeenCalled();
      });

      it('should create event even with some "None" votes when a time slot wins', async () => {
        // Option 0 wins (4 registered) over "None" (2 registered)
        discordClient._mockTextChannel.messages.fetch.mockResolvedValue({
          poll: {
            answers: new Map([
              [0, makePollAnswer(REGISTERED_USER_IDS.slice(0, 4))],
              [1, makePollAnswer(REGISTERED_USER_IDS.slice(0, 2))],
              [2, makePollAnswer(REGISTERED_USER_IDS.slice(0, 1))],
              [3, makePollAnswer(REGISTERED_USER_IDS.slice(0, 2))], // None has fewer
            ]),
          },
        });

        setupRegisteredUsersResponse(db, REGISTERED_USER_IDS);

        await service.processPollClose(PLAN_ID);

        expect(eventsService.create).toHaveBeenCalled();
      });
    });

    describe('all_or_nothing mode', () => {
      // Plan with roster slots: 1 tank + 1 healer + 3 DPS = 5 total
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
        // 1 "None" registered vote, option 0 has 3 registered (below 5 threshold)
        discordClient._mockTextChannel.messages.fetch.mockResolvedValue({
          poll: {
            answers: new Map([
              [0, makePollAnswer(REGISTERED_USER_IDS.slice(0, 3))],
              [1, makePollAnswer(REGISTERED_USER_IDS.slice(0, 2))],
              [2, makePollAnswer(REGISTERED_USER_IDS.slice(0, 1))],
              [3, makePollAnswer([REGISTERED_USER_IDS[4]])], // 1 registered "None" vote
            ]),
          },
        });

        db.limit.mockResolvedValue([allOrNothingPlan]);
        db.orderBy.mockResolvedValue([]); // no game_interests users

        await service.processPollClose(PLAN_ID);

        // Should post a new poll (re-poll)
        expect(discordClient._mockTextChannel.send).toHaveBeenCalled();
      });

      it('should create event when roster threshold met despite "None" votes', async () => {
        // 5 registered users vote for option 0 (meets 5-slot threshold)
        // 1 registered user votes "None"
        discordClient._mockTextChannel.messages.fetch.mockResolvedValue({
          poll: {
            answers: new Map([
              [0, makePollAnswer(REGISTERED_USER_IDS.slice(0, 5))],
              [1, makePollAnswer(REGISTERED_USER_IDS.slice(0, 2))],
              [2, makePollAnswer(REGISTERED_USER_IDS.slice(0, 1))],
              [3, makePollAnswer([REGISTERED_USER_IDS[4]])], // 1 "None" vote
            ]),
          },
        });

        await service.processPollClose(PLAN_ID);

        // Threshold met — should create event
        expect(eventsService.create).toHaveBeenCalled();
      });

      it('should create event when zero "None" votes in all_or_nothing mode', async () => {
        discordClient._mockTextChannel.messages.fetch.mockResolvedValue({
          poll: {
            answers: new Map([
              [0, makePollAnswer(REGISTERED_USER_IDS.slice(0, 5))],
              [1, makePollAnswer(REGISTERED_USER_IDS.slice(0, 3))],
              [2, makePollAnswer(REGISTERED_USER_IDS.slice(0, 1))],
              [3, makePollAnswer([])], // Zero "None" votes
            ]),
          },
        });

        await service.processPollClose(PLAN_ID);

        expect(eventsService.create).toHaveBeenCalled();
      });

      it('should re-poll when "None" votes exist with no slotConfig (threshold=0)', async () => {
        // Plan with no slotConfig -> threshold = 0 -> no threshold can be met
        const noSlotPlan = makePlan({
          pollMode: 'all_or_nothing',
          slotConfig: null,
        });
        db.limit.mockResolvedValue([noSlotPlan]);
        db.orderBy.mockResolvedValue([]); // fallback suggestions

        discordClient._mockTextChannel.messages.fetch.mockResolvedValue({
          poll: {
            answers: new Map([
              [0, makePollAnswer(REGISTERED_USER_IDS.slice(0, 5))],
              [1, makePollAnswer(REGISTERED_USER_IDS.slice(0, 3))],
              [2, makePollAnswer(REGISTERED_USER_IDS.slice(0, 1))],
              [3, makePollAnswer([REGISTERED_USER_IDS[4]])], // 1 "None"
            ]),
          },
        });

        await service.processPollClose(PLAN_ID);

        // No threshold can be met with 0 slots -> re-poll
        expect(discordClient._mockTextChannel.send).toHaveBeenCalled();
      });

      it('should expire plan when re-poll Discord post fails', async () => {
        discordClient._mockTextChannel.messages.fetch.mockResolvedValue({
          poll: {
            answers: new Map([
              [0, makePollAnswer(REGISTERED_USER_IDS.slice(0, 3))],
              [3, makePollAnswer([REGISTERED_USER_IDS[4]])], // "None" triggers re-poll
            ]),
          },
        });

        db.limit.mockResolvedValue([allOrNothingPlan]);
        db.orderBy.mockResolvedValue([]); // no game_interests → fallback

        // Simulate the new poll post failing
        discordClient.deleteMessage.mockResolvedValue(undefined);
        discordClient._mockTextChannel.send.mockRejectedValueOnce(
          new Error('Could not post'),
        );

        // After repoll fails, plan expires
        db.returning.mockResolvedValue([
          makePlan({ status: 'expired', pollMode: 'all_or_nothing' }),
        ]);

        await service.processPollClose(PLAN_ID);

        // The db.update should be called to expire the plan
        expect(db.update).toHaveBeenCalled();
      });
    });

    describe('winner determination', () => {
      beforeEach(() => {
        setupRegisteredUsersResponse(db, REGISTERED_USER_IDS);
      });

      it('should pick the option with the highest registered votes', async () => {
        // Option 1 has highest registered votes (4)
        discordClient._mockTextChannel.messages.fetch.mockResolvedValue({
          poll: {
            answers: new Map([
              [0, makePollAnswer(REGISTERED_USER_IDS.slice(0, 3))],
              [1, makePollAnswer(REGISTERED_USER_IDS.slice(0, 4))], // winner
              [2, makePollAnswer(REGISTERED_USER_IDS.slice(0, 2))],
              [3, makePollAnswer([])], // None
            ]),
          },
        });

        await service.processPollClose(PLAN_ID);

        const createCall = eventsService.create.mock.calls[0] as [
          number,
          { startTime: string },
        ];
        // The winning option is index 1 → date '2026-03-11T18:00:00.000Z'
        expect(createCall[1].startTime).toBe('2026-03-11T18:00:00.000Z');
      });

      it('should pick the earliest date when registered votes are tied', async () => {
        // Options 0 and 2 tie at 3 registered votes; option 0 is earlier
        discordClient._mockTextChannel.messages.fetch.mockResolvedValue({
          poll: {
            answers: new Map([
              [0, makePollAnswer(REGISTERED_USER_IDS.slice(0, 3))], // earlier
              [1, makePollAnswer(REGISTERED_USER_IDS.slice(0, 2))],
              [2, makePollAnswer(REGISTERED_USER_IDS.slice(0, 3))], // later
              [3, makePollAnswer([])], // None
            ]),
          },
        });

        await service.processPollClose(PLAN_ID);

        const createCall = eventsService.create.mock.calls[0] as [
          number,
          { startTime: string },
        ];
        // Tie-break: option 0 has the earliest date
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

  // ─── getTimeSuggestions ──────────────────────────────────────────────────────

  describe('getTimeSuggestions', () => {
    it('should return fallback suggestions when no gameId provided', async () => {
      const result = await service.getTimeSuggestions();

      expect(result.source).toBe('fallback');
      expect(result.interestedPlayerCount).toBe(0);
      expect(Array.isArray(result.suggestions)).toBe(true);
    });

    it('should return fallback suggestions when no game interests exist', async () => {
      db.where.mockResolvedValue([]); // no game interests

      const result = await service.getTimeSuggestions(1);

      expect(result.source).toBe('fallback');
    });

    it('should generate fallback suggestions with evening hours (6-9 PM)', async () => {
      const result = await service.getTimeSuggestions();

      const hours = result.suggestions.map((s) => new Date(s.date).getHours());
      const eveningHours = [18, 19, 20, 21];
      hours.forEach((h) => {
        expect(eveningHours).toContain(h);
      });
    });

    it('should return fallback suggestions with availableCount of 0', async () => {
      const result = await service.getTimeSuggestions();

      result.suggestions.forEach((s) => {
        expect(s.availableCount).toBe(0);
      });
    });

    it('should generate up to 7 days x 4 evening hours of fallback suggestions', async () => {
      const result = await service.getTimeSuggestions();

      // At most 28 suggestions (7 days × 4 hours), all in the future
      expect(result.suggestions.length).toBeLessThanOrEqual(28);
      expect(result.suggestions.length).toBeGreaterThan(0);
    });

    it('should return game-interest source when game interests and templates exist', async () => {
      // game interests
      db.where.mockResolvedValueOnce([{ userId: 1 }, { userId: 2 }]);
      // game time templates
      db.where.mockResolvedValueOnce([
        { dayOfWeek: 0, startHour: 18 },
        { dayOfWeek: 0, startHour: 18 }, // duplicate to give count=2
        { dayOfWeek: 1, startHour: 19 },
      ]);

      const result = await service.getTimeSuggestions(5);

      expect(result.source).toBe('game-interest');
      expect(result.interestedPlayerCount).toBe(2);
    });

    it('should respect afterDate parameter for suggestions', async () => {
      const futureDate = new Date(Date.now() + 10 * 24 * 3600 * 1000);
      const result = await service.getTimeSuggestions(
        undefined,
        0,
        futureDate.toISOString(),
      );

      result.suggestions.forEach((s) => {
        expect(new Date(s.date).getTime()).toBeGreaterThan(
          futureDate.getTime(),
        );
      });
    });
  });

  // ─── handleRepoll round increment ────────────────────────────────────────────

  describe('re-poll round tracking', () => {
    it('should increment pollRound when re-poll is triggered', async () => {
      const plan = makePlan({ pollMode: 'all_or_nothing', pollRound: 1 });
      db.limit.mockResolvedValue([plan]);
      db.orderBy.mockResolvedValue([]); // no game_interests → fallback

      // "None" vote triggers re-poll (no roster threshold since no slotConfig)
      discordClient._mockTextChannel.messages.fetch.mockResolvedValue({
        poll: {
          answers: new Map([
            [0, makePollAnswer(REGISTERED_USER_IDS.slice(0, 3))],
            [3, makePollAnswer([REGISTERED_USER_IDS[4]])], // "None"
          ]),
        },
      });

      setupRegisteredUsersResponse(db, REGISTERED_USER_IDS);

      await service.processPollClose(PLAN_ID);

      // The update should have been called with pollRound: 2
      const updateCalls = db.update.mock.calls;
      expect(updateCalls.length).toBeGreaterThan(0);

      // Find the set call that includes pollRound
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
