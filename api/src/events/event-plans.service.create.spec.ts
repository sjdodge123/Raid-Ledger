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
      fetch: jest.fn().mockResolvedValue({ poll: { answers: new Map() } }),
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

describe('EventPlansService — create, findOne, findAll, cancel', () => {
  let service: EventPlansService;
  let db: MockDb;
  let discordClient: ReturnType<typeof makeDiscordMock>;
  let queue: ReturnType<typeof makeQueueMock>;
  let channelResolver: { resolveChannelForEvent: jest.Mock };
  let settingsService: { getDefaultTimezone: jest.Mock };

  beforeEach(async () => {
    db = makeDbMock();
    discordClient = makeDiscordMock();
    queue = makeQueueMock();
    channelResolver = {
      resolveChannelForEvent: jest.fn().mockResolvedValue(CHANNEL_ID),
    };
    settingsService = { getDefaultTimezone: jest.fn().mockResolvedValue(null) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventPlansService,
        { provide: DrizzleAsyncProvider, useValue: db },
        { provide: getQueueToken(EVENT_PLANS_QUEUE), useValue: queue },
        { provide: DiscordBotClientService, useValue: discordClient },
        { provide: ChannelResolverService, useValue: channelResolver },
        { provide: SettingsService, useValue: settingsService },
        {
          provide: EventsService,
          useValue: { create: jest.fn().mockResolvedValue({ id: 99 }) },
        },
        {
          provide: SignupsService,
          useValue: { signup: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get<EventPlansService>(EventPlansService);
    jest.clearAllMocks();

    settingsService.getDefaultTimezone.mockResolvedValue(null);
    channelResolver.resolveChannelForEvent.mockResolvedValue(CHANNEL_ID);
    discordClient.getClient.mockReturnValue(discordClient._mockClient);
    discordClient._mockClient.isReady.mockReturnValue(true);
    discordClient._mockClient.channels.fetch.mockResolvedValue(
      discordClient._mockTextChannel,
    );
    discordClient._mockTextChannel.send.mockResolvedValue({ id: MESSAGE_ID });
    discordClient.deleteMessage.mockResolvedValue(undefined);
    queue.add.mockResolvedValue(undefined);
    queue.getJob.mockResolvedValue(queue._mockJob);
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
      await service.create(CREATOR_ID, validDto);
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

  // ─── findAll ────────────────────────────────────────────────────────────────

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
      await expect(service.cancel(PLAN_ID, CREATOR_ID + 1)).rejects.toThrow(
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
      await expect(service.cancel(PLAN_ID, CREATOR_ID)).resolves.toBeDefined();
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
      db.where.mockResolvedValue([]);
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
      expect(result.suggestions.length).toBeLessThanOrEqual(28);
      expect(result.suggestions.length).toBeGreaterThan(0);
    });

    it('should return game-interest source when game interests and templates exist', async () => {
      db.where.mockResolvedValueOnce([{ userId: 1 }, { userId: 2 }]);
      db.where.mockResolvedValueOnce([
        { dayOfWeek: 0, startHour: 18 },
        { dayOfWeek: 0, startHour: 18 },
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
});
