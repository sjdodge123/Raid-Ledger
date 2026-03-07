import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { EventsController } from './events.controller';
import { EventsSignupsController } from './events-signups.controller';
import { EventsAttendanceController } from './events-attendance.controller';
import { EventsService } from './events.service';
import { SignupsService } from './signups.service';
import { AttendanceService } from './attendance.service';
import { PugsService } from './pugs.service';
import { ShareService } from './share.service';
import { AdHocEventService } from '../discord-bot/services/ad-hoc-event.service';
import { VoiceAttendanceService } from '../discord-bot/services/voice-attendance.service';
import { AnalyticsService } from './analytics.service';
import { ChannelResolverService } from '../discord-bot/services/channel-resolver.service';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';

import type { UserRole } from '@raid-ledger/contract';

interface AuthenticatedRequest {
  user: { id: number; role: UserRole };
}

let controller: EventsController;
let signupsController: EventsSignupsController;
let attendanceController: EventsAttendanceController;
let mockEventsService: Partial<EventsService>;
let mockSignupsService: Partial<SignupsService>;
let mockPugsService: Partial<PugsService>;

const mockEvent = {
  id: 1,
  title: 'Test Event',
  description: 'Description',
  startTime: '2026-02-10T18:00:00.000Z',
  endTime: '2026-02-10T20:00:00.000Z',
  creator: {
    id: 1,
    discordId: '123456789',
    username: 'testuser',
    avatar: null,
  },
  game: null,
  createdAt: '2026-02-01T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z',
};

const mockSignup = {
  id: 1,
  eventId: 1,
  user: { id: 1, discordId: '123456789', username: 'testuser', avatar: null },
  note: null,
  signedUpAt: '2026-02-01T00:00:00.000Z',
};

const mockUser = { id: 1, role: 'member' as UserRole };

function buildMockEventsService(): Partial<EventsService> {
  return {
    create: jest.fn().mockResolvedValue(mockEvent),
    findAll: jest.fn().mockResolvedValue({
      data: [mockEvent],
      meta: { total: 1, page: 1, limit: 20, totalPages: 1, hasMore: false },
    }),
    findOne: jest.fn().mockResolvedValue(mockEvent),
    update: jest.fn().mockResolvedValue(mockEvent),
    delete: jest.fn().mockResolvedValue(undefined),
  };
}

function buildMockSignupsService(): Partial<SignupsService> {
  return {
    signup: jest.fn().mockResolvedValue(mockSignup),
    cancel: jest.fn().mockResolvedValue(undefined),
    getRoster: jest
      .fn()
      .mockResolvedValue({ eventId: 1, signups: [mockSignup], count: 1 }),
  };
}

function buildAttendanceProvider() {
  return {
    provide: AttendanceService,
    useValue: {
      recordAttendance: jest.fn().mockResolvedValue({}),
      getAttendanceSummary: jest.fn().mockResolvedValue({
        eventId: 1,
        totalSignups: 0,
        attended: 0,
        noShow: 0,
        excused: 0,
        unmarked: 0,
        attendanceRate: 0,
        noShowRate: 0,
        signups: [],
      }),
    },
  };
}

function buildVoiceProvider() {
  return {
    provide: VoiceAttendanceService,
    useValue: {
      getVoiceSessions: jest.fn().mockResolvedValue({
        eventId: 1,
        sessions: [],
      }),
      getVoiceAttendanceSummary: jest.fn().mockResolvedValue({
        eventId: 1,
        totalTracked: 0,
        full: 0,
        partial: 0,
        late: 0,
        earlyLeaver: 0,
        noShow: 0,
        unclassified: 0,
        sessions: [],
      }),
    },
  };
}

async function setupEach() {
  mockEventsService = buildMockEventsService();
  mockSignupsService = buildMockSignupsService();
  mockPugsService = {
    create: jest.fn().mockResolvedValue({}),
    findAll: jest.fn().mockResolvedValue({ pugs: [] }),
    update: jest.fn().mockResolvedValue({}),
    remove: jest.fn().mockResolvedValue(undefined),
  };

  const module: TestingModule = await Test.createTestingModule({
    controllers: [
      EventsController,
      EventsSignupsController,
      EventsAttendanceController,
    ],
    providers: [
      { provide: EventsService, useValue: mockEventsService },
      { provide: SignupsService, useValue: mockSignupsService },
      buildAttendanceProvider(),
      { provide: PugsService, useValue: mockPugsService },
      {
        provide: ShareService,
        useValue: {
          shareToDiscordChannels: jest
            .fn()
            .mockResolvedValue({ channelsPosted: 0, channelsSkipped: 0 }),
        },
      },
      {
        provide: AdHocEventService,
        useValue: {
          getAdHocRoster: jest.fn().mockResolvedValue({
            eventId: 1,
            participants: [],
            activeCount: 0,
          }),
        },
      },
      {
        provide: AnalyticsService,
        useValue: { getEventMetrics: jest.fn().mockResolvedValue({}) },
      },
      buildVoiceProvider(),
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

  controller = module.get<EventsController>(EventsController);
  signupsController = module.get<EventsSignupsController>(
    EventsSignupsController,
  );
  attendanceController = module.get<EventsAttendanceController>(
    EventsAttendanceController,
  );
}

// ─── create ─────────────────────────────────────────────────────────────────

async function testCreateValid() {
  const body = {
    title: 'New Event',
    startTime: '2026-02-10T18:00:00.000Z',
    endTime: '2026-02-10T20:00:00.000Z',
  };
  const result = await controller.create(
    { user: mockUser } as AuthenticatedRequest,
    body,
  );
  expect(result).toMatchObject({ id: expect.any(Number) });
  expect(mockEventsService.create).toHaveBeenCalledWith(
    mockUser.id,
    expect.any(Object),
  );
}

async function testCreateAutoSignup() {
  const body = {
    title: 'New Event',
    startTime: '2026-02-10T18:00:00.000Z',
    endTime: '2026-02-10T20:00:00.000Z',
  };
  await controller.create({ user: mockUser } as AuthenticatedRequest, body);
  expect(mockSignupsService.signup).toHaveBeenCalledWith(
    mockEvent.id,
    mockUser.id,
  );
}

async function testCreateInvalid() {
  await expect(
    controller.create({ user: mockUser } as AuthenticatedRequest, {
      title: '',
    }),
  ).rejects.toThrow(BadRequestException);
}

async function testCreateEndBeforeStart() {
  const body = {
    title: 'Event',
    startTime: '2026-02-10T20:00:00.000Z',
    endTime: '2026-02-10T18:00:00.000Z',
  };
  await expect(
    controller.create({ user: mockUser } as AuthenticatedRequest, body),
  ).rejects.toThrow(BadRequestException);
}

// ─── findAll ────────────────────────────────────────────────────────────────

const mockReq = { user: undefined } as {
  user?: { id: number; role: UserRole };
};
const authedReq = { user: { id: 1, role: 'member' as UserRole } };

async function testFindAllPaginated() {
  const result = await controller.findAll({}, mockReq);
  expect(result.data).toHaveLength(1);
  expect(result.meta.total).toBe(1);
}

async function testFindAllQueryParams() {
  await controller.findAll(
    { page: '2', limit: '10', upcoming: 'true' },
    mockReq,
  );
  expect(mockEventsService.findAll).toHaveBeenCalledWith(
    expect.objectContaining({ page: 2, limit: 10, upcoming: 'true' }),
    undefined,
  );
}

async function testFindAllAuthUserId() {
  await controller.findAll({}, authedReq);
  expect(mockEventsService.findAll).toHaveBeenCalledWith(expect.any(Object), 1);
}

// ─── findAll date range (ROK-174) ───────────────────────────────────────────

async function testDateRangeStartAfter() {
  await controller.findAll({ startAfter: '2026-02-01T00:00:00.000Z' }, mockReq);
  expect(mockEventsService.findAll).toHaveBeenCalledWith(
    expect.objectContaining({ startAfter: '2026-02-01T00:00:00.000Z' }),
    undefined,
  );
}

async function testDateRangeEndBefore() {
  await controller.findAll({ endBefore: '2026-02-28T23:59:59.000Z' }, mockReq);
  expect(mockEventsService.findAll).toHaveBeenCalledWith(
    expect.objectContaining({ endBefore: '2026-02-28T23:59:59.000Z' }),
    undefined,
  );
}

async function testDateRangeBoth() {
  const startAfter = '2026-02-01T00:00:00.000Z';
  const endBefore = '2026-02-28T23:59:59.000Z';
  await controller.findAll({ startAfter, endBefore }, mockReq);
  expect(mockEventsService.findAll).toHaveBeenCalledWith(
    expect.objectContaining({ startAfter, endBefore }),
    undefined,
  );
}

async function testDateRangeGameId() {
  await controller.findAll({ gameId: '123' }, mockReq);
  expect(mockEventsService.findAll).toHaveBeenCalledWith(
    expect.objectContaining({ gameId: '123' }),
    undefined,
  );
}

async function testDateRangeCombined() {
  const query = {
    startAfter: '2026-02-01T00:00:00.000Z',
    endBefore: '2026-02-28T23:59:59.000Z',
    gameId: '123',
    upcoming: 'true',
    page: '1',
    limit: '50',
  };
  await controller.findAll(query, mockReq);
  expect(mockEventsService.findAll).toHaveBeenCalledWith(
    expect.objectContaining({
      startAfter: '2026-02-01T00:00:00.000Z',
      endBefore: '2026-02-28T23:59:59.000Z',
      gameId: '123',
      upcoming: 'true',
      page: 1,
      limit: 50,
    }),
    undefined,
  );
}

async function testDateRangeInvalidStartAfter() {
  await expect(
    controller.findAll({ startAfter: 'not-a-date' }, mockReq),
  ).rejects.toThrow(BadRequestException);
}

async function testDateRangeInvalidEndBefore() {
  await expect(
    controller.findAll({ endBefore: 'invalid-date' }, mockReq),
  ).rejects.toThrow(BadRequestException);
}

async function testDateRangeStartAfterEnd() {
  await expect(
    controller.findAll(
      {
        startAfter: '2026-02-28T00:00:00.000Z',
        endBefore: '2026-02-01T00:00:00.000Z',
      },
      mockReq,
    ),
  ).rejects.toThrow(BadRequestException);
}

// ─── findOne / update / delete ──────────────────────────────────────────────

async function testFindOne() {
  const result = await controller.findOne(1);
  expect(result).toMatchObject({ id: expect.any(Number) });
  expect(mockEventsService.findOne).toHaveBeenCalledWith(1);
}

async function testUpdate() {
  const result = await controller.update(
    1,
    { user: mockUser } as AuthenticatedRequest,
    { title: 'Updated Title' },
  );
  expect(result).toMatchObject({ id: expect.any(Number) });
  expect(mockEventsService.update).toHaveBeenCalledWith(
    1,
    mockUser.id,
    false,
    expect.any(Object),
  );
}

async function testDelete() {
  const result = await controller.delete(1, {
    user: mockUser,
  } as AuthenticatedRequest);
  expect(result.message).toBe('Event deleted successfully');
  expect(mockEventsService.delete).toHaveBeenCalledWith(1, mockUser.id, false);
}

// ─── confirmSignup (ROK-131) ────────────────────────────────────────────────

const validCharacterId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const mockConfirmedSignup = {
  ...mockSignup,
  characterId: validCharacterId,
  character: {
    id: validCharacterId,
    name: 'Frostweaver',
    class: 'Mage',
    spec: 'Arcane',
    role: 'dps',
    isMain: true,
    itemLevel: 485,
    avatarUrl: null,
  },
  confirmationStatus: 'confirmed',
};

function setupConfirmSignup() {
  mockSignupsService.confirmSignup = jest
    .fn()
    .mockResolvedValue(mockConfirmedSignup);
}

async function testConfirmSignupValid() {
  setupConfirmSignup();
  const result = await signupsController.confirmSignup(
    1,
    1,
    { user: mockUser } as AuthenticatedRequest,
    { characterId: validCharacterId },
  );
  expect(result.characterId).toBe(validCharacterId);
  expect(result.confirmationStatus).toBe('confirmed');
  expect(mockSignupsService.confirmSignup).toHaveBeenCalledWith(
    1,
    1,
    mockUser.id,
    expect.objectContaining({ characterId: validCharacterId }),
  );
}

async function testConfirmSignupInvalidId() {
  setupConfirmSignup();
  await expect(
    signupsController.confirmSignup(
      1,
      1,
      { user: mockUser } as AuthenticatedRequest,
      { characterId: 'not-a-uuid' },
    ),
  ).rejects.toThrow(BadRequestException);
}

async function testConfirmSignupMissing() {
  setupConfirmSignup();
  await expect(
    signupsController.confirmSignup(
      1,
      1,
      { user: mockUser } as AuthenticatedRequest,
      {},
    ),
  ).rejects.toThrow(BadRequestException);
}

// ─── Voice session ACL (ROK-490) ────────────────────────────────────────────

const creatorReq = {
  user: { id: 1, role: 'member' as UserRole },
} as AuthenticatedRequest;
const nonCreatorReq = {
  user: { id: 99, role: 'member' as UserRole },
} as AuthenticatedRequest;
const operatorReq = {
  user: { id: 99, role: 'operator' as UserRole },
} as AuthenticatedRequest;
const adminReq = {
  user: { id: 99, role: 'admin' as UserRole },
} as AuthenticatedRequest;

async function testVoiceSessionsCreator() {
  const result = await attendanceController.getVoiceSessions(1, creatorReq);
  expect(result).toMatchObject({ eventId: 1 });
}

async function testVoiceSessionsOperator() {
  const result = await attendanceController.getVoiceSessions(1, operatorReq);
  expect(result).toMatchObject({ eventId: 1 });
}

async function testVoiceSessionsAdmin() {
  const result = await attendanceController.getVoiceSessions(1, adminReq);
  expect(result).toMatchObject({ eventId: 1 });
}

async function testVoiceSessionsForbidden() {
  await expect(
    attendanceController.getVoiceSessions(1, nonCreatorReq),
  ).rejects.toThrow(ForbiddenException);
}

async function testVoiceAttendanceCreator() {
  const result = await attendanceController.getVoiceAttendance(1, creatorReq);
  expect(result).toMatchObject({ eventId: 1 });
}

async function testVoiceAttendanceOperator() {
  const result = await attendanceController.getVoiceAttendance(1, operatorReq);
  expect(result).toMatchObject({ eventId: 1 });
}

async function testVoiceAttendanceAdmin() {
  const result = await attendanceController.getVoiceAttendance(1, adminReq);
  expect(result).toMatchObject({ eventId: 1 });
}

async function testVoiceAttendanceForbidden() {
  await expect(
    attendanceController.getVoiceAttendance(1, nonCreatorReq),
  ).rejects.toThrow(ForbiddenException);
}

// ─── getRosterAvailability (ROK-113) ────────────────────────────────────────

const mockRosterAvailability = {
  eventId: 1,
  timeRange: {
    start: '2026-02-10T16:00:00.000Z',
    end: '2026-02-10T22:00:00.000Z',
  },
  users: [
    {
      id: 1,
      username: 'testuser',
      avatar: null,
      slots: [
        {
          start: '2026-02-10T17:00:00.000Z',
          end: '2026-02-10T21:00:00.000Z',
          status: 'available',
          gameId: null,
          sourceEventId: null,
        },
      ],
    },
  ],
};

function setupRosterAvailability() {
  mockEventsService.getRosterAvailability = jest
    .fn()
    .mockResolvedValue(mockRosterAvailability);
}

async function testRosterAvailability() {
  setupRosterAvailability();
  const result = await signupsController.getRosterAvailability(1, {});
  expect(result.eventId).toBe(1);
  expect(result.users).toHaveLength(1);
  expect(mockEventsService.getRosterAvailability).toHaveBeenCalledWith(
    1,
    undefined,
    undefined,
  );
}

async function testRosterAvailabilityParams() {
  setupRosterAvailability();
  const query = {
    from: '2026-02-10T16:00:00.000Z',
    to: '2026-02-10T22:00:00.000Z',
  };
  await signupsController.getRosterAvailability(1, query);
  expect(mockEventsService.getRosterAvailability).toHaveBeenCalledWith(
    1,
    query.from,
    query.to,
  );
}

beforeEach(() => setupEach());

describe('EventsController — create', () => {
  it('should create event with valid data', () => testCreateValid());
  it('should auto-signup creator (AC-5)', () => testCreateAutoSignup());
  it('should throw BadRequestException for invalid data', () =>
    testCreateInvalid());
  it('should throw BadRequestException when end before start', () =>
    testCreateEndBeforeStart());
});

describe('EventsController — findAll', () => {
  it('should return paginated events', () => testFindAllPaginated());
  it('should pass query params to service', () => testFindAllQueryParams());
  it('should pass userId to service (ROK-213)', () => testFindAllAuthUserId());
});

describe('EventsController — findAll date range (ROK-174)', () => {
  it('should pass startAfter', () => testDateRangeStartAfter());
  it('should pass endBefore', () => testDateRangeEndBefore());
  it('should pass both for range queries', () => testDateRangeBoth());
  it('should pass gameId filter', () => testDateRangeGameId());
  it('should combine date range with other filters', () =>
    testDateRangeCombined());
  it('should throw for invalid startAfter', () =>
    testDateRangeInvalidStartAfter());
  it('should throw for invalid endBefore', () =>
    testDateRangeInvalidEndBefore());
  it('should throw when startAfter after endBefore', () =>
    testDateRangeStartAfterEnd());
});

describe('EventsController — findOne / update / delete', () => {
  it('should return single event', () => testFindOne());
  it('should update event with valid data', () => testUpdate());
  it('should delete event', () => testDelete());
});

describe('EventsController — confirmSignup (ROK-131)', () => {
  it('should confirm signup with valid character', () =>
    testConfirmSignupValid());
  it('should throw for invalid characterId', () =>
    testConfirmSignupInvalidId());
  it('should throw for missing characterId', () => testConfirmSignupMissing());
});

describe('EventsController — getVoiceSessions ACL (ROK-490)', () => {
  it('should allow event creator', () => testVoiceSessionsCreator());
  it('should allow operator', () => testVoiceSessionsOperator());
  it('should allow admin', () => testVoiceSessionsAdmin());
  it('should throw for non-creator member', () => testVoiceSessionsForbidden());
});

describe('EventsController — getVoiceAttendance ACL (ROK-490)', () => {
  it('should allow event creator', () => testVoiceAttendanceCreator());
  it('should allow operator', () => testVoiceAttendanceOperator());
  it('should allow admin', () => testVoiceAttendanceAdmin());
  it('should throw for non-creator member', () =>
    testVoiceAttendanceForbidden());
});

describe('EventsController — getRosterAvailability (ROK-113)', () => {
  it('should return roster availability', () => testRosterAvailability());
  it('should pass query params to service', () =>
    testRosterAvailabilityParams());
});
