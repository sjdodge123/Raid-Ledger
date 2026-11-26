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
import { SettingsService } from '../settings/settings.service';
import { Test, TestingModule } from '@nestjs/testing';
import { EventsAttendanceController } from './events-attendance.controller';
import { EventsService } from './events.service';
import { AttendanceService } from './attendance.service';
import { AdHocEventService } from '../discord-bot/services/ad-hoc-event.service';
import { VoiceAttendanceService } from '../discord-bot/services/voice-attendance.service';
import { AnalyticsService } from './analytics.service';
import { ChannelResolverService } from '../discord-bot/services/channel-resolver.service';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import type { AuthenticatedRequest, AuthenticatedUser } from '../auth/types';
import type { AdHocRosterResponseDto } from '@raid-ledger/contract';

function reqFor(
  id: number,
  role: AuthenticatedUser['role'],
): AuthenticatedRequest {
  return {
    user: {
      id,
      username: `user-${id}`,
      role,
      discordId: null,
      deactivatedAt: null,
      impersonatedBy: null,
      tokenVersion: 0,
    },
  };
}

/** The event creator (creator.id 1 in the fixtures) — gets the full detail. */
const OWNER = reqFor(1, 'member');
/** A signed-in member who neither created the event nor administers it. */
const VIEWER = reqFor(7, 'member');

/** The owner payload: today's rows plus `hasDiscord` (ROK-2323). */
function withFlag(r: AdHocRosterResponseDto): AdHocRosterResponseDto {
  return {
    ...r,
    participants: r.participants.map((p) => ({ ...p, hasDiscord: true })),
  };
}

const adHocRosterResponse: AdHocRosterResponseDto = {
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

const voiceRosterResponse: AdHocRosterResponseDto = {
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
      {
        provide: SettingsService,
        useValue: {
          getEphemeralVoiceEnabled: jest.fn().mockResolvedValue(false),
          getEphemeralVoiceForced: jest.fn().mockResolvedValue(false),
          getEphemeralVoiceCreateBufferMinutes: jest.fn().mockResolvedValue(30),
        },
      },
    ],
  }).compile();

  controller = module.get<EventsAttendanceController>(
    EventsAttendanceController,
  );
}

function testDelegatesToAdHocService() {
  mockEventsService.findOne.mockResolvedValue(buildAdHocEvent(1));
  return controller.getAdHocRoster(1, OWNER).then(() => {
    expect(mockAdHocEventService.getAdHocRoster).toHaveBeenCalledWith(1);
    expect(mockVoiceAttendanceService.getActiveRoster).not.toHaveBeenCalled();
  });
}

function testReturnsAdHocResult() {
  mockEventsService.findOne.mockResolvedValue(buildAdHocEvent(1));
  return controller
    .getAdHocRoster(1, OWNER)
    .then((result) => expect(result).toEqual(withFlag(adHocRosterResponse)));
}

function testNoVoiceCallForAdHoc() {
  mockEventsService.findOne.mockResolvedValue(buildAdHocEvent(1));
  return controller.getAdHocRoster(1, OWNER).then(() => {
    expect(mockVoiceAttendanceService.getActiveRoster).not.toHaveBeenCalled();
  });
}

function testDelegatesToVoiceService() {
  mockEventsService.findOne.mockResolvedValue(buildPlannedEvent(2));
  return controller.getAdHocRoster(2, OWNER).then(() => {
    expect(mockVoiceAttendanceService.getActiveRoster).toHaveBeenCalledWith(2);
    expect(mockAdHocEventService.getAdHocRoster).not.toHaveBeenCalled();
  });
}

function testReturnsVoiceResult() {
  mockEventsService.findOne.mockResolvedValue(buildPlannedEvent(2));
  return controller
    .getAdHocRoster(2, OWNER)
    .then((result) => expect(result).toEqual(withFlag(voiceRosterResponse)));
}

function testNoAdHocCallForPlanned() {
  mockEventsService.findOne.mockResolvedValue(buildPlannedEvent(2));
  return controller.getAdHocRoster(2, OWNER).then(() => {
    expect(mockAdHocEventService.getAdHocRoster).not.toHaveBeenCalled();
  });
}

async function testAdHocResponseShape() {
  mockEventsService.findOne.mockResolvedValue(buildAdHocEvent(1));
  const result = await controller.getAdHocRoster(1, OWNER);
  expect(result).toMatchObject({
    eventId: expect.any(Number),
    participants: expect.any(Array),
    activeCount: expect.any(Number),
  });
}

async function testPlannedResponseShape() {
  mockEventsService.findOne.mockResolvedValue(buildPlannedEvent(2));
  const result = await controller.getAdHocRoster(2, OWNER);
  expect(result).toMatchObject({
    eventId: expect.any(Number),
    participants: expect.any(Array),
    activeCount: expect.any(Number),
  });
}

async function testCallsFindOneFirst() {
  mockEventsService.findOne.mockResolvedValue(buildAdHocEvent(42));
  await controller.getAdHocRoster(42, OWNER);
  expect(mockEventsService.findOne).toHaveBeenCalledWith(42);
}

async function testPropagatesFindOneError() {
  const notFound = new Error('Event not found');
  mockEventsService.findOne.mockRejectedValue(notFound);
  await expect(controller.getAdHocRoster(999, OWNER)).rejects.toThrow(
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

// ── ROK-2323: viewer projection ───────────────────────────────

const anonSteamRoster: AdHocRosterResponseDto = {
  eventId: 1,
  participants: [
    {
      id: 'part-steam',
      eventId: 1,
      userId: null,
      discordUserId: null,
      steamId: '76561198000000001',
      playerId: '76561198000000001',
      idKind: 'steam',
      source: 'steam',
      onServer: true,
      discordUsername: '76561198000000001',
      discordAvatarHash: null,
      joinedAt: '2026-03-01T18:00:00Z',
      leftAt: null,
      totalDurationSeconds: 60,
      sessionCount: 1,
    },
  ],
  activeCount: 1,
};

const ID_KEYS = ['discordUserId', 'steamId', 'playerId', 'idKind'];

function idKeysOf(r: AdHocRosterResponseDto): string[] {
  return r.participants.flatMap((p) =>
    Object.keys(p).filter((k) => ID_KEYS.includes(k)),
  );
}

describe('getAdHocRoster — viewer projection (ROK-2323)', () => {
  it('a non-owner member gets no Discord / Steam / platform id keys', async () => {
    mockEventsService.findOne.mockResolvedValue(buildAdHocEvent(1));
    const result = await controller.getAdHocRoster(1, VIEWER);
    expect(idKeysOf(result)).toEqual([]);
    expect(result.participants[0]).toMatchObject({
      discordUsername: 'AdHocPlayer',
      hasDiscord: true,
      discordAvatarHash: null,
    });
  });

  it('a non-owner never sees a SteamID64 as an anonymous player name', async () => {
    mockEventsService.findOne.mockResolvedValue(buildAdHocEvent(1));
    mockAdHocEventService.getAdHocRoster.mockResolvedValue(anonSteamRoster);
    const result = await controller.getAdHocRoster(1, VIEWER);
    expect(JSON.stringify(result)).not.toContain('76561198000000001');
    expect(result.participants[0]).toMatchObject({
      discordUsername: 'Server player',
      hasDiscord: false,
    });
  });

  it('an admin who is not the creator keeps the full detail', async () => {
    mockEventsService.findOne.mockResolvedValue(buildAdHocEvent(1));
    mockAdHocEventService.getAdHocRoster.mockResolvedValue(anonSteamRoster);
    const result = await controller.getAdHocRoster(1, reqFor(9, 'admin'));
    expect(result.participants[0]).toMatchObject({
      steamId: '76561198000000001',
      discordUsername: '76561198000000001',
      hasDiscord: false,
    });
  });

  it('the planned-event voice roster is projected for a non-owner too', async () => {
    mockEventsService.findOne.mockResolvedValue(buildPlannedEvent(2));
    mockVoiceAttendanceService.getActiveRoster.mockReturnValue({
      ...voiceRosterResponse,
      participants: voiceRosterResponse.participants.map((p) => ({
        ...p,
        userId: null,
      })),
    });
    const result = await controller.getAdHocRoster(2, VIEWER);
    expect(idKeysOf(result)).toEqual([]);
    // The live voice roster keys rows by the Discord id — not on the wire.
    expect(JSON.stringify(result)).not.toContain('discord-planned');
  });

  it('a linked voice row keeps its Discord id for the avatar (already public to members)', async () => {
    mockEventsService.findOne.mockResolvedValue(buildPlannedEvent(2));
    const result = await controller.getAdHocRoster(2, VIEWER);
    expect(idKeysOf(result)).toEqual(['discordUserId']);
    expect(result.participants[0]).toMatchObject({
      userId: 42,
      discordUserId: 'discord-planned',
    });
    expect(result.participants[0]?.id).not.toBe('discord-planned');
  });
});
