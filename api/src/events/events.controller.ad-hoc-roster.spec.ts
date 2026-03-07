/**
 * events.controller.ad-hoc-roster.spec.ts
 *
 * Adversarial tests for ROK-530: EventsAttendanceController.getAdHocRoster()
 *
 * Focus areas:
 *  1. Ad-hoc events delegate to AdHocEventService.getAdHocRoster()
 *  2. Non-ad-hoc (scheduled) events delegate to VoiceAttendanceService.getActiveRoster()
 *  3. Response shape is consistent regardless of delegation path
 *  4. VoiceAttendanceService.getActiveRoster() result is returned directly for planned events
 */
import { Test, TestingModule } from '@nestjs/testing';
import { EventsAttendanceController } from './events-attendance.controller';
import { EventsService } from './events.service';
import { AttendanceService } from './attendance.service';
import { AdHocEventService } from '../discord-bot/services/ad-hoc-event.service';
import { VoiceAttendanceService } from '../discord-bot/services/voice-attendance.service';
import { AnalyticsService } from './analytics.service';
import { ChannelResolverService } from '../discord-bot/services/channel-resolver.service';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';

const adHocRosterResponse = {
  eventId: 1,
  participants: [
    {
      id: 'part-1',
      eventId: 1,
      userId: null,
      discordUserId: 'discord-adhoc',
      discordUsername: 'AdHocPlayer',
      discordAvatarHash: 'hash123',
      joinedAt: '2026-03-01T18:00:00Z',
      leftAt: null,
      totalDurationSeconds: 300,
      sessionCount: 1,
    },
  ],
  activeCount: 1,
};

const voiceRosterResponse = {
  eventId: 2,
  participants: [
    {
      id: 'discord-planned',
      eventId: 2,
      userId: 42,
      discordUserId: 'discord-planned',
      discordUsername: 'PlannedPlayer',
      discordAvatarHash: null,
      joinedAt: '2026-03-01T20:00:00Z',
      leftAt: null,
      totalDurationSeconds: 600,
      sessionCount: 1,
    },
  ],
  activeCount: 1,
};

let controller: EventsAttendanceController;
let mockEventsService: { findOne: jest.Mock };
let mockAdHocEventService: { getAdHocRoster: jest.Mock };
let mockVoiceAttendanceService: { getActiveRoster: jest.Mock };

function buildAdHocEvent(id = 1) {
  return {
    id,
    title: 'Ad-Hoc Event',
    isAdHoc: true,
    creator: { id: 1, username: 'creator', avatar: null },
  };
}

function buildPlannedEvent(id = 2) {
  return {
    id,
    title: 'Planned Event',
    isAdHoc: false,
    creator: { id: 1, username: 'creator', avatar: null },
  };
}

async function setupEach() {
  mockEventsService = { findOne: jest.fn() };
  mockAdHocEventService = {
    getAdHocRoster: jest.fn().mockResolvedValue(adHocRosterResponse),
  };
  mockVoiceAttendanceService = {
    getActiveRoster: jest.fn().mockReturnValue(voiceRosterResponse),
  };

  const module: TestingModule = await Test.createTestingModule({
    controllers: [EventsAttendanceController],
    providers: [
      { provide: EventsService, useValue: mockEventsService },
      {
        provide: AttendanceService,
        useValue: {
          recordAttendance: jest.fn(),
          getAttendanceSummary: jest.fn(),
        },
      },
      { provide: AdHocEventService, useValue: mockAdHocEventService },
      {
        provide: VoiceAttendanceService,
        useValue: mockVoiceAttendanceService,
      },
      {
        provide: AnalyticsService,
        useValue: { getEventMetrics: jest.fn() },
      },
      {
        provide: ChannelResolverService,
        useValue: { resolveVoiceChannelForScheduledEvent: jest.fn() },
      },
      {
        provide: DiscordBotClientService,
        useValue: { getGuildId: jest.fn(), getClient: jest.fn() },
      },
    ],
  }).compile();

  controller = module.get<EventsAttendanceController>(
    EventsAttendanceController,
  );
}

function testDelegatesToAdHocService() {
  mockEventsService.findOne.mockResolvedValue(buildAdHocEvent(1));
  return controller.getAdHocRoster(1).then(() => {
    expect(mockAdHocEventService.getAdHocRoster).toHaveBeenCalledWith(1);
    expect(mockVoiceAttendanceService.getActiveRoster).not.toHaveBeenCalled();
  });
}

function testReturnsAdHocResult() {
  mockEventsService.findOne.mockResolvedValue(buildAdHocEvent(1));
  return controller
    .getAdHocRoster(1)
    .then((result) => expect(result).toEqual(adHocRosterResponse));
}

function testNoVoiceCallForAdHoc() {
  mockEventsService.findOne.mockResolvedValue(buildAdHocEvent(1));
  return controller.getAdHocRoster(1).then(() => {
    expect(mockVoiceAttendanceService.getActiveRoster).not.toHaveBeenCalled();
  });
}

function testDelegatesToVoiceService() {
  mockEventsService.findOne.mockResolvedValue(buildPlannedEvent(2));
  return controller.getAdHocRoster(2).then(() => {
    expect(mockVoiceAttendanceService.getActiveRoster).toHaveBeenCalledWith(2);
    expect(mockAdHocEventService.getAdHocRoster).not.toHaveBeenCalled();
  });
}

function testReturnsVoiceResult() {
  mockEventsService.findOne.mockResolvedValue(buildPlannedEvent(2));
  return controller
    .getAdHocRoster(2)
    .then((result) => expect(result).toEqual(voiceRosterResponse));
}

function testNoAdHocCallForPlanned() {
  mockEventsService.findOne.mockResolvedValue(buildPlannedEvent(2));
  return controller.getAdHocRoster(2).then(() => {
    expect(mockAdHocEventService.getAdHocRoster).not.toHaveBeenCalled();
  });
}

async function testAdHocResponseShape() {
  mockEventsService.findOne.mockResolvedValue(buildAdHocEvent(1));
  const result = await controller.getAdHocRoster(1);
  expect(result).toMatchObject({
    eventId: expect.any(Number),
    participants: expect.any(Array),
    activeCount: expect.any(Number),
  });
}

async function testPlannedResponseShape() {
  mockEventsService.findOne.mockResolvedValue(buildPlannedEvent(2));
  const result = await controller.getAdHocRoster(2);
  expect(result).toMatchObject({
    eventId: expect.any(Number),
    participants: expect.any(Array),
    activeCount: expect.any(Number),
  });
}

async function testCallsFindOneFirst() {
  mockEventsService.findOne.mockResolvedValue(buildAdHocEvent(42));
  await controller.getAdHocRoster(42);
  expect(mockEventsService.findOne).toHaveBeenCalledWith(42);
}

async function testPropagatesFindOneError() {
  const notFound = new Error('Event not found');
  mockEventsService.findOne.mockRejectedValue(notFound);
  await expect(controller.getAdHocRoster(999)).rejects.toThrow(
    'Event not found',
  );
  expect(mockAdHocEventService.getAdHocRoster).not.toHaveBeenCalled();
  expect(mockVoiceAttendanceService.getActiveRoster).not.toHaveBeenCalled();
}

beforeEach(() => setupEach());

describe('getAdHocRoster — ad-hoc delegation', () => {
  it('delegates to AdHocEventService for ad-hoc events', () =>
    testDelegatesToAdHocService());
  it('returns AdHocEventService result for ad-hoc events', () =>
    testReturnsAdHocResult());
  it('does NOT call VoiceAttendanceService for ad-hoc events', () =>
    testNoVoiceCallForAdHoc());
});

describe('getAdHocRoster — planned delegation', () => {
  it('delegates to VoiceAttendanceService for planned events', () =>
    testDelegatesToVoiceService());
  it('returns VoiceAttendanceService result for planned events', () =>
    testReturnsVoiceResult());
  it('does NOT call AdHocEventService for planned events', () =>
    testNoAdHocCallForPlanned());
});

describe('getAdHocRoster — response shape', () => {
  it('returns correct shape for ad-hoc events', () => testAdHocResponseShape());
  it('returns correct shape for planned events', () =>
    testPlannedResponseShape());
});

describe('getAdHocRoster — findOne guard', () => {
  it('calls eventsService.findOne before delegating', () =>
    testCallsFindOneFirst());
  it('propagates error if findOne throws', () => testPropagatesFindOneError());
});
