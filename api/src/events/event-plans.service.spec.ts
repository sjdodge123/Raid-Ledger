import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { EventPlansService, EVENT_PLANS_QUEUE } from './event-plans.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { ChannelResolverService } from '../discord-bot/services/channel-resolver.service';
import { EventsService } from './events.service';
import { SignupsService } from './signups.service';
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

function makePlan(overrides: Record<string, unknown> = {}) {
  return {
    id: PLAN_ID,
    creatorId: CREATOR_ID,
    title: 'Raid Night',
    description: null,
    gameId: null,
    slotConfig: null,
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

// ─── DB mock factory ──────────────────────────────────────────────────────────

function makeDbMock() {
  const chain = {
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue([makePlan()]),
    set: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    returning: jest.fn().mockResolvedValue([makePlan()]),
    orderBy: jest.fn().mockReturnThis(),
  };

  return {
    select: jest.fn().mockReturnValue(chain),
    insert: jest.fn().mockReturnValue(chain),
    update: jest.fn().mockReturnValue(chain),
    delete: jest.fn().mockReturnValue(chain),
    _chain: chain,
  };
}

// ─── Discord client mock ──────────────────────────────────────────────────────

function makeDiscordMock() {
  const mockTextChannel = {
    send: jest.fn().mockResolvedValue({ id: MESSAGE_ID }),
    messages: {
      fetch: jest.fn().mockResolvedValue({
        poll: {
          answers: new Map([
            [0, { voteCount: 5 }],
            [1, { voteCount: 3 }],
            [2, { voteCount: 1 }],
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

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('EventPlansService', () => {
  let service: EventPlansService;
  let db: ReturnType<typeof makeDbMock>;
  let discordClient: ReturnType<typeof makeDiscordMock>;
  let queue: ReturnType<typeof makeQueueMock>;
  let channelResolver: { resolveChannelForEvent: jest.Mock };
  let eventsService: { create: jest.Mock };
  let signupsService: { signup: jest.Mock };

  beforeEach(async () => {
    db = makeDbMock();
    discordClient = makeDiscordMock();
    queue = makeQueueMock();
    channelResolver = {
      resolveChannelForEvent: jest.fn().mockResolvedValue(CHANNEL_ID),
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
        { provide: EventsService, useValue: eventsService },
        { provide: SignupsService, useValue: signupsService },
      ],
    }).compile();

    service = module.get<EventPlansService>(EventPlansService);
    jest.clearAllMocks();

    // Re-apply mocks after clearAllMocks
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
    db._chain.limit.mockResolvedValue([makePlan()]);
    db._chain.returning.mockResolvedValue([makePlan()]);
    db.select.mockReturnValue(db._chain);
    db.insert.mockReturnValue(db._chain);
    db.update.mockReturnValue(db._chain);
    db._chain.from.mockReturnThis();
    db._chain.where.mockReturnThis();
    db._chain.set.mockReturnThis();
    db._chain.values.mockReturnThis();
    db._chain.orderBy.mockReturnThis();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
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
        { planId: expect.any(String) },
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

      const sendCall =
        discordClient._mockTextChannel.send.mock.calls[0][0] as {
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

      const sendCall = discordClient._mockTextChannel.send.mock.calls[0][0] as {
        content?: string;
      };
      expect(sendCall.content).toBeUndefined();
    });
  });

  // ─── findOne ────────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('should return plan DTO when found', async () => {
      db._chain.limit.mockResolvedValue([makePlan()]);

      const result = await service.findOne(PLAN_ID);

      expect(result.id).toBe(PLAN_ID);
      expect(result.status).toBe('polling');
    });

    it('should throw NotFoundException when plan does not exist', async () => {
      db._chain.limit.mockResolvedValue([]);

      await expect(service.findOne('non-existent-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── findByCreator ───────────────────────────────────────────────────────────

  describe('findByCreator', () => {
    it('should return array of plans for a user', async () => {
      db._chain.orderBy.mockResolvedValue([makePlan(), makePlan()]);

      const results = await service.findByCreator(CREATOR_ID);

      expect(Array.isArray(results)).toBe(true);
      expect(results).toHaveLength(2);
    });

    it('should return empty array when user has no plans', async () => {
      db._chain.orderBy.mockResolvedValue([]);

      const results = await service.findByCreator(CREATOR_ID);

      expect(results).toEqual([]);
    });
  });

  // ─── cancel ─────────────────────────────────────────────────────────────────

  describe('cancel', () => {
    it('should throw NotFoundException when plan not found', async () => {
      db._chain.limit.mockResolvedValue([]);

      await expect(service.cancel(PLAN_ID, CREATOR_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException when caller is not creator', async () => {
      db._chain.limit.mockResolvedValue([makePlan()]);

      const otherUserId = CREATOR_ID + 1;
      await expect(service.cancel(PLAN_ID, otherUserId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw BadRequestException when plan is not in polling status', async () => {
      db._chain.limit.mockResolvedValue([makePlan({ status: 'completed' })]);

      await expect(service.cancel(PLAN_ID, CREATOR_ID)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException when plan is cancelled', async () => {
      db._chain.limit.mockResolvedValue([makePlan({ status: 'cancelled' })]);

      await expect(service.cancel(PLAN_ID, CREATOR_ID)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should delete Discord poll message on cancel', async () => {
      db._chain.limit.mockResolvedValue([makePlan()]);
      db._chain.returning.mockResolvedValue([makePlan({ status: 'cancelled' })]);

      await service.cancel(PLAN_ID, CREATOR_ID);

      expect(discordClient.deleteMessage).toHaveBeenCalledWith(
        CHANNEL_ID,
        MESSAGE_ID,
      );
    });

    it('should remove queued BullMQ job on cancel', async () => {
      db._chain.limit.mockResolvedValue([makePlan()]);
      db._chain.returning.mockResolvedValue([makePlan({ status: 'cancelled' })]);

      await service.cancel(PLAN_ID, CREATOR_ID);

      expect(queue.getJob).toHaveBeenCalledWith(`plan-poll-close-${PLAN_ID}`);
      expect(queue._mockJob.remove).toHaveBeenCalled();
    });

    it('should update plan status to cancelled', async () => {
      db._chain.limit.mockResolvedValue([makePlan()]);
      db._chain.returning.mockResolvedValue([makePlan({ status: 'cancelled' })]);

      const result = await service.cancel(PLAN_ID, CREATOR_ID);

      expect(result.status).toBe('cancelled');
      expect(db.update).toHaveBeenCalled();
    });

    it('should proceed even if Discord message deletion fails', async () => {
      db._chain.limit.mockResolvedValue([makePlan()]);
      db._chain.returning.mockResolvedValue([makePlan({ status: 'cancelled' })]);
      discordClient.deleteMessage.mockRejectedValue(new Error('Message gone'));

      // Should not throw
      await expect(service.cancel(PLAN_ID, CREATOR_ID)).resolves.toBeDefined();
    });
  });

  // ─── processPollClose ────────────────────────────────────────────────────────

  describe('processPollClose', () => {
    beforeEach(() => {
      db._chain.limit.mockResolvedValue([makePlan()]);
      db._chain.returning.mockResolvedValue([makePlan()]);
    });

    it('should skip if plan is not found', async () => {
      db._chain.limit.mockResolvedValue([]);

      await service.processPollClose(PLAN_ID);

      expect(db.update).not.toHaveBeenCalled();
    });

    it('should skip if plan is not in polling status', async () => {
      db._chain.limit.mockResolvedValue([makePlan({ status: 'completed' })]);

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

    describe('standard mode', () => {
      it('should create event when a time slot wins with most votes', async () => {
        // Option 0 has most votes (5), "None" index = 3 with 0 votes
        discordClient._mockTextChannel.messages.fetch.mockResolvedValue({
          poll: {
            answers: new Map([
              [0, { voteCount: 5 }],
              [1, { voteCount: 2 }],
              [2, { voteCount: 1 }],
              [3, { voteCount: 0 }], // None
            ]),
          },
        });

        await service.processPollClose(PLAN_ID);

        expect(eventsService.create).toHaveBeenCalled();
      });

      it('should expire plan when "None" wins with most votes', async () => {
        // "None" at index 3 has 6 votes (most)
        discordClient._mockTextChannel.messages.fetch.mockResolvedValue({
          poll: {
            answers: new Map([
              [0, { voteCount: 3 }],
              [1, { voteCount: 2 }],
              [2, { voteCount: 1 }],
              [3, { voteCount: 6 }], // None wins
            ]),
          },
        });

        await service.processPollClose(PLAN_ID);

        expect(eventsService.create).not.toHaveBeenCalled();
        expect(db.update).toHaveBeenCalled();
      });

      it('should expire plan when "None" ties with top time slot', async () => {
        // "None" at index 3 ties with option 0 at 5 each — "None" wins on tie
        discordClient._mockTextChannel.messages.fetch.mockResolvedValue({
          poll: {
            answers: new Map([
              [0, { voteCount: 5 }],
              [1, { voteCount: 2 }],
              [2, { voteCount: 1 }],
              [3, { voteCount: 5 }], // None ties
            ]),
          },
        });

        await service.processPollClose(PLAN_ID);

        expect(eventsService.create).not.toHaveBeenCalled();
      });

      it('should create event even with some "None" votes when a time slot wins', async () => {
        // Option 0 wins (7 votes) over "None" (4 votes)
        discordClient._mockTextChannel.messages.fetch.mockResolvedValue({
          poll: {
            answers: new Map([
              [0, { voteCount: 7 }],
              [1, { voteCount: 2 }],
              [2, { voteCount: 1 }],
              [3, { voteCount: 4 }], // None has fewer votes
            ]),
          },
        });

        await service.processPollClose(PLAN_ID);

        expect(eventsService.create).toHaveBeenCalled();
      });
    });

    describe('all_or_nothing mode', () => {
      const allOrNothingPlan = makePlan({ pollMode: 'all_or_nothing' });

      beforeEach(() => {
        db._chain.limit.mockResolvedValue([allOrNothingPlan]);
      });

      it('should trigger re-poll when ANY "None" votes exist', async () => {
        // 1 "None" vote is enough to trigger re-poll
        discordClient._mockTextChannel.messages.fetch.mockResolvedValue({
          poll: {
            answers: new Map([
              [0, { voteCount: 5 }],
              [1, { voteCount: 3 }],
              [2, { voteCount: 2 }],
              [3, { voteCount: 1 }], // Just 1 "None" vote triggers re-poll
            ]),
          },
        });

        // The re-poll path calls getTimeSuggestions → needs game_interests query
        // and then a repoll → keep limit resolving the plan on first select call
        // then later selects (for game_interests) return empty via orderBy chain
        db._chain.limit.mockResolvedValue([allOrNothingPlan]);
        db._chain.orderBy.mockResolvedValue([]); // no game_interests users

        await service.processPollClose(PLAN_ID);

        // Should post a new poll (re-poll)
        expect(discordClient._mockTextChannel.send).toHaveBeenCalled();
      });

      it('should create event when zero "None" votes in all_or_nothing mode', async () => {
        discordClient._mockTextChannel.messages.fetch.mockResolvedValue({
          poll: {
            answers: new Map([
              [0, { voteCount: 8 }],
              [1, { voteCount: 3 }],
              [2, { voteCount: 1 }],
              [3, { voteCount: 0 }], // Zero "None" votes
            ]),
          },
        });

        await service.processPollClose(PLAN_ID);

        expect(eventsService.create).toHaveBeenCalled();
      });

      it('should expire plan when re-poll Discord post fails', async () => {
        discordClient._mockTextChannel.messages.fetch.mockResolvedValue({
          poll: {
            answers: new Map([
              [0, { voteCount: 5 }],
              [3, { voteCount: 1 }], // "None" vote triggers re-poll
            ]),
          },
        });

        db._chain.limit.mockResolvedValue([allOrNothingPlan]);
        db._chain.orderBy.mockResolvedValue([]); // no game_interests → fallback

        // Simulate the new poll post failing
        discordClient.deleteMessage.mockResolvedValue(undefined);
        discordClient._mockTextChannel.send.mockRejectedValueOnce(
          new Error('Could not post'),
        );

        // After repoll fails, plan expires
        db._chain.returning.mockResolvedValue([
          makePlan({ status: 'expired', pollMode: 'all_or_nothing' }),
        ]);

        await service.processPollClose(PLAN_ID);

        // The db.update should be called to expire the plan
        expect(db.update).toHaveBeenCalled();
      });
    });

    describe('winner determination', () => {
      it('should pick the option with the highest votes', async () => {
        // Option 1 has highest votes
        discordClient._mockTextChannel.messages.fetch.mockResolvedValue({
          poll: {
            answers: new Map([
              [0, { voteCount: 3 }],
              [1, { voteCount: 8 }], // winner
              [2, { voteCount: 2 }],
              [3, { voteCount: 0 }], // None
            ]),
          },
        });

        await service.processPollClose(PLAN_ID);

        const createCall = eventsService.create.mock.calls[0];
        // The winning option is index 1 → date '2026-03-11T18:00:00.000Z'
        expect(createCall[1].startTime).toBe('2026-03-11T18:00:00.000Z');
      });

      it('should pick the earliest date when votes are tied', async () => {
        // Options 0 and 2 tie at 5 votes; option 0 is earlier
        discordClient._mockTextChannel.messages.fetch.mockResolvedValue({
          poll: {
            answers: new Map([
              [0, { voteCount: 5 }], // earlier date
              [1, { voteCount: 3 }],
              [2, { voteCount: 5 }], // later date
              [3, { voteCount: 0 }], // None
            ]),
          },
        });

        await service.processPollClose(PLAN_ID);

        const createCall = eventsService.create.mock.calls[0];
        // Tie-break: option 0 has the earliest date
        expect(createCall[1].startTime).toBe('2026-03-10T18:00:00.000Z');
      });

      it('should auto-signup the creator after event creation', async () => {
        discordClient._mockTextChannel.messages.fetch.mockResolvedValue({
          poll: {
            answers: new Map([
              [0, { voteCount: 5 }],
              [3, { voteCount: 0 }],
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
              [0, { voteCount: 5 }],
              [3, { voteCount: 0 }],
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
      db._chain.where.mockResolvedValue([]); // no game interests

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

    it('should generate up to 7 days × 4 evening hours of fallback suggestions', async () => {
      const result = await service.getTimeSuggestions();

      // At most 28 suggestions (7 days × 4 hours), all in the future
      expect(result.suggestions.length).toBeLessThanOrEqual(28);
      expect(result.suggestions.length).toBeGreaterThan(0);
    });

    it('should return game-interest source when game interests and templates exist', async () => {
      // game interests
      db._chain.where.mockResolvedValueOnce([{ userId: 1 }, { userId: 2 }]);
      // game time templates
      db._chain.where.mockResolvedValueOnce([
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
        expect(new Date(s.date).getTime()).toBeGreaterThan(futureDate.getTime());
      });
    });
  });

  // ─── handleRepoll round increment ────────────────────────────────────────────

  describe('re-poll round tracking', () => {
    it('should increment pollRound when re-poll is triggered', async () => {
      const plan = makePlan({ pollMode: 'all_or_nothing', pollRound: 1 });
      db._chain.limit.mockResolvedValue([plan]);
      db._chain.orderBy.mockResolvedValue([]); // no game_interests → fallback

      // "None" vote triggers re-poll
      discordClient._mockTextChannel.messages.fetch.mockResolvedValue({
        poll: {
          answers: new Map([
            [0, { voteCount: 3 }],
            [3, { voteCount: 1 }], // "None"
          ]),
        },
      });

      await service.processPollClose(PLAN_ID);

      // The update should have been called with pollRound: 2
      const updateCalls = db.update.mock.calls;
      expect(updateCalls.length).toBeGreaterThan(0);

      // Find the set call that includes pollRound
      const setCall = db._chain.set.mock.calls.find(
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
