import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DepartureGraceService } from './departure-grace.service';
import {
  DepartureGraceQueueService,
  DEPARTURE_GRACE_DELAY_MS,
} from '../queues/departure-grace.queue';
import { NotificationService } from '../../notifications/notification.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { createMockEvent, createMockSignup, createMockUser } from '../../common/testing/factories';
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
    limit: jest.fn().mockImplementation(() =>
      Promise.resolve(limitResults.shift() ?? []),
    ),

    // where terminates the rosterAssignments query; otherwise is mid-chain
    where: jest.fn().mockImplementation(() => ({
      // support .where().limit()
      limit: jest.fn().mockImplementation(() =>
        Promise.resolve(limitResults.shift() ?? []),
      ),
      // support await .where() directly (roster assignments query)
      then: (resolve: (v: unknown[]) => void, _reject: unknown) =>
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

describe('DepartureGraceService', () => {
  let service: DepartureGraceService;
  let mockDb: MockDb;
  let mockGraceQueue: { enqueue: jest.Mock; cancel: jest.Mock };
  let mockNotificationService: {
    getDiscordEmbedUrl: jest.Mock;
    resolveVoiceChannelForEvent: jest.Mock;
    create: jest.Mock;
  };
  let mockEventEmitter: { emit: jest.Mock };

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

  beforeEach(async () => {
    mockDb = buildMockDb();
    mockGraceQueue = {
      enqueue: jest.fn().mockResolvedValue(undefined),
      cancel: jest.fn().mockResolvedValue(undefined),
    };
    mockNotificationService = {
      getDiscordEmbedUrl: jest.fn().mockResolvedValue(null),
      resolveVoiceChannelForEvent: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(undefined),
    };
    mockEventEmitter = { emit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DepartureGraceService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        { provide: DepartureGraceQueueService, useValue: mockGraceQueue },
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get(DepartureGraceService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── onMemberLeave ─────────────────────────────────────────────────────────

  describe('onMemberLeave', () => {
    describe('ad-hoc exclusion', () => {
      it('does not enqueue a grace timer for ad-hoc events', async () => {
        mockDb._limitResults.push([adHocEvent]);

        await service.onMemberLeave(EVENT_ID, DISCORD_USER_ID);

        expect(mockGraceQueue.enqueue).not.toHaveBeenCalled();
      });

      it('does not enqueue when event is not found', async () => {
        mockDb._limitResults.push([]); // no event found

        await service.onMemberLeave(EVENT_ID, DISCORD_USER_ID);

        expect(mockGraceQueue.enqueue).not.toHaveBeenCalled();
      });
    });

    describe('signup existence checks', () => {
      it('does not enqueue when user has no signup and no RL user found', async () => {
        mockDb._limitResults.push(
          [scheduledEvent], // event query
          [],               // direct discord match — none
          [],               // user lookup — not found
        );

        await service.onMemberLeave(EVENT_ID, DISCORD_USER_ID);

        expect(mockGraceQueue.enqueue).not.toHaveBeenCalled();
      });

      it('enqueues grace timer when direct discord ID match found', async () => {
        mockDb._limitResults.push(
          [scheduledEvent],
          [activeSignup], // direct discord match
        );

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
          [],           // direct discord match — none
          [rlUser],     // user lookup
          [signupViaUser], // signup via userId
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

    describe('skipped statuses', () => {
      it.each(['departed', 'declined', 'roached_out'])(
        'does not enqueue when signup status is "%s"',
        async (status) => {
          const nonActiveSignup = createMockSignup({
            id: 10,
            eventId: EVENT_ID,
            status,
            discordUserId: DISCORD_USER_ID,
          });
          mockDb._limitResults.push([scheduledEvent], [nonActiveSignup]);

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
        const tentativeSignup = createMockSignup({
          id: 10,
          eventId: EVENT_ID,
          status: 'tentative',
          discordUserId: DISCORD_USER_ID,
        });
        mockDb._limitResults.push([scheduledEvent], [tentativeSignup]);

        await service.onMemberLeave(EVENT_ID, DISCORD_USER_ID);

        expect(mockGraceQueue.enqueue).toHaveBeenCalled();
      });
    });

    describe('grace timer details', () => {
      it('passes the DEPARTURE_GRACE_DELAY_MS constant as the delay', async () => {
        mockDb._limitResults.push([scheduledEvent], [activeSignup]);

        await service.onMemberLeave(EVENT_ID, DISCORD_USER_ID);

        const delay = mockGraceQueue.enqueue.mock.calls[0][1] as number;
        expect(delay).toBe(DEPARTURE_GRACE_DELAY_MS);
      });
    });

    describe('error handling', () => {
      it('handles errors gracefully without propagating', async () => {
        mockDb.select.mockImplementationOnce(() => {
          throw new Error('DB error');
        });

        await expect(
          service.onMemberLeave(EVENT_ID, DISCORD_USER_ID),
        ).resolves.not.toThrow();
      });
    });

    describe('multiple disconnect/reconnect reset', () => {
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
  });

  // ─── onMemberRejoin ────────────────────────────────────────────────────────

  describe('onMemberRejoin', () => {
    describe('grace timer cancellation', () => {
      it('cancels the pending grace timer on rejoin', async () => {
        // No departed signup
        mockDb._limitResults.push([], []); // findSignupByStatus: direct + user lookup

        await service.onMemberRejoin(EVENT_ID, DISCORD_USER_ID);

        expect(mockGraceQueue.cancel).toHaveBeenCalledWith(EVENT_ID, DISCORD_USER_ID);
      });

      it('cancels before checking for departed status', async () => {
        const callOrder: string[] = [];
        mockGraceQueue.cancel.mockImplementation(async () => {
          callOrder.push('cancel');
        });
        mockDb._limitResults.push([]);
        mockDb.select.mockImplementation(() => {
          callOrder.push('db');
          // Return the chain
          return {
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockResolvedValue([]),
          };
        });

        await service.onMemberRejoin(EVENT_ID, DISCORD_USER_ID);

        expect(callOrder[0]).toBe('cancel');
      });
    });

    describe('when member was NOT departed (within grace period)', () => {
      it('does not trigger priority rejoin when no departed signup exists', async () => {
        // findSignupByStatus returns no departed signup
        mockDb._limitResults.push(
          [], // direct discord departed lookup — none
          [], // user lookup — none
        );

        await service.onMemberRejoin(EVENT_ID, DISCORD_USER_ID);

        expect(mockNotificationService.create).not.toHaveBeenCalled();
        expect(mockEventEmitter.emit).not.toHaveBeenCalled();
      });
    });

    describe('when member WAS departed (priority rejoin)', () => {
      const benchAssignment = { id: 77, role: 'bench', position: 1, signupId: departedSignup.id, eventId: EVENT_ID };

      function setupPriorityRejoin(eventOverrides = {}) {
        const event = createMockEvent({
          id: EVENT_ID,
          creatorId: 99,
          title: 'Raid Night',
          slotConfig: null,
          ...eventOverrides,
        });

        // findSignupByStatus: departed signup found directly
        mockDb._limitResults.push(
          [departedSignup],    // departed direct match
          [benchAssignment],   // tryRosterReassignment: bench assignment lookup
          [event],             // tryRosterReassignment: event select
          [event],             // handlePriorityRejoin: event for notification
        );
        // rosterAssignments select terminates at .where()
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

      it('sends "Member Returned" notification to organizer on priority rejoin', async () => {
        setupPriorityRejoin();

        await service.onMemberRejoin(EVENT_ID, DISCORD_USER_ID);

        expect(mockNotificationService.create).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: 99,
            type: 'slot_vacated',
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

    describe('error handling', () => {
      it('handles errors gracefully without propagating', async () => {
        mockGraceQueue.cancel.mockRejectedValue(new Error('Redis error'));

        await expect(
          service.onMemberRejoin(EVENT_ID, DISCORD_USER_ID),
        ).resolves.not.toThrow();
      });
    });
  });

  // ─── priority rejoin: roster reassignment ─────────────────────────────────

  describe('priority rejoin: roster reassignment', () => {
    const benchAssignment = { id: 77, role: 'bench', position: 1, signupId: departedSignup.id, eventId: EVENT_ID };

    function setupWithSlotConfig(slotConfig: unknown, existingAssignments: unknown[]) {
      const event = createMockEvent({
        id: EVENT_ID,
        creatorId: 5,
        title: 'Test Event',
        slotConfig,
      });

      mockDb._limitResults.push(
        [departedSignup],    // departed signup found
        [benchAssignment],   // tryRosterReassignment: bench assignment lookup
        [event],             // tryRosterReassignment: event select
        [event],             // handlePriorityRejoin: event for notification
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
      const mmoSlotConfig = {
        type: 'mmo',
        roles: [
          { role: 'tank', count: 1 },
          { role: 'healer', count: 1 },
        ],
      };
      // All slots occupied (excluding bench assignment)
      const existingAssignments = [
        { id: 1, role: 'tank', position: 1, signupId: 99 },
        { id: 2, role: 'healer', position: 1, signupId: 100 },
        benchAssignment,
      ];
      setupWithSlotConfig(mmoSlotConfig, existingAssignments);

      await service.onMemberRejoin(EVENT_ID, DISCORD_USER_ID);

      // Stays on bench — notification says bench/unassigned
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('bench/unassigned'),
        }),
      );
    });

    it('moves from bench to first available MMO role slot when one is free', async () => {
      const mmoSlotConfig = {
        type: 'mmo',
        roles: [
          { role: 'tank', count: 2 },
          { role: 'dps', count: 3 },
        ],
      };
      // tank:1 occupied, tank:2 is free
      const existingAssignments = [
        { id: 1, role: 'tank', position: 1, signupId: 99 },
        benchAssignment,
      ];
      setupWithSlotConfig(mmoSlotConfig, existingAssignments);

      await service.onMemberRejoin(EVENT_ID, DISCORD_USER_ID);

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'tank', position: 2 }),
      );
    });

    it('moves from bench to first available generic player slot for non-MMO events', async () => {
      const genericSlotConfig = { maxPlayers: 3 };
      // player:1 occupied, player:2 is free
      const existingAssignments = [
        { id: 1, role: 'player', position: 1, signupId: 99 },
        benchAssignment,
      ];
      setupWithSlotConfig(genericSlotConfig, existingAssignments);

      await service.onMemberRejoin(EVENT_ID, DISCORD_USER_ID);

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'player', position: 2 }),
      );
    });

    it('stays on bench when event has no slot config', async () => {
      setupWithSlotConfig(null, [benchAssignment]);

      await service.onMemberRejoin(EVENT_ID, DISCORD_USER_ID);

      // Status still reset to signed_up
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('bench/unassigned'),
        }),
      );
    });

    it('includes slot info in notification when slot was assigned', async () => {
      const mmoSlotConfig = {
        type: 'mmo',
        roles: [{ role: 'healer', count: 1 }],
      };
      setupWithSlotConfig(mmoSlotConfig, [benchAssignment]); // healer:1 free

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
      // Only one dps slot, currently empty — returning member gets it
      const mmoSlotConfig = {
        type: 'mmo',
        roles: [{ role: 'dps', count: 1 }],
      };
      setupWithSlotConfig(mmoSlotConfig, [benchAssignment]);

      await service.onMemberRejoin(EVENT_ID, DISCORD_USER_ID);

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'dps', position: 1 }),
      );
    });
  });

  // ─── findActiveSignup: discord ID vs RL user fallback ─────────────────────

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

      mockDb._limitResults.push(
        [scheduledEvent],
        [],           // no direct discord match
        [rlUser],     // user found
        [linkedSignup], // signup via userId
      );

      await service.onMemberLeave(EVENT_ID, DISCORD_USER_ID);

      expect(mockGraceQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ signupId: linkedSignup.id }),
        expect.any(Number),
      );
    });

    it('skips grace timer when RL user has no signup for the event', async () => {
      const rlUser = createMockUser({ id: 7, discordId: DISCORD_USER_ID });

      mockDb._limitResults.push(
        [scheduledEvent],
        [],         // no direct discord match
        [rlUser],
        [],         // no signup via userId
      );

      await service.onMemberLeave(EVENT_ID, DISCORD_USER_ID);

      expect(mockGraceQueue.enqueue).not.toHaveBeenCalled();
    });
  });
});
