/**
 * Unit tests for SchedulingService (ROK-965).
 * Uses flat drizzle-mock; controls results via terminal methods.
 */
import { Test } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { SchedulingService } from './scheduling.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import { EventsService } from '../../events/events.service';
import { LineupNotificationService } from '../lineup-notification.service';
import { SchedulingPollEmbedService } from './scheduling-poll-embed.service';
import { SchedulingUnanimousService } from './scheduling-unanimous.service';
import { SignupsService } from '../../events/signups.service';
import { NotificationService } from '../../notifications/notification.service';

jest.mock('../lineups-notify-hooks.helpers', () => ({
  fireEventCreated: jest.fn(),
}));
jest.mock('./scheduling-auto-signup.helpers', () => ({
  autoSignupSlotVoters: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./scheduling-auto-heart.helpers', () => ({
  insertPollInterests: jest.fn().mockResolvedValue(undefined),
  // ROK-1610: the lock-in path hearts the slot's voters; unmocked it is a
  // real DB write inside a unit spec.
  fireAutoHeartForVoters: jest.fn(),
}));
jest.mock('./scheduling-query.helpers', () => ({
  ...jest.requireActual('./scheduling-query.helpers'),
  findScheduleVotes: jest.fn().mockResolvedValue([]),
  findScheduleSlots: jest.fn().mockResolvedValue([]),
  countUniqueVoters: jest.fn().mockResolvedValue(0),
}));
jest.mock('../lineups-match-query.helpers', () => ({
  ...jest.requireActual('../lineups-match-query.helpers'),
  findMatchMembers: jest.fn().mockResolvedValue([]),
}));
jest.mock('./scheduling-event.helpers', () => ({
  ...jest.requireActual('./scheduling-event.helpers'),
  resolveGameInfo: jest
    .fn()
    .mockResolvedValue({ gameName: 'Test Game', gameCoverUrl: null }),
  // ROK-1219: assertUserHasVoted moved out of the service into this helper.
  assertUserHasVoted: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./scheduling-conflict.helpers', () => ({
  ...jest.requireActual('./scheduling-conflict.helpers'),
  findSlotConflicts: jest.fn().mockResolvedValue([]),
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const queryHelpers =
  require('./scheduling-query.helpers') as typeof import('./scheduling-query.helpers');
const eventHelpers =
  require('./scheduling-event.helpers') as typeof import('./scheduling-event.helpers');
/* eslint-enable @typescript-eslint/no-require-imports */

const SCHEDULING_MATCH = {
  id: 10,
  lineupId: 1,
  gameId: 5,
  status: 'scheduling',
  linkedEventId: null,
  // ROK-1302: findMatchById joins the parent lineup's scheduling opt-out flag.
  includeSchedulingPhase: true,
};
const SLOT_TIME = '2099-04-01T19:00:00.000Z';
const GAME_ROW = { name: 'Test Game', coverUrl: null };
/** Slot row for toggleVote's slot↔match validation (findSlotOrThrow). */
const SLOT_ROW = { id: 5, matchId: 10 };
/** Lineup row consumed by assertCallerMayVote (public → gate passes). */
const LINEUP_VIS_ROW = { id: 1, createdBy: 999, visibility: 'public' };
/**
 * Lineup meta row consumed by `assertMayLockInSlot` → `findLineupPollMeta`
 * (ROK-1610). Not archived and no phase deadline, so the poll reads OPEN and
 * lock-in keeps the pre-existing "you must have voted" gate rather than the
 * expired-poll organiser gate.
 */
const LINEUP_POLL_META_ROW = {
  id: 1,
  status: 'decided',
  visibility: 'public',
  createdBy: 999,
  phaseDeadline: null,
  includeSchedulingPhase: true,
  phaseDurationOverride: null,
};
/**
 * Row that satisfies findMatchOrThrow, assertCallerMayVote, AND
 * findSlotOrThrow when a test uses a non-once
 * `mockDb.limit.mockResolvedValue` for alternating calls: carries the match
 * fields plus a `matchId` pointing at itself; its missing `visibility`
 * field reads as not-private, so the participation gate passes.
 */
const MATCH_AND_SLOT_ROW = { ...SCHEDULING_MATCH, matchId: 10 };

describe('SchedulingService', () => {
  let service: SchedulingService;
  let mockDb: MockDb;
  let mockEventsService: { create: jest.Mock };

  beforeEach(async () => {
    mockDb = createDrizzleMock();
    mockEventsService = { create: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        SchedulingService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        { provide: EventsService, useValue: mockEventsService },
        { provide: SignupsService, useValue: { signup: jest.fn() } },
        {
          provide: LineupNotificationService,
          useValue: { notifyEventCreated: jest.fn() },
        },
        {
          provide: SchedulingPollEmbedService,
          useValue: {
            firePostInitialEmbed: jest.fn(),
            fireUpdateEmbed: jest.fn(),
          },
        },
        {
          provide: NotificationService,
          useValue: { createMany: jest.fn().mockResolvedValue([]) },
        },
        // ROK-1632 AC3: the post-commit "everyone's in" hook.
        {
          provide: SchedulingUnanimousService,
          useValue: { checkMatch: jest.fn().mockResolvedValue(0) },
        },
      ],
    }).compile();

    service = module.get(SchedulingService);
  });

  describe('suggestSlot', () => {
    it('inserts a slot and returns its id', async () => {
      // findMatchOrThrow
      mockDb.limit.mockResolvedValueOnce([SCHEDULING_MATCH]);
      // assertNoDuplicateSlot
      mockDb.limit.mockResolvedValueOnce([]);
      // insertScheduleSlot
      mockDb.returning.mockResolvedValueOnce([{ id: 42 }]);

      const result = await service.suggestSlot(10, SLOT_TIME);
      expect(result).toMatchObject({ id: 42 });
    });

    it('throws NotFoundException for missing match', async () => {
      mockDb.limit.mockResolvedValueOnce([]);
      await expect(service.suggestSlot(999, SLOT_TIME)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException for archived match', async () => {
      mockDb.limit.mockResolvedValueOnce([
        { ...SCHEDULING_MATCH, status: 'archived' },
      ]);
      await expect(service.suggestSlot(10, SLOT_TIME)).rejects.toThrow(
        BadRequestException,
      );
    });

    describe('auto-vote', () => {
      let voteSpy: jest.SpyInstance;

      beforeEach(() => {
        voteSpy = jest.spyOn(queryHelpers, 'insertScheduleVote');
      });

      afterEach(() => {
        voteSpy.mockRestore();
      });

      function mockSuggestSlotFlow(withUser = false) {
        mockDb.limit.mockResolvedValueOnce([SCHEDULING_MATCH]);
        // assertCallerMayVote only runs for authed suggesters
        if (withUser) mockDb.limit.mockResolvedValueOnce([LINEUP_VIS_ROW]);
        mockDb.limit.mockResolvedValueOnce([]);
        mockDb.returning.mockResolvedValueOnce([{ id: 42 }]);
      }

      it('calls insertScheduleVote when userId is provided', async () => {
        mockSuggestSlotFlow(true);
        voteSpy.mockResolvedValueOnce([{ id: 1 }]);
        await service.suggestSlot(10, SLOT_TIME, 7);
        // ROK-1550: an un-sourced suggestion is a web vote, as it always was.
        expect(voteSpy).toHaveBeenCalledWith(mockDb, 42, 7, 'yes', 'web');
      });

      // ROK-1550 review fix: the auto-vote inherits the SUGGESTION's source,
      // so a "find a better time" off the Discord card counts as a discord
      // vote instead of silently inflating the web tally.
      it('stamps the auto-vote with the suggestion source', async () => {
        mockSuggestSlotFlow(true);
        voteSpy.mockResolvedValueOnce([{ id: 1 }]);
        await service.suggestSlot(10, SLOT_TIME, 7, undefined, 'discord');
        expect(voteSpy).toHaveBeenCalledWith(mockDb, 42, 7, 'yes', 'discord');
      });

      it('succeeds even if auto-vote throws', async () => {
        mockSuggestSlotFlow(true);
        voteSpy.mockRejectedValueOnce(new Error('DB constraint'));
        const result = await service.suggestSlot(10, SLOT_TIME, 7);
        expect(result).toMatchObject({ id: 42 });
      });

      it('does not call insertScheduleVote when userId is undefined', async () => {
        mockSuggestSlotFlow();
        await service.suggestSlot(10, SLOT_TIME);
        expect(voteSpy).not.toHaveBeenCalled();
      });
    });
  });

  describe('toggleVote', () => {
    it('creates a vote when none exists and enrolls the voter as a member', async () => {
      // findMatchOrThrow
      mockDb.limit.mockResolvedValueOnce([SCHEDULING_MATCH]);
      // assertCallerMayVote — public lineup
      mockDb.limit.mockResolvedValueOnce([LINEUP_VIS_ROW]);
      // findSlotOrThrow — slot belongs to the URL's match
      mockDb.limit.mockResolvedValueOnce([SLOT_ROW]);
      // insertScheduleVote returns inserted row (new vote)
      mockDb.returning.mockResolvedValueOnce([
        { id: 1, slotId: 5, userId: 10 },
      ]);

      const result = await service.toggleVote(5, 10, 10);
      expect(result).toEqual({ voted: true, stance: 'yes' });
      // Open-roster enrollment: voting inserts a match-member row.
      // 'bandwagon' — joined after the decide-time snapshot, not a
      // game-phase voter (DecidedView counts 'voted' against totalVoters).
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          matchId: 10,
          userId: 10,
          source: 'bandwagon',
        }),
      );
    });

    it('removes existing vote on toggle off without touching membership', async () => {
      // findMatchOrThrow
      mockDb.limit.mockResolvedValueOnce([SCHEDULING_MATCH]);
      // assertCallerMayVote — public lineup
      mockDb.limit.mockResolvedValueOnce([LINEUP_VIS_ROW]);
      // findSlotOrThrow
      mockDb.limit.mockResolvedValueOnce([SLOT_ROW]);
      // insertScheduleVote returns [] (ON CONFLICT — vote already exists)
      mockDb.returning.mockResolvedValueOnce([]);
      // ROK-1617: the conflict means a row is already on record. The stance
      // read that follows it returns that row, and a pre-stance row is a yes.
      mockDb.limit.mockResolvedValueOnce([{ id: 1, stance: 'yes' }]);

      const result = await service.toggleVote(5, 10, 10);
      expect(result).toEqual({ voted: false, stance: null });
      expect(mockDb.values).not.toHaveBeenCalledWith(
        expect.objectContaining({ source: 'bandwagon' }),
      );
    });

    /**
     * ROK-1543 P2-1: the `scheduling_submitted_at` stamp must commit with the
     * vote. Records how much of the write happened before the transaction
     * callback returned — a stamp (or withdrawal delete) issued after the tx
     * closes would leave the counters at 0 and 500 a request whose vote
     * already committed.
     */
    function captureTxWork(): { executes: number; deletes: number } {
      const seen = { executes: 0, deletes: 0 };
      mockDb.transaction.mockImplementationOnce(
        async (cb: (tx: MockDb) => Promise<unknown>) => {
          const result = await cb(mockDb);
          seen.executes = mockDb.execute.mock.calls.length;
          seen.deletes = mockDb.delete.mock.calls.length;
          return result;
        },
      );
      return seen;
    }

    it('stamps scheduling_submitted_at INSIDE the vote transaction', async () => {
      mockDb.limit.mockResolvedValueOnce([SCHEDULING_MATCH]);
      mockDb.limit.mockResolvedValueOnce([LINEUP_VIS_ROW]);
      mockDb.limit.mockResolvedValueOnce([SLOT_ROW]);
      mockDb.returning.mockResolvedValueOnce([
        { id: 1, slotId: 5, userId: 10 },
      ]);
      const seen = captureTxWork();

      await expect(service.toggleVote(5, 10, 10)).resolves.toEqual({
        voted: true,
        stance: 'yes',
      });
      expect(seen.executes).toBe(1);
      expect(mockDb.execute).toHaveBeenCalledTimes(seen.executes);
    });

    it('withdraws the vote AND clears the stamp inside one transaction', async () => {
      mockDb.limit.mockResolvedValueOnce([SCHEDULING_MATCH]);
      mockDb.limit.mockResolvedValueOnce([LINEUP_VIS_ROW]);
      mockDb.limit.mockResolvedValueOnce([SLOT_ROW]);
      // ON CONFLICT DO NOTHING → the vote already existed, so this tap withdraws.
      mockDb.returning.mockResolvedValueOnce([]);
      // ROK-1617: the conflict means a row is already on record. The stance
      // read that follows it returns that row, and a pre-stance row is a yes.
      mockDb.limit.mockResolvedValueOnce([{ id: 1, stance: 'yes' }]);
      const seen = captureTxWork();

      await expect(service.toggleVote(5, 10, 10)).resolves.toEqual({
        voted: false,
        stance: null,
      });
      expect(seen.deletes).toBe(1);
      expect(seen.executes).toBe(1);
      expect(mockDb.delete).toHaveBeenCalledTimes(seen.deletes);
    });

    it('rejects a slot that belongs to a different match', async () => {
      // findMatchOrThrow
      mockDb.limit.mockResolvedValueOnce([SCHEDULING_MATCH]);
      // assertCallerMayVote — public lineup
      mockDb.limit.mockResolvedValueOnce([LINEUP_VIS_ROW]);
      // findSlotOrThrow — slot exists but under another match
      mockDb.limit.mockResolvedValueOnce([{ id: 5, matchId: 99 }]);

      await expect(service.toggleVote(5, 10, 10)).rejects.toThrow(
        NotFoundException,
      );
      // Neither the vote nor a member row was written.
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('rejects a non-invitee vote on a private lineup', async () => {
      // findMatchOrThrow
      mockDb.limit.mockResolvedValueOnce([SCHEDULING_MATCH]);
      // assertCallerMayVote — private lineup, caller is not the creator
      mockDb.limit.mockResolvedValueOnce([
        { id: 1, createdBy: 999, visibility: 'private' },
      ]);
      // isInvitee — no invitee row
      mockDb.limit.mockResolvedValueOnce([]);

      await expect(service.toggleVote(5, 10, 10, 'member')).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('throws BadRequestException for non-scheduling match', async () => {
      mockDb.limit.mockResolvedValueOnce([
        { ...SCHEDULING_MATCH, status: 'scheduled' },
      ]);
      await expect(service.toggleVote(5, 10, 10)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('createEventFromSlot', () => {
    /** Mock the full happy-path sequence for createEventFromSlot. */
    function mockCreateEventFlow() {
      // Bypass voter check (tested separately)
      (eventHelpers.assertUserHasVoted as jest.Mock).mockResolvedValueOnce(
        undefined,
      );
      // 1. findMatchOrThrow
      mockDb.limit.mockResolvedValueOnce([SCHEDULING_MATCH]);
      // 2. findSlotOrThrow
      mockDb.limit.mockResolvedValueOnce([
        { id: 20, matchId: 10, proposedTime: SLOT_TIME },
      ]);
      // 3. assertMayLockInSlot → findLineupPollMeta (ROK-1610)
      mockDb.limit.mockResolvedValueOnce([LINEUP_POLL_META_ROW]);
      // 4. resolveGameName → resolveGameInfo
      mockDb.limit.mockResolvedValueOnce([GAME_ROW]);
      // 5. eventsService.create
      mockEventsService.create.mockResolvedValueOnce({ id: 100 });
    }

    it('throws when match already has linked event', async () => {
      mockDb.limit.mockResolvedValueOnce([
        { ...SCHEDULING_MATCH, linkedEventId: 50 },
      ]);
      await expect(service.createEventFromSlot(10, 20, 1)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException for missing match', async () => {
      mockDb.limit.mockResolvedValueOnce([]);
      await expect(service.createEventFromSlot(999, 20, 1)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when user has not voted', async () => {
      (eventHelpers.assertUserHasVoted as jest.Mock).mockRejectedValueOnce(
        new ForbiddenException(
          'You must vote on a slot before creating an event',
        ),
      );
      // findMatchOrThrow, findSlotOrThrow, then the lock-in gate's lineup meta
      // read (ROK-1610) — an OPEN poll, so the voted check is what refuses.
      mockDb.limit.mockResolvedValueOnce([SCHEDULING_MATCH]);
      mockDb.limit.mockResolvedValueOnce([
        { id: 20, matchId: 10, proposedTime: SLOT_TIME },
      ]);
      mockDb.limit.mockResolvedValueOnce([LINEUP_POLL_META_ROW]);
      await expect(service.createEventFromSlot(10, 20, 1)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('passes recurrence to EventsService when recurring is true', async () => {
      mockCreateEventFlow();
      await service.createEventFromSlot(10, 20, 1, true);
      expect(mockEventsService.create).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          recurrence: expect.objectContaining({ frequency: 'weekly' }),
        }),
      );
    });

    it('sets recurrence.until to exactly 28 days after slot time', async () => {
      const FOUR_WEEKS_MS = 4 * 7 * 24 * 60 * 60 * 1000;
      const expectedUntil = new Date(
        new Date(SLOT_TIME).getTime() + FOUR_WEEKS_MS,
      ).toISOString();
      mockCreateEventFlow();
      await service.createEventFromSlot(10, 20, 1, true);
      const dto = mockEventsService.create.mock.calls[0][1];
      expect(dto.recurrence.until).toBe(expectedUntil);
    });

    it('does not pass recurrence when recurring is false', async () => {
      mockCreateEventFlow();
      await service.createEventFromSlot(10, 20, 1, false);
      const dto = mockEventsService.create.mock.calls[0][1];
      expect(dto.recurrence).toBeUndefined();
    });

    it('omits recurrence when recurring param is not provided', async () => {
      mockCreateEventFlow();
      await service.createEventFromSlot(10, 20, 1);
      const dto = mockEventsService.create.mock.calls[0][1];
      expect(dto.recurrence).toBeUndefined();
    });

    it('returns the created event id', async () => {
      mockCreateEventFlow();
      const result = await service.createEventFromSlot(10, 20, 1);
      expect(result).toEqual({ eventId: 100 });
    });
  });

  describe('toggleVote — race condition (ROK-1017)', () => {
    let insertVoteSpy: jest.SpyInstance;
    let deleteVoteSpy: jest.SpyInstance;

    beforeEach(() => {
      insertVoteSpy = jest.spyOn(queryHelpers, 'insertScheduleVote');
      deleteVoteSpy = jest.spyOn(queryHelpers, 'deleteScheduleVote');
    });

    afterEach(() => {
      insertVoteSpy.mockRestore();
      deleteVoteSpy.mockRestore();
    });

    it('AC1: concurrent votes for same slot+user do not throw', async () => {
      // First insert succeeds (new row), second returns [] (ON CONFLICT)
      insertVoteSpy
        .mockResolvedValueOnce([{ id: 1, slotId: 5, userId: 10 }])
        .mockResolvedValueOnce([]);
      deleteVoteSpy.mockResolvedValue(undefined);
      // findMatchOrThrow AND findSlotOrThrow must succeed for both calls
      mockDb.limit.mockResolvedValue([MATCH_AND_SLOT_ROW]);

      // Fire two concurrent toggleVote calls for the same slot+user.
      // ON CONFLICT DO NOTHING returns [] — no throw.
      const results = await Promise.all([
        service.toggleVote(5, 10, 10),
        service.toggleVote(5, 10, 10),
      ]);

      // Both should resolve without error
      expect(results).toHaveLength(2);
      results.forEach((r) => {
        expect(r).toMatchObject({ voted: expect.any(Boolean) });
      });
    });

    it('AC5: vote toggle cycle works — vote then unvote', async () => {
      // First call: insert succeeds (new row) → voted: true
      mockDb.limit.mockResolvedValueOnce([SCHEDULING_MATCH]);
      mockDb.limit.mockResolvedValueOnce([LINEUP_VIS_ROW]);
      mockDb.limit.mockResolvedValueOnce([SLOT_ROW]);
      insertVoteSpy.mockResolvedValueOnce([{ id: 1, slotId: 5, userId: 10 }]);

      const voteResult = await service.toggleVote(5, 10, 10);
      expect(voteResult).toEqual({ voted: true, stance: 'yes' });

      // Second call: insert returns [] (conflict) → delete → voted: false
      mockDb.limit.mockResolvedValueOnce([SCHEDULING_MATCH]);
      mockDb.limit.mockResolvedValueOnce([LINEUP_VIS_ROW]);
      mockDb.limit.mockResolvedValueOnce([SLOT_ROW]);
      insertVoteSpy.mockResolvedValueOnce([]);
      deleteVoteSpy.mockResolvedValueOnce(undefined);
      // ROK-1617: the conflict means a row is already on record. The stance
      // read that follows it returns that row, and a pre-stance row is a yes.
      mockDb.limit.mockResolvedValueOnce([{ id: 1, stance: 'yes' }]);

      const unvoteResult = await service.toggleVote(5, 10, 10);
      expect(unvoteResult).toEqual({ voted: false, stance: null });
    });

    it('AC1: repeated vote on already-voted slot is idempotent', async () => {
      // First insert succeeds, second returns [] (ON CONFLICT)
      insertVoteSpy
        .mockResolvedValueOnce([{ id: 1, slotId: 5, userId: 10 }])
        .mockResolvedValueOnce([]);
      deleteVoteSpy.mockResolvedValue(undefined);
      mockDb.limit.mockResolvedValue([MATCH_AND_SLOT_ROW]);

      // Idempotency: calling vote twice should not throw
      const first = await service.toggleVote(5, 10, 10);
      expect(first).toEqual({ voted: true, stance: 'yes' });

      // Second call handles conflict gracefully — toggles off
      await expect(service.toggleVote(5, 10, 10)).resolves.toMatchObject({
        voted: expect.any(Boolean),
      });
    });
  });

  describe('retractAllVotes', () => {
    it('calls delete for matching match and user', async () => {
      mockDb.limit.mockResolvedValueOnce([SCHEDULING_MATCH]);
      const result = await service.retractAllVotes(10, 1);
      expect(result).toBeUndefined();
    });

    it('throws for non-scheduling match', async () => {
      mockDb.limit.mockResolvedValueOnce([
        { ...SCHEDULING_MATCH, status: 'archived' },
      ]);
      await expect(service.retractAllVotes(10, 1)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ROK-1194 item 4: pin the community_lineups.created_by join wired through
  // getSchedulePoll → buildPollResponse so future refactors don't accidentally
  // drop lineupCreatedById on the way to the response DTO.
  describe('getSchedulePoll lineupCreatedById', () => {
    const FULL_MATCH = {
      ...SCHEDULING_MATCH,
      thresholdMet: false,
      voteCount: 0,
      votePercentage: null,
      fitType: null,
      minVoteThreshold: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    it('passes lineupCreatedById from the lineup join into the response', async () => {
      // 1. findMatchOrThrow
      mockDb.limit.mockResolvedValueOnce([FULL_MATCH]);
      // 2. lineup status + createdBy join (the row under test)
      mockDb.limit.mockResolvedValueOnce([
        { status: 'decided', createdBy: 42 },
      ]);
      // 3. follow-up source lookup — no sentinel row for an ordinary poll
      mockDb.limit.mockResolvedValueOnce([]);

      const result = await service.getSchedulePoll(
        SCHEDULING_MATCH.lineupId,
        10,
        null,
      );
      expect(result.match.lineupCreatedById).toBe(42);
    });

    it('omits lineupCreatedById when lineup row is missing', async () => {
      // 1. findMatchOrThrow
      mockDb.limit.mockResolvedValueOnce([FULL_MATCH]);
      // 2. lineup join returns no rows
      mockDb.limit.mockResolvedValueOnce([]);
      // 3. follow-up source lookup — no sentinel row for an ordinary poll
      mockDb.limit.mockResolvedValueOnce([]);

      const result = await service.getSchedulePoll(
        SCHEDULING_MATCH.lineupId,
        10,
        null,
      );
      // buildPollResponse → buildMatchDetailDto omits the field when null,
      // so the contract DTO surfaces it as undefined rather than null.
      expect(result.match.lineupCreatedById).toBeUndefined();
    });
  });

  // ROK-1306: route guard prevents serving a poll from one lineup under another
  // lineup's URL (which would surface the wrong game's poll on the page).
  describe('getSchedulePoll cross-lineup guard', () => {
    const FULL_MATCH = {
      ...SCHEDULING_MATCH,
      thresholdMet: false,
      voteCount: 0,
      votePercentage: null,
      fitType: null,
      minVoteThreshold: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    it('throws NotFoundException when matchId belongs to a different lineup', async () => {
      // findMatchOrThrow returns the match — but its lineupId is 1, and the
      // request URL claims lineupId 999. Service must reject before any
      // further DB work.
      mockDb.limit.mockResolvedValueOnce([FULL_MATCH]);
      await expect(
        service.getSchedulePoll(999, FULL_MATCH.id, null),
      ).rejects.toThrow(NotFoundException);
    });

    it('still 404s when the match is missing entirely (existing behaviour)', async () => {
      mockDb.limit.mockResolvedValueOnce([]);
      await expect(service.getSchedulePoll(1, 99999, null)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
