import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DepartureGraceService } from './departure-grace.service';
import {
  DepartureGraceQueueService,
  DEPARTURE_GRACE_DELAY_MS,
} from '../queues/departure-grace.queue';
import { NotificationService } from '../../notifications/notification.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import {
  createMockEvent,
  createMockSignup,
  createMockUser,
} from '../../common/testing/factories';
import { SIGNUP_EVENTS } from '../discord-bot.constants';

/**
 * Build a chainable Drizzle mock for DepartureGraceService.
 *
 * The service has two types of terminal queries:
 *   - `.limit(1)` — used by findActiveSignup, findSignupByStatus, resolveDisplayName
 *   - `.where()` — used by tryRosterReassignment to fetch all roster assignments
 *
 * We expose `limitResults` and `whereResults` queues that return values one-by-one.
 */
function buildMockDb() {
  const limitResults: unknown[][] = [];
  const whereResults: unknown[][] = [];

  // Mock fns that are asserted on
  const updateFn = jest.fn();
  const setFn = jest.fn();
  const insertFn = jest.fn();
  const valuesFn = jest.fn();
  const deleteFn = jest.fn();

  const mock = {
    // Queues for controlling return values
    _limitResults: limitResults,
    _whereResults: whereResults,

    // Assertion mocks
    update: updateFn,
    set: setFn,
    insert: insertFn,
    values: valuesFn,
    delete: deleteFn,

    // Chain methods that resolve at limit()
    limit: jest
      .fn()
      .mockImplementation(() => Promise.resolve(limitResults.shift() ?? [])),

    // where terminates the rosterAssignments query; otherwise is mid-chain
    where: jest.fn().mockImplementation(() => ({
      // support .where().limit()
      limit: jest
        .fn()
        .mockImplementation(() => Promise.resolve(limitResults.shift() ?? [])),
      // support await .where() directly (roster assignments query)
      then: (resolve: (v: unknown[]) => void) =>
        Promise.resolve(whereResults.shift() ?? []).then(resolve),
    })),

    // Other chain methods return this-like stub
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
  };

  // update chain: update().set().where()
  updateFn.mockReturnValue({
    set: setFn.mockReturnValue({
      where: jest.fn().mockResolvedValue(undefined),
    }),
  });

  // insert chain: insert().values()
  insertFn.mockReturnValue({
    values: valuesFn.mockResolvedValue(undefined),
  });

  // delete chain: delete().where()
  deleteFn.mockReturnValue({
    where: jest.fn().mockResolvedValue(undefined),
  });

  return mock;
}

type MockDb = ReturnType<typeof buildMockDb>;

// ─── Shared fixtures ─────────────────────────────────────────────────────────

const EVENT_ID = 1;
const DISCORD_USER_ID = 'discord-user-xyz';
const scheduledEvent = createMockEvent({ id: EVENT_ID, isAdHoc: false });
const adHocEvent = createMockEvent({ id: EVENT_ID, isAdHoc: true });
const activeSignup = createMockSignup({
  id: 10,
  eventId: EVENT_ID,
  status: 'signed_up',
  discordUserId: DISCORD_USER_ID,
  discordUsername: 'TestMember',
});
const departedSignup = createMockSignup({
  id: 10,
  eventId: EVENT_ID,
  status: 'departed',
  discordUserId: DISCORD_USER_ID,
  discordUsername: 'TestMember',
  userId: 5,
});

async function buildGraceModule() {
  const mockDb = buildMockDb();
  const mockGraceQueue = {
    enqueue: jest.fn().mockResolvedValue(undefined),
    cancel: jest.fn().mockResolvedValue(undefined),
  };
  const mockNotificationService = {
    getDiscordEmbedUrl: jest.fn().mockResolvedValue(null),
    resolveVoiceChannelForEvent: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue(undefined),
  };
  const mockEventEmitter = { emit: jest.fn() };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      DepartureGraceService,
      { provide: DrizzleAsyncProvider, useValue: mockDb },
      { provide: DepartureGraceQueueService, useValue: mockGraceQueue },
      { provide: NotificationService, useValue: mockNotificationService },
      { provide: EventEmitter2, useValue: mockEventEmitter },
    ],
  }).compile();

  return {
    service: module.get(DepartureGraceService),
    mockDb,
    mockGraceQueue,
    mockNotificationService,
    mockEventEmitter,
  };
}

describe('DepartureGraceService', () => {
  let service: DepartureGraceService;
  let mockDb: MockDb;
  let mockGraceQueue: { enqueue: jest.Mock; cancel: jest.Mock };
  let mockNotificationService: {
    create: jest.Mock;
    getDiscordEmbedUrl: jest.Mock;
    resolveVoiceChannelForEvent: jest.Mock;
  };
  let mockEventEmitter: { emit: jest.Mock };

  beforeEach(async () => {
    const ctx = await buildGraceModule();
    service = ctx.service;
    mockDb = ctx.mockDb;
    mockGraceQueue = ctx.mockGraceQueue;
    mockNotificationService = ctx.mockNotificationService;
    mockEventEmitter = ctx.mockEventEmitter;
  });

  afterEach(() => jest.clearAllMocks());

  describe('onMemberLeave — ad-hoc exclusion', () => {
    it('does not enqueue a grace timer for ad-hoc events', async () => {
      mockDb._limitResults.push([adHocEvent]);
      await service.onMemberLeave(EVENT_ID, DISCORD_USER_ID);
      expect(mockGraceQueue.enqueue).not.toHaveBeenCalled();
    });

    it('does not enqueue when event is not found', async () => {
      mockDb._limitResults.push([]);
      await service.onMemberLeave(EVENT_ID, DISCORD_USER_ID);
      expect(mockGraceQueue.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('onMemberLeave — signup existence checks', () => {
    it('does not enqueue when user has no signup and no RL user found', async () => {
      mockDb._limitResults.push([scheduledEvent], [], []);
      await service.onMemberLeave(EVENT_ID, DISCORD_USER_ID);
      expect(mockGraceQueue.enqueue).not.toHaveBeenCalled();
    });

    it('enqueues grace timer when direct discord ID match found', async () => {
      mockDb._limitResults.push([scheduledEvent], [activeSignup]);
      await service.onMemberLeave(EVENT_ID, DISCORD_USER_ID);
      expect(mockGraceQueue.enqueue).toHaveBeenCalledWith(
        {
          eventId: EVENT_ID,
          discordUserId: DISCORD_USER_ID,
          signupId: activeSignup.id,
        },
        expect.any(Number),
      );
    });

    it('enqueues grace timer when signup found via linked RL user', async () => {
      const rlUser = createMockUser({ id: 5, discordId: DISCORD_USER_ID });
      const signupViaUser = createMockSignup({
        id: 20,
        eventId: EVENT_ID,
        userId: 5,
        status: 'signed_up',
        discordUserId: null,
      });
      mockDb._limitResults.push(
        [scheduledEvent],
        [],
        [rlUser],
        [signupViaUser],
      );
      await service.onMemberLeave(EVENT_ID, DISCORD_USER_ID);
      expect(mockGraceQueue.enqueue).toHaveBeenCalledWith(
        {
          eventId: EVENT_ID,
          discordUserId: DISCORD_USER_ID,
          signupId: signupViaUser.id,
        },
        expect.any(Number),
      );
    });
  });

  describe('onMemberLeave — skipped statuses', () => {
    it.each(['departed', 'declined', 'roached_out'])(
      'does not enqueue when signup status is "%s"',
      async (status) => {
        const s = createMockSignup({
          id: 10,
          eventId: EVENT_ID,
          status,
          discordUserId: DISCORD_USER_ID,
        });
        mockDb._limitResults.push([scheduledEvent], [s]);
        await service.onMemberLeave(EVENT_ID, DISCORD_USER_ID);
        expect(mockGraceQueue.enqueue).not.toHaveBeenCalled();
      },
    );

    it('enqueues when signup status is "signed_up"', async () => {
      mockDb._limitResults.push([scheduledEvent], [activeSignup]);
      await service.onMemberLeave(EVENT_ID, DISCORD_USER_ID);
      expect(mockGraceQueue.enqueue).toHaveBeenCalled();
    });

    it('enqueues when signup status is "tentative"', async () => {
      const s = createMockSignup({
        id: 10,
        eventId: EVENT_ID,
        status: 'tentative',
        discordUserId: DISCORD_USER_ID,
      });
      mockDb._limitResults.push([scheduledEvent], [s]);
      await service.onMemberLeave(EVENT_ID, DISCORD_USER_ID);
      expect(mockGraceQueue.enqueue).toHaveBeenCalled();
    });
  });

  describe('onMemberLeave — timer details and edge cases', () => {
    it('passes the DEPARTURE_GRACE_DELAY_MS constant as the delay', async () => {
      mockDb._limitResults.push([scheduledEvent], [activeSignup]);
      await service.onMemberLeave(EVENT_ID, DISCORD_USER_ID);
      expect(mockGraceQueue.enqueue.mock.calls[0][1]).toBe(
        DEPARTURE_GRACE_DELAY_MS,
      );
    });

    it('handles errors gracefully without propagating', async () => {
      mockDb.select.mockImplementationOnce(() => {
        throw new Error('DB error');
      });
      await expect(
        service.onMemberLeave(EVENT_ID, DISCORD_USER_ID),
      ).resolves.not.toThrow();
    });

    it('calls enqueue each time member leaves (allowing timer reset)', async () => {
      mockDb._limitResults.push(
        [scheduledEvent],
        [activeSignup],
        [scheduledEvent],
        [activeSignup],
      );
      await service.onMemberLeave(EVENT_ID, DISCORD_USER_ID);
      await service.onMemberLeave(EVENT_ID, DISCORD_USER_ID);
      expect(mockGraceQueue.enqueue).toHaveBeenCalledTimes(2);
    });
  });

  describe('onMemberRejoin — grace timer cancellation', () => {
    it('cancels the pending grace timer on rejoin', async () => {
      mockDb._limitResults.push([], []);
      await service.onMemberRejoin(EVENT_ID, DISCORD_USER_ID);
      expect(mockGraceQueue.cancel).toHaveBeenCalledWith(
        EVENT_ID,
        DISCORD_USER_ID,
      );
    });

    it('does not trigger priority rejoin when no departed signup exists', async () => {
      mockDb._limitResults.push([], []);
      await service.onMemberRejoin(EVENT_ID, DISCORD_USER_ID);
      expect(mockNotificationService.create).not.toHaveBeenCalled();
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });

    it('handles errors gracefully without propagating', async () => {
      mockGraceQueue.cancel.mockRejectedValue(new Error('Redis error'));
      await expect(
        service.onMemberRejoin(EVENT_ID, DISCORD_USER_ID),
      ).resolves.not.toThrow();
    });
  });

  describe('onMemberRejoin — priority rejoin', () => {
    const benchAssignment = {
      id: 77,
      role: 'bench',
      position: 1,
      signupId: departedSignup.id,
      eventId: EVENT_ID,
    };

    function setupPriorityRejoin(eventOverrides = {}) {
      const event = createMockEvent({
        id: EVENT_ID,
        creatorId: 99,
        title: 'Raid Night',
        slotConfig: null,
        ...eventOverrides,
      });
      mockDb._limitResults.push(
        [departedSignup],
        [benchAssignment],
        [event],
        [event],
      );
      mockDb._whereResults.push([]);
      return event;
    }

    it('resets signup status to "signed_up" from "departed"', async () => {
      setupPriorityRejoin();
      await service.onMemberRejoin(EVENT_ID, DISCORD_USER_ID);
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith({ status: 'signed_up' });
    });

    it('emits SIGNUP_EVENTS.UPDATED with "priority_rejoin" action', async () => {
      setupPriorityRejoin();
      await service.onMemberRejoin(EVENT_ID, DISCORD_USER_ID);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        SIGNUP_EVENTS.UPDATED,
        expect.objectContaining({
          eventId: EVENT_ID,
          signupId: departedSignup.id,
          action: 'priority_rejoin',
        }),
      );
    });

    it('sends "Member Returned" notification to organizer', async () => {
      setupPriorityRejoin();
      await service.onMemberRejoin(EVENT_ID, DISCORD_USER_ID);
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 99,
          type: 'member_returned',
          title: 'Member Returned',
        }),
      );
    });

    it('does not send notification when event has no creatorId', async () => {
      setupPriorityRejoin({ creatorId: null });
      await service.onMemberRejoin(EVENT_ID, DISCORD_USER_ID);
      expect(mockNotificationService.create).not.toHaveBeenCalled();
      expect(mockEventEmitter.emit).toHaveBeenCalled();
    });
  });

  describe('roster reassignment — slot placement', () => {
    const benchAssignment = {
      id: 77,
      role: 'bench',
      position: 1,
      signupId: departedSignup.id,
      eventId: EVENT_ID,
    };

    function setupWithSlotConfig(
      slotConfig: unknown,
      existingAssignments: unknown[],
    ) {
      const event = createMockEvent({
        id: EVENT_ID,
        creatorId: 5,
        title: 'Test Event',
        slotConfig,
      });
      mockDb._limitResults.push(
        [departedSignup],
        [benchAssignment],
        [event],
        [event],
      );
      mockDb._whereResults.push(existingAssignments);
      return event;
    }

    it('sets signup status back to "signed_up" from "departed"', async () => {
      setupWithSlotConfig(null, []);
      await service.onMemberRejoin(EVENT_ID, DISCORD_USER_ID);
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith({ status: 'signed_up' });
    });

    it('does not displace existing slot occupants (no-displacement rule)', async () => {
      const config = { type: 'mmo', tank: 1, healer: 1, dps: 0 };
      const assignments = [
        { id: 1, role: 'tank', position: 1, signupId: 99 },
        { id: 2, role: 'healer', position: 1, signupId: 100 },
        benchAssignment,
      ];
      setupWithSlotConfig(config, assignments);
      await service.onMemberRejoin(EVENT_ID, DISCORD_USER_ID);
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('bench/unassigned'),
        }),
      );
    });

    it('moves from bench to first available MMO role slot when one is free', async () => {
      const config = { type: 'mmo', tank: 2, healer: 0, dps: 3 };
      const assignments = [
        { id: 1, role: 'tank', position: 1, signupId: 99 },
        benchAssignment,
      ];
      setupWithSlotConfig(config, assignments);
      await service.onMemberRejoin(EVENT_ID, DISCORD_USER_ID);
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'tank', position: 2 }),
      );
    });
  });

  describe('roster reassignment — generic and edge cases', () => {
    const benchAssignment = {
      id: 77,
      role: 'bench',
      position: 1,
      signupId: departedSignup.id,
      eventId: EVENT_ID,
    };

    function setupWithSlotConfig(
      slotConfig: unknown,
      existingAssignments: unknown[],
    ) {
      const event = createMockEvent({
        id: EVENT_ID,
        creatorId: 5,
        title: 'Test Event',
        slotConfig,
      });
      mockDb._limitResults.push(
        [departedSignup],
        [benchAssignment],
        [event],
        [event],
      );
      mockDb._whereResults.push(existingAssignments);
    }

    it('moves from bench to first available generic player slot', async () => {
      const assignments = [
        { id: 1, role: 'player', position: 1, signupId: 99 },
        benchAssignment,
      ];
      setupWithSlotConfig({ maxPlayers: 3 }, assignments);
      await service.onMemberRejoin(EVENT_ID, DISCORD_USER_ID);
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'player', position: 2 }),
      );
    });

    it('stays on bench when event has no slot config', async () => {
      setupWithSlotConfig(null, [benchAssignment]);
      await service.onMemberRejoin(EVENT_ID, DISCORD_USER_ID);
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('bench/unassigned'),
        }),
      );
    });

    it('includes slot info in notification when slot was assigned', async () => {
      setupWithSlotConfig({ type: 'mmo', tank: 0, healer: 1, dps: 0 }, [
        benchAssignment,
      ]);
      await service.onMemberRejoin(EVENT_ID, DISCORD_USER_ID);
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('healer:1'),
        }),
      );
    });

    it('includes eventId in notification payload', async () => {
      setupWithSlotConfig(null, [benchAssignment]);
      await service.onMemberRejoin(EVENT_ID, DISCORD_USER_ID);
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ eventId: EVENT_ID }),
        }),
      );
    });

    it('moves from bench to first free slot — does not skip available slots', async () => {
      setupWithSlotConfig({ type: 'mmo', tank: 0, healer: 0, dps: 1 }, [
        benchAssignment,
      ]);
      await service.onMemberRejoin(EVENT_ID, DISCORD_USER_ID);
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'dps', position: 1 }),
      );
    });
  });

  describe('findActiveSignup: discord ID vs RL user fallback', () => {
    it('uses direct discord ID match when available', async () => {
      mockDb._limitResults.push([scheduledEvent], [activeSignup]);
      await service.onMemberLeave(EVENT_ID, DISCORD_USER_ID);
      expect(mockGraceQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ signupId: activeSignup.id }),
        expect.any(Number),
      );
    });

    it('falls back to user lookup when no direct discord ID match', async () => {
      const rlUser = createMockUser({ id: 7, discordId: DISCORD_USER_ID });
      const linkedSignup = createMockSignup({
        id: 30,
        eventId: EVENT_ID,
        userId: 7,
        status: 'signed_up',
        discordUserId: null,
      });
      mockDb._limitResults.push([scheduledEvent], [], [rlUser], [linkedSignup]);
      await service.onMemberLeave(EVENT_ID, DISCORD_USER_ID);
      expect(mockGraceQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ signupId: linkedSignup.id }),
        expect.any(Number),
      );
    });

    it('skips grace timer when RL user has no signup for the event', async () => {
      const rlUser = createMockUser({ id: 7, discordId: DISCORD_USER_ID });
      mockDb._limitResults.push([scheduledEvent], [], [rlUser], []);
      await service.onMemberLeave(EVENT_ID, DISCORD_USER_ID);
      expect(mockGraceQueue.enqueue).not.toHaveBeenCalled();
    });
  });
});
