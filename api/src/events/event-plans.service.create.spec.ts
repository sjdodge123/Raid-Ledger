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

let service: EventPlansService;
let db: MockDb;
let discordClient: ReturnType<typeof makeDiscordMock>;
let queue: ReturnType<typeof makeQueueMock>;
let channelResolver: { resolveChannelForEvent: jest.Mock };
let settingsService: { getDefaultTimezone: jest.Mock };

async function setupEach() {
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
  resetMocks();
}

function resetMocks() {
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
}

const validDto = {
  title: 'Raid Night',
  durationMinutes: 120,
  pollOptions: baseOptions,
  pollDurationHours: 24,
  pollMode: 'standard' as const,
};

// ─── create tests ───────────────────────────────────────────────────────────

async function testCreateNoChannel() {
  channelResolver.resolveChannelForEvent.mockResolvedValue(null);
  await expect(service.create(CREATOR_ID, validDto)).rejects.toThrow(
    BadRequestException,
  );
}

async function testCreateInsertAndPost() {
  const result = await service.create(CREATOR_ID, validDto);
  expect(db.insert).toHaveBeenCalled();
  expect(discordClient._mockTextChannel.send).toHaveBeenCalled();
  expect(result).toBeDefined();
  expect(result.title).toBe('Raid Night');
}

async function testCreateSchedulesJob() {
  await service.create(CREATOR_ID, validDto);
  expect(queue.add).toHaveBeenCalledWith(
    'poll-closed',
    { planId: expect.any(String) as string },
    expect.objectContaining({
      delay: validDto.pollDurationHours * 3600 * 1000,
      attempts: 3,
    }),
  );
}

async function testCreateDiscordFails() {
  discordClient._mockTextChannel.send.mockRejectedValue(
    new Error('No permission'),
  );
  await expect(service.create(CREATOR_ID, validDto)).rejects.toThrow(
    BadRequestException,
  );
  expect(db.update).toHaveBeenCalled();
}

async function testCreateNoneOption() {
  await service.create(CREATOR_ID, validDto);
  const sendCall = (
    discordClient._mockTextChannel.send.mock.calls[1] as unknown[]
  )[0] as { poll: { answers: Array<{ text: string }> } };
  const lastAnswer = sendCall.poll.answers[sendCall.poll.answers.length - 1];
  expect(lastAnswer.text).toBe('None of these work');
}

async function testCreateNoRepollContent() {
  await service.create(CREATOR_ID, validDto);
  const sendCall = (
    discordClient._mockTextChannel.send.mock.calls[1] as unknown[]
  )[0] as { content?: string };
  expect(sendCall.content).toBeUndefined();
}

// ─── findOne tests ──────────────────────────────────────────────────────────

async function testFindOneReturns() {
  db.limit.mockResolvedValue([makePlan()]);
  const result = await service.findOne(PLAN_ID);
  expect(result.id).toBe(PLAN_ID);
  expect(result.status).toBe('polling');
}

async function testFindOneNotFound() {
  db.limit.mockResolvedValue([]);
  await expect(service.findOne('non-existent-id')).rejects.toThrow(
    NotFoundException,
  );
}

// ─── findAll tests ──────────────────────────────────────────────────────────

async function testFindAllReturnsArray() {
  db.orderBy.mockResolvedValue([makePlan(), makePlan()]);
  const results = await service.findAll();
  expect(Array.isArray(results)).toBe(true);
  expect(results).toHaveLength(2);
}

async function testFindAllEmpty() {
  db.orderBy.mockResolvedValue([]);
  const results = await service.findAll();
  expect(results).toEqual([]);
}

// ─── cancel tests ───────────────────────────────────────────────────────────

async function testCancelNotFound() {
  db.limit.mockResolvedValue([]);
  await expect(service.cancel(PLAN_ID, CREATOR_ID)).rejects.toThrow(
    NotFoundException,
  );
}

async function testCancelForbidden() {
  db.limit.mockResolvedValue([makePlan()]);
  await expect(service.cancel(PLAN_ID, CREATOR_ID + 1)).rejects.toThrow(
    ForbiddenException,
  );
}

async function testCancelWrongStatus() {
  db.limit.mockResolvedValue([makePlan({ status: 'completed' })]);
  await expect(service.cancel(PLAN_ID, CREATOR_ID)).rejects.toThrow(
    BadRequestException,
  );
}

async function testCancelAlreadyCancelled() {
  db.limit.mockResolvedValue([makePlan({ status: 'cancelled' })]);
  await expect(service.cancel(PLAN_ID, CREATOR_ID)).rejects.toThrow(
    BadRequestException,
  );
}

async function testCancelDeletesMessage() {
  db.limit.mockResolvedValue([makePlan()]);
  db.returning.mockResolvedValue([makePlan({ status: 'cancelled' })]);
  await service.cancel(PLAN_ID, CREATOR_ID);
  expect(discordClient.deleteMessage).toHaveBeenCalledWith(
    CHANNEL_ID,
    MESSAGE_ID,
  );
}

async function testCancelRemovesJob() {
  db.limit.mockResolvedValue([makePlan()]);
  db.returning.mockResolvedValue([makePlan({ status: 'cancelled' })]);
  await service.cancel(PLAN_ID, CREATOR_ID);
  expect(queue.getJob).toHaveBeenCalledWith(`plan-poll-close-${PLAN_ID}`);
  expect(queue._mockJob.remove).toHaveBeenCalled();
}

async function testCancelUpdatesStatus() {
  db.limit.mockResolvedValue([makePlan()]);
  db.returning.mockResolvedValue([makePlan({ status: 'cancelled' })]);
  const result = await service.cancel(PLAN_ID, CREATOR_ID);
  expect(result.status).toBe('cancelled');
  expect(db.update).toHaveBeenCalled();
}

async function testCancelProceedsOnDiscordError() {
  db.limit.mockResolvedValue([makePlan()]);
  db.returning.mockResolvedValue([makePlan({ status: 'cancelled' })]);
  discordClient.deleteMessage.mockRejectedValue(new Error('Message gone'));
  await expect(service.cancel(PLAN_ID, CREATOR_ID)).resolves.toBeDefined();
}

// ─── getTimeSuggestions tests ───────────────────────────────────────────────

async function testTimeSuggestionsFallback() {
  const result = await service.getTimeSuggestions();
  expect(result.source).toBe('fallback');
  expect(result.interestedPlayerCount).toBe(0);
  expect(Array.isArray(result.suggestions)).toBe(true);
}

async function testTimeSuggestionsNoInterests() {
  db.where.mockResolvedValue([]);
  const result = await service.getTimeSuggestions(1);
  expect(result.source).toBe('fallback');
}

async function testTimeSuggestionsEveningHours() {
  const result = await service.getTimeSuggestions();
  const eveningHours = [18, 19, 20, 21];
  result.suggestions.forEach((s) => {
    expect(eveningHours).toContain(new Date(s.date).getHours());
  });
}

async function testTimeSuggestionsZeroCounts() {
  const result = await service.getTimeSuggestions();
  result.suggestions.forEach((s) => expect(s.availableCount).toBe(0));
}

async function testTimeSuggestionsMaxCount() {
  const result = await service.getTimeSuggestions();
  expect(result.suggestions.length).toBeLessThanOrEqual(28);
  expect(result.suggestions.length).toBeGreaterThan(0);
}

async function testTimeSuggestionsGameInterest() {
  db.where.mockResolvedValueOnce([{ userId: 1 }, { userId: 2 }]);
  db.where.mockResolvedValueOnce([
    { dayOfWeek: 0, startHour: 18 },
    { dayOfWeek: 0, startHour: 18 },
    { dayOfWeek: 1, startHour: 19 },
  ]);
  const result = await service.getTimeSuggestions(5);
  expect(result.source).toBe('game-interest');
  expect(result.interestedPlayerCount).toBe(2);
}

async function testTimeSuggestionsAfterDate() {
  const futureDate = new Date(Date.now() + 10 * 24 * 3600 * 1000);
  const result = await service.getTimeSuggestions(
    undefined,
    0,
    futureDate.toISOString(),
  );
  result.suggestions.forEach((s) => {
    expect(new Date(s.date).getTime()).toBeGreaterThan(futureDate.getTime());
  });
}

beforeEach(() => setupEach());

describe('EventPlansService — create', () => {
  it('should throw when no channel resolved', () => testCreateNoChannel());
  it('should insert plan and post Discord poll', () =>
    testCreateInsertAndPost());
  it('should schedule BullMQ job', () => testCreateSchedulesJob());
  it('should mark draft if Discord fails', () => testCreateDiscordFails());
  it('should include "None" in poll answers', () => testCreateNoneOption());
  it('should not include re-poll content for round 1', () =>
    testCreateNoRepollContent());
});

describe('EventPlansService — findOne', () => {
  it('should return plan DTO when found', () => testFindOneReturns());
  it('should throw NotFoundException when missing', () =>
    testFindOneNotFound());
});

describe('EventPlansService — findAll', () => {
  it('should return array of plans', () => testFindAllReturnsArray());
  it('should return empty array when none exist', () => testFindAllEmpty());
});

describe('EventPlansService — cancel', () => {
  it('should throw NotFoundException when missing', () => testCancelNotFound());
  it('should throw ForbiddenException for non-creator', () =>
    testCancelForbidden());
  it('should throw for non-polling status', () => testCancelWrongStatus());
  it('should throw for already cancelled', () => testCancelAlreadyCancelled());
  it('should delete Discord poll message', () => testCancelDeletesMessage());
  it('should remove queued BullMQ job', () => testCancelRemovesJob());
  it('should update status to cancelled', () => testCancelUpdatesStatus());
  it('should proceed on Discord delete error', () =>
    testCancelProceedsOnDiscordError());
});

describe('EventPlansService — getTimeSuggestions', () => {
  it('should return fallback when no gameId', () =>
    testTimeSuggestionsFallback());
  it('should return fallback when no game interests', () =>
    testTimeSuggestionsNoInterests());
  it('should generate evening hour suggestions', () =>
    testTimeSuggestionsEveningHours());
  it('should have availableCount of 0 for fallback', () =>
    testTimeSuggestionsZeroCounts());
  it('should generate up to 28 suggestions', () =>
    testTimeSuggestionsMaxCount());
  it('should use game-interest source when data exists', () =>
    testTimeSuggestionsGameInterest());
  it('should respect afterDate parameter', () =>
    testTimeSuggestionsAfterDate());
});
