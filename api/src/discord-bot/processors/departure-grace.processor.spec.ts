import { DepartureGraceProcessor } from './departure-grace.processor';
import { VoiceAttendanceService } from '../services/voice-attendance.service';
import { NotificationService } from '../../notifications/notification.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SIGNUP_EVENTS } from '../discord-bot.constants';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import {
  createMockEvent,
  createMockSignup,
} from '../../common/testing/factories';
import type { Job } from 'bullmq';
import type { DepartureGraceJobData } from '../queues/departure-grace.queue';

function makeJob(data: DepartureGraceJobData) {
  return { data } as Job<DepartureGraceJobData>;
}

let processor: DepartureGraceProcessor;
let mockDb: MockDb;
let mockVoiceAttendanceService: { isUserActive: jest.Mock };
let mockNotificationService: {
  getDiscordEmbedUrl: jest.Mock;
  resolveVoiceChannelForEvent: jest.Mock;
  create: jest.Mock;
};
let mockClientService: {
  isConnected: jest.Mock;
  sendEmbedDM: jest.Mock;
};
let mockEventEmitter: { emit: jest.Mock };

const jobData: DepartureGraceJobData = {
  eventId: 1,
  discordUserId: 'discord-user-abc',
  signupId: 10,
};

const liveEvent = createMockEvent({
  id: 1,
  isAdHoc: false,
  cancelledAt: null,
  creatorId: 99,
  title: 'Test Raid',
});

/** Event with a capacity limit — departure notifications should fire when full. */
const fullEvent = createMockEvent({
  id: 1,
  isAdHoc: false,
  cancelledAt: null,
  creatorId: 99,
  title: 'Test Raid',
  maxAttendees: 5,
});

const activeSignup = createMockSignup({
  id: 10,
  eventId: 1,
  status: 'signed_up',
  discordUserId: 'discord-user-abc',
  discordUsername: 'RaidMember',
  userId: 5,
});

beforeEach(() => {
  mockDb = createDrizzleMock();
  mockVoiceAttendanceService = {
    isUserActive: jest.fn().mockReturnValue(false),
  };
  mockNotificationService = {
    getDiscordEmbedUrl: jest
      .fn()
      .mockResolvedValue('https://discord.com/embed/1'),
    resolveVoiceChannelForEvent: jest.fn().mockResolvedValue('channel-123'),
    create: jest.fn().mockResolvedValue(undefined),
  };
  mockClientService = {
    isConnected: jest.fn().mockReturnValue(true),
    sendEmbedDM: jest.fn().mockResolvedValue(undefined),
  };
  mockEventEmitter = { emit: jest.fn() };

  processor = new DepartureGraceProcessor(
    mockDb as never,
    mockVoiceAttendanceService as unknown as VoiceAttendanceService,
    mockNotificationService as unknown as NotificationService,
    mockClientService as unknown as DiscordBotClientService,
    mockEventEmitter as unknown as EventEmitter2,
  );
});

afterEach(() => {
  jest.clearAllMocks();
});

// ─── Guard: user rejoined voice before grace expired ──────────────────────

describe('DepartureGraceProcessor — guard: user active in voice', () => {
  it('skips departure processing if user returned to voice before grace expired', async () => {
    mockVoiceAttendanceService.isUserActive.mockReturnValue(true);

    await processor.process(makeJob(jobData));

    expect(mockDb.limit).not.toHaveBeenCalled();
    expect(mockNotificationService.create).not.toHaveBeenCalled();
    expect(mockEventEmitter.emit).not.toHaveBeenCalled();
  });

  it('checks isUserActive with correct eventId and discordUserId', async () => {
    mockVoiceAttendanceService.isUserActive.mockReturnValue(true);

    await processor.process(makeJob(jobData));

    expect(mockVoiceAttendanceService.isUserActive).toHaveBeenCalledWith(
      jobData.eventId,
      jobData.discordUserId,
    );
  });
});

// ─── Guard: event no longer live ──────────────────────────────────────────

describe('DepartureGraceProcessor — guard: event no longer live', () => {
  it('skips departure if event is not found / no longer live', async () => {
    mockDb.limit.mockResolvedValueOnce([]);

    await processor.process(makeJob(jobData));

    expect(mockNotificationService.create).not.toHaveBeenCalled();
    expect(mockEventEmitter.emit).not.toHaveBeenCalled();
  });
});

// ─── Regression: departure during extension time (ROK-744) ────────────────

describe('DepartureGraceProcessor — Regression: departure during extension time (ROK-744)', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('skips departure when grace expires during extension time', async () => {
    const extendedEvent = createMockEvent({
      id: 1,
      isAdHoc: false,
      cancelledAt: null,
      creatorId: 99,
      title: 'Extended Raid',
      duration: [
        new Date('2026-02-10T18:00:00Z'),
        new Date('2026-02-10T20:00:00Z'),
      ],
      extendedUntil: new Date('2026-02-10T21:00:00Z'),
    });

    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-02-10T20:30:00Z'));

    mockDb.limit.mockResolvedValueOnce([extendedEvent]);

    await processor.process(makeJob(jobData));

    expect(mockNotificationService.create).not.toHaveBeenCalled();
    expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    expect(mockDb.set).not.toHaveBeenCalledWith({ status: 'departed' });
  });

  it('still triggers departure during scheduled event time even with extendedUntil set', async () => {
    const extendedEvent = createMockEvent({
      id: 1,
      isAdHoc: false,
      cancelledAt: null,
      creatorId: 99,
      title: 'Extended Raid',
      duration: [
        new Date('2026-02-10T18:00:00Z'),
        new Date('2026-02-10T20:00:00Z'),
      ],
      extendedUntil: new Date('2026-02-10T21:00:00Z'),
    });

    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-02-10T19:30:00Z'));

    mockDb.limit
      .mockResolvedValueOnce([extendedEvent])
      .mockResolvedValueOnce([activeSignup])
      .mockResolvedValueOnce([]);

    await processor.process(makeJob(jobData));

    expect(mockEventEmitter.emit).toHaveBeenCalledWith(
      SIGNUP_EVENTS.UPDATED,
      expect.objectContaining({ action: 'departed' }),
    );
  });
});

// ─── Guard: signup not found ───────────────────────────────────────────────

describe('DepartureGraceProcessor — guard: signup not found', () => {
  it('skips departure if signup record no longer exists', async () => {
    mockDb.limit.mockResolvedValueOnce([liveEvent]).mockResolvedValueOnce([]);

    await processor.process(makeJob(jobData));

    expect(mockNotificationService.create).not.toHaveBeenCalled();
    expect(mockEventEmitter.emit).not.toHaveBeenCalled();
  });
});

// ─── Guard: signup status not actionable ──────────────────────────────────

describe('DepartureGraceProcessor — guard: signup status', () => {
  it.each(['departed', 'declined', 'roached_out'])(
    'skips departure if signup status is already "%s"',
    async (status) => {
      const signup = createMockSignup({ id: 10, eventId: 1, status });
      mockDb.limit
        .mockResolvedValueOnce([liveEvent])
        .mockResolvedValueOnce([signup]);

      await processor.process(makeJob(jobData));

      expect(mockNotificationService.create).not.toHaveBeenCalled();
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    },
  );

  it('processes departure for signed_up status', async () => {
    mockDb.limit
      .mockResolvedValueOnce([liveEvent])
      .mockResolvedValueOnce([activeSignup])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await processor.process(makeJob(jobData));

    expect(mockEventEmitter.emit).toHaveBeenCalled();
  });

  it('processes departure for tentative status', async () => {
    const tentativeSignup = createMockSignup({
      id: 10,
      eventId: 1,
      status: 'tentative',
      discordUsername: 'TentativeUser',
    });
    mockDb.limit
      .mockResolvedValueOnce([liveEvent])
      .mockResolvedValueOnce([tentativeSignup])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await processor.process(makeJob(jobData));

    expect(mockEventEmitter.emit).toHaveBeenCalled();
  });
});

// ─── Core flow: successful departure ──────────────────────────────────────

describe('DepartureGraceProcessor — successful departure: status update', () => {
  beforeEach(() => {
    mockDb.limit
      .mockResolvedValueOnce([liveEvent])
      .mockResolvedValueOnce([activeSignup])
      .mockResolvedValueOnce([]);
  });

  it('updates signup status to "departed"', async () => {
    await processor.process(makeJob(jobData));

    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith({ status: 'departed' });
  });

  it('emits SIGNUP_EVENTS.UPDATED with "departed" action for embed sync', async () => {
    await processor.process(makeJob(jobData));

    expect(mockEventEmitter.emit).toHaveBeenCalledWith(
      SIGNUP_EVENTS.UPDATED,
      expect.objectContaining({
        eventId: jobData.eventId,
        signupId: jobData.signupId,
        action: 'departed',
      }),
    );
  });

  it('does not send promote DM when no roster assignment exists', async () => {
    await processor.process(makeJob(jobData));

    expect(mockClientService.sendEmbedDM).not.toHaveBeenCalled();
  });
});

describe('DepartureGraceProcessor — successful departure: notifications', () => {
  beforeEach(() => {
    mockDb.limit
      .mockResolvedValueOnce([fullEvent])
      .mockResolvedValueOnce([activeSignup])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: 4 }]);
  });

  it('sends a slot_vacated notification to the event creator', async () => {
    await processor.process(makeJob(jobData));

    expect(mockNotificationService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: fullEvent.creatorId,
        type: 'slot_vacated',
        title: 'Member Departed',
      }),
    );
  });

  it('includes the member display name in the notification message', async () => {
    await processor.process(makeJob(jobData));

    expect(mockNotificationService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('RaidMember'),
      }),
    );
  });

  it('includes eventId in the notification payload', async () => {
    await processor.process(makeJob(jobData));

    expect(mockNotificationService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ eventId: jobData.eventId }),
      }),
    );
  });

  it('does not send notification when event has no creatorId', async () => {
    const eventWithNoCreator = createMockEvent({
      id: 1,
      creatorId: null,
      maxAttendees: 5,
    });
    mockDb.limit
      .mockReset()
      .mockResolvedValueOnce([eventWithNoCreator])
      .mockResolvedValueOnce([activeSignup])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: 4 }]);

    await processor.process(makeJob(jobData));

    expect(mockNotificationService.create).not.toHaveBeenCalled();
    expect(mockEventEmitter.emit).toHaveBeenCalled();
  });
});

// ─── Capacity check: suppress notifications when not full (ROK-851) ──────

describe('DepartureGraceProcessor — capacity check: not full', () => {
  it('does NOT send notifications when event was not full (below capacity)', async () => {
    const eventWithCapacity = createMockEvent({
      id: 1,
      creatorId: 99,
      maxAttendees: 10,
    });
    mockDb.limit
      .mockResolvedValueOnce([eventWithCapacity])
      .mockResolvedValueOnce([activeSignup])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: 5 }]);

    await processor.process(makeJob(jobData));

    expect(mockNotificationService.create).not.toHaveBeenCalled();
    expect(mockClientService.sendEmbedDM).not.toHaveBeenCalled();
    expect(mockEventEmitter.emit).toHaveBeenCalled();
  });

  it('does NOT send notifications for unlimited events (no capacity)', async () => {
    mockDb.limit
      .mockResolvedValueOnce([liveEvent])
      .mockResolvedValueOnce([activeSignup])
      .mockResolvedValueOnce([]);

    await processor.process(makeJob(jobData));

    expect(mockNotificationService.create).not.toHaveBeenCalled();
    expect(mockClientService.sendEmbedDM).not.toHaveBeenCalled();
    expect(mockEventEmitter.emit).toHaveBeenCalled();
  });

  it('sends notifications when event was at capacity (full)', async () => {
    mockDb.limit
      .mockResolvedValueOnce([fullEvent])
      .mockResolvedValueOnce([activeSignup])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: 4 }]);

    await processor.process(makeJob(jobData));

    expect(mockNotificationService.create).toHaveBeenCalled();
  });

  it('sends notifications when event had slotConfig at capacity', async () => {
    const slotEvent = createMockEvent({
      id: 1,
      creatorId: 99,
      slotConfig: { type: 'generic', player: 6 },
    });
    mockDb.limit
      .mockResolvedValueOnce([slotEvent])
      .mockResolvedValueOnce([activeSignup])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: 5 }]);

    await processor.process(makeJob(jobData));

    expect(mockNotificationService.create).toHaveBeenCalled();
  });
});

// ─── Roster slot freeing ──────────────────────────────────────────────────

/**
 * Helper: set up mock chain for the full departure flow with a roster assignment.
 */
function setupRosterMocks(assignment: Record<string, unknown>) {
  mockDb.limit
    .mockResolvedValueOnce([fullEvent])
    .mockResolvedValueOnce([activeSignup])
    .mockResolvedValueOnce([assignment])
    .mockResolvedValueOnce([{ count: 4 }]);

  let whereCallCount = 0;
  const originalWhere = mockDb.where;
  mockDb.where = jest.fn().mockImplementation(function (this: unknown) {
    whereCallCount++;
    if (whereCallCount === 5) {
      return Promise.resolve([]);
    }
    return originalWhere.call(this) as unknown;
  });
}

describe('DepartureGraceProcessor — roster slot freeing', () => {
  beforeEach(() => {
    mockClientService.isConnected.mockReturnValue(false);
  });

  it('moves the roster assignment to bench when one exists', async () => {
    const assignment = {
      id: 55,
      role: 'tank',
      position: 1,
      signupId: 10,
      eventId: 1,
    };
    setupRosterMocks(assignment);

    await processor.process(makeJob(jobData));

    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'bench', position: 1 }),
    );
  });

  it('places departed user at next bench position after existing bench members', async () => {
    const assignment = {
      id: 55,
      role: 'tank',
      position: 1,
      signupId: 10,
      eventId: 1,
    };
    mockDb.limit
      .mockResolvedValueOnce([fullEvent])
      .mockResolvedValueOnce([activeSignup])
      .mockResolvedValueOnce([assignment])
      .mockResolvedValueOnce([{ count: 4 }]);

    let whereCallCount = 0;
    const originalWhere = mockDb.where;
    mockDb.where = jest.fn().mockImplementation(function (this: unknown) {
      whereCallCount++;
      if (whereCallCount === 5) {
        return Promise.resolve([{ position: 1 }, { position: 2 }]);
      }
      return originalWhere.call(this) as unknown;
    });

    await processor.process(makeJob(jobData));

    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'bench', position: 3 }),
    );
  });
});

// ─── Discord DM to creator ────────────────────────────────────────────────

function setupWithRoster(assignment: Record<string, unknown>) {
  mockDb.limit
    .mockResolvedValueOnce([fullEvent])
    .mockResolvedValueOnce([activeSignup])
    .mockResolvedValueOnce([assignment])
    .mockResolvedValueOnce([{ count: 4 }]);

  let whereCallCount = 0;
  const originalWhere = mockDb.where;
  mockDb.where = jest.fn().mockImplementation(function (this: unknown) {
    whereCallCount++;
    if (whereCallCount === 5) {
      return Promise.resolve([]);
    }
    if (whereCallCount === 7) {
      return originalWhere.call(this) as unknown;
    }
    return originalWhere.call(this) as unknown;
  });
}

describe('DepartureGraceProcessor — creator promote DM: sends DM', () => {
  it('sends Discord DM when roster slot is vacated and bench players exist', async () => {
    const assignment = {
      id: 55,
      role: 'dps',
      position: 2,
      signupId: 10,
      eventId: 1,
    };
    setupWithRoster(assignment);

    mockDb.limit
      .mockResolvedValueOnce([{ id: 88 }])
      .mockResolvedValueOnce([{ discordId: 'creator-discord-123' }]);

    await processor.process(makeJob(jobData));

    expect(mockClientService.sendEmbedDM).toHaveBeenCalledWith(
      'creator-discord-123',
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });
});

describe('DepartureGraceProcessor — creator promote DM: skip conditions', () => {
  it('does NOT send DM when bot is not connected', async () => {
    mockClientService.isConnected.mockReturnValue(false);
    const assignment = {
      id: 55,
      role: 'dps',
      position: 2,
      signupId: 10,
      eventId: 1,
    };
    setupWithRoster(assignment);

    await processor.process(makeJob(jobData));

    expect(mockClientService.sendEmbedDM).not.toHaveBeenCalled();
  });

  it('does NOT send DM when bench slot assignment (not a vacated role slot)', async () => {
    const benchAssignment = {
      id: 56,
      role: 'bench',
      position: 1,
      signupId: 10,
      eventId: 1,
    };
    mockDb.limit
      .mockResolvedValueOnce([liveEvent])
      .mockResolvedValueOnce([activeSignup])
      .mockResolvedValueOnce([benchAssignment]);

    await processor.process(makeJob(jobData));

    expect(mockClientService.sendEmbedDM).not.toHaveBeenCalled();
  });

  it('does NOT send DM when no bench players exist', async () => {
    const assignment = {
      id: 55,
      role: 'tank',
      position: 1,
      signupId: 10,
      eventId: 1,
    };
    setupWithRoster(assignment);

    mockDb.limit.mockResolvedValueOnce([]);

    await processor.process(makeJob(jobData));

    expect(mockClientService.sendEmbedDM).not.toHaveBeenCalled();
  });

  it('does NOT send DM when creator has no Discord ID', async () => {
    const assignment = {
      id: 55,
      role: 'tank',
      position: 1,
      signupId: 10,
      eventId: 1,
    };
    setupWithRoster(assignment);

    mockDb.limit
      .mockResolvedValueOnce([{ id: 88 }])
      .mockResolvedValueOnce([{ discordId: null }]);

    await processor.process(makeJob(jobData));

    expect(mockClientService.sendEmbedDM).not.toHaveBeenCalled();
  });

  it('does not throw if DM fails (failure is non-blocking)', async () => {
    const assignment = {
      id: 55,
      role: 'tank',
      position: 1,
      signupId: 10,
      eventId: 1,
    };
    setupWithRoster(assignment);

    mockDb.limit
      .mockResolvedValueOnce([{ id: 88 }])
      .mockResolvedValueOnce([{ discordId: 'creator-discord-123' }]);
    mockClientService.sendEmbedDM.mockRejectedValue(new Error('DM blocked'));

    await expect(processor.process(makeJob(jobData))).resolves.toBeUndefined();
    expect(mockEventEmitter.emit).toHaveBeenCalled();
  });
});

// ─── Display name resolution ───────────────────────────────────────────────

describe('DepartureGraceProcessor — display name: from signup', () => {
  it('uses discordUsername from signup when available', async () => {
    const signupWithUsername = createMockSignup({
      id: 10,
      eventId: 1,
      status: 'signed_up',
      discordUsername: 'DiscordName',
      userId: null,
    });
    mockDb.limit
      .mockResolvedValueOnce([fullEvent])
      .mockResolvedValueOnce([signupWithUsername])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: 4 }]);

    await processor.process(makeJob(jobData));

    expect(mockNotificationService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('DiscordName'),
      }),
    );
  });
});

describe('DepartureGraceProcessor — display name: fallbacks', () => {
  it('falls back to RL username when discordUsername is null', async () => {
    const signupWithoutDiscordName = createMockSignup({
      id: 10,
      eventId: 1,
      status: 'signed_up',
      discordUsername: null,
      userId: 5,
    });
    mockDb.limit
      .mockResolvedValueOnce([fullEvent])
      .mockResolvedValueOnce([signupWithoutDiscordName])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: 4 }])
      .mockResolvedValueOnce([{ username: 'RLUser' }]);

    await processor.process(makeJob(jobData));

    expect(mockNotificationService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('RLUser'),
      }),
    );
  });

  it('falls back to discordUserId when both discordUsername and userId are absent', async () => {
    const anonymousSignup = createMockSignup({
      id: 10,
      eventId: 1,
      status: 'signed_up',
      discordUsername: null,
      userId: null,
      discordUserId: 'raw-discord-id-xyz',
    });
    mockDb.limit
      .mockResolvedValueOnce([fullEvent])
      .mockResolvedValueOnce([anonymousSignup])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: 4 }]);

    await processor.process(makeJob(jobData));

    expect(mockNotificationService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('raw-discord-id-xyz'),
      }),
    );
  });

  it('falls back to "Unknown" when no name info is available', async () => {
    const blankSignup = createMockSignup({
      id: 10,
      eventId: 1,
      status: 'signed_up',
      discordUsername: null,
      userId: null,
      discordUserId: null,
    });
    mockDb.limit
      .mockResolvedValueOnce([fullEvent])
      .mockResolvedValueOnce([blankSignup])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: 4 }]);

    await processor.process(makeJob(jobData));

    expect(mockNotificationService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Unknown'),
      }),
    );
  });
});

// ─── Notification includes optional URLs ──────────────────────────────────

describe('DepartureGraceProcessor — notification payload URLs', () => {
  beforeEach(() => {
    mockDb.limit
      .mockResolvedValueOnce([fullEvent])
      .mockResolvedValueOnce([activeSignup])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: 4 }]);
  });

  it('includes discordUrl in payload when available', async () => {
    mockNotificationService.getDiscordEmbedUrl.mockResolvedValue(
      'https://discord.com/embed',
    );

    await processor.process(makeJob(jobData));

    expect(mockNotificationService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          discordUrl: 'https://discord.com/embed',
        }),
      }),
    );
  });

  it('omits discordUrl from payload when not available', async () => {
    mockNotificationService.getDiscordEmbedUrl.mockResolvedValue(null);
    mockNotificationService.resolveVoiceChannelForEvent.mockResolvedValue(null);

    await processor.process(makeJob(jobData));

    const payload = mockNotificationService.create.mock.calls[0][0].payload;
    expect(payload).not.toHaveProperty('discordUrl');
  });

  it('includes voiceChannelId in payload when available', async () => {
    mockNotificationService.resolveVoiceChannelForEvent.mockResolvedValue(
      'vc-999',
    );

    await processor.process(makeJob(jobData));

    expect(mockNotificationService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ voiceChannelId: 'vc-999' }),
      }),
    );
  });

  it('omits voiceChannelId from payload when not available', async () => {
    mockNotificationService.getDiscordEmbedUrl.mockResolvedValue(null);
    mockNotificationService.resolveVoiceChannelForEvent.mockResolvedValue(null);

    await processor.process(makeJob(jobData));

    const payload = mockNotificationService.create.mock.calls[0][0].payload;
    expect(payload).not.toHaveProperty('voiceChannelId');
  });
});

// ─── ROK-919: MMO role-based relevance filter ──────────────────────────────

describe('DepartureGraceProcessor — MMO relevance filter (ROK-919)', () => {
  it('suppresses notification for DPS departure from full MMO event', async () => {
    const mmoFullEvent = createMockEvent({
      id: 1,
      creatorId: 99,
      slotConfig: { type: 'mmo', tank: 1, healer: 1, dps: 3, flex: 0 },
    });
    const dpsAssignment = {
      id: 55,
      role: 'dps',
      position: 2,
      signupId: 10,
      eventId: 1,
    };
    mockDb.limit
      .mockResolvedValueOnce([mmoFullEvent])
      .mockResolvedValueOnce([activeSignup])
      .mockResolvedValueOnce([dpsAssignment]);

    let whereCallCount = 0;
    const originalWhere = mockDb.where;
    mockDb.where = jest.fn().mockImplementation(function (this: unknown) {
      whereCallCount++;
      if (whereCallCount === 5) {
        return Promise.resolve([]);
      }
      return originalWhere.call(this) as unknown;
    });

    await processor.process(makeJob(jobData));

    expect(mockNotificationService.create).not.toHaveBeenCalled();
    expect(mockClientService.sendEmbedDM).not.toHaveBeenCalled();
    expect(mockEventEmitter.emit).toHaveBeenCalled();
  });

  it('sends notification for tank departure from full MMO event', async () => {
    const mmoFullEvent = createMockEvent({
      id: 1,
      creatorId: 99,
      slotConfig: { type: 'mmo', tank: 1, healer: 1, dps: 3, flex: 0 },
    });
    const tankAssignment = {
      id: 55,
      role: 'tank',
      position: 1,
      signupId: 10,
      eventId: 1,
    };
    mockDb.limit
      .mockResolvedValueOnce([mmoFullEvent])
      .mockResolvedValueOnce([activeSignup])
      .mockResolvedValueOnce([tankAssignment]);

    let whereCallCount = 0;
    const originalWhere = mockDb.where;
    mockDb.where = jest.fn().mockImplementation(function (this: unknown) {
      whereCallCount++;
      if (whereCallCount === 5) {
        return Promise.resolve([]);
      }
      return originalWhere.call(this) as unknown;
    });

    mockDb.limit
      .mockResolvedValueOnce([{ id: 88 }])
      .mockResolvedValueOnce([{ discordId: 'creator-discord-123' }]);

    await processor.process(makeJob(jobData));

    expect(mockNotificationService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 99,
        type: 'slot_vacated',
      }),
    );
  });
});
