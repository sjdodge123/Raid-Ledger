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
import { SignupsService } from '../../events/signups.service';

jest.mock('../lineups-notify-hooks.helpers', () => ({
  fireEventCreated: jest.fn(),
}));
jest.mock('./scheduling-auto-signup.helpers', () => ({
  autoSignupSlotVoters: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./scheduling-auto-heart.helpers', () => ({
  insertPollInterests: jest.fn().mockResolvedValue(undefined),
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
}));
jest.mock('./scheduling-conflict.helpers', () => ({
  ...jest.requireActual('./scheduling-conflict.helpers'),
  findConflictingSlotIds: jest.fn().mockResolvedValue([]),
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const queryHelpers =
  require('./scheduling-query.helpers') as typeof import('./scheduling-query.helpers');
/* eslint-enable @typescript-eslint/no-require-imports */

const SCHEDULING_MATCH = {
  id: 10,
  lineupId: 1,
  gameId: 5,
  status: 'scheduling',
  linkedEventId: null,
};
const SLOT_TIME = '2099-04-01T19:00:00.000Z';
const GAME_ROW = { name: 'Test Game', coverUrl: null };

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

      function mockSuggestSlotFlow() {
        mockDb.limit.mockResolvedValueOnce([SCHEDULING_MATCH]);
        mockDb.limit.mockResolvedValueOnce([]);
        mockDb.returning.mockResolvedValueOnce([{ id: 42 }]);
      }

      it('calls insertScheduleVote when userId is provided', async () => {
        mockSuggestSlotFlow();
        voteSpy.mockResolvedValueOnce([{ id: 1 }]);
        await service.suggestSlot(10, SLOT_TIME, 7);
        expect(voteSpy).toHaveBeenCalledWith(mockDb, 42, 7);
      });

      it('succeeds even if auto-vote throws', async () => {
        mockSuggestSlotFlow();
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
    it('creates a vote when none exists', async () => {
      // findMatchOrThrow
      mockDb.limit.mockResolvedValueOnce([SCHEDULING_MATCH]);
      // insertScheduleVote returns inserted row (new vote)
      mockDb.returning.mockResolvedValueOnce([
        { id: 1, slotId: 5, userId: 10 },
      ]);

      const result = await service.toggleVote(5, 10, 10);
      expect(result).toEqual({ voted: true });
    });

    it('removes existing vote on toggle off', async () => {
      // findMatchOrThrow
      mockDb.limit.mockResolvedValueOnce([SCHEDULING_MATCH]);
      // insertScheduleVote returns [] (ON CONFLICT — vote already exists)
      mockDb.returning.mockResolvedValueOnce([]);

      const result = await service.toggleVote(5, 10, 10);
      expect(result).toEqual({ voted: false });
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

      jest
        .spyOn(service as any, 'assertUserHasVoted')
        .mockResolvedValueOnce(undefined);
      // 1. findMatchOrThrow
      mockDb.limit.mockResolvedValueOnce([SCHEDULING_MATCH]);
      // 2. findSlotOrThrow
      mockDb.limit.mockResolvedValueOnce([
        { id: 20, matchId: 10, proposedTime: SLOT_TIME },
      ]);
      // 3. resolveGameName → resolveGameInfo
      mockDb.limit.mockResolvedValueOnce([GAME_ROW]);
      // 4. eventsService.create
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
      jest
        .spyOn(service as any, 'assertUserHasVoted')
        .mockRejectedValueOnce(
          new ForbiddenException(
            'You must vote on a slot before creating an event',
          ),
        );
      mockDb.limit.mockResolvedValueOnce([SCHEDULING_MATCH]);
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
      // findMatchOrThrow must succeed for both calls
      mockDb.limit.mockResolvedValue([SCHEDULING_MATCH]);

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
      insertVoteSpy.mockResolvedValueOnce([{ id: 1, slotId: 5, userId: 10 }]);

      const voteResult = await service.toggleVote(5, 10, 10);
      expect(voteResult).toEqual({ voted: true });

      // Second call: insert returns [] (conflict) → delete → voted: false
      mockDb.limit.mockResolvedValueOnce([SCHEDULING_MATCH]);
      insertVoteSpy.mockResolvedValueOnce([]);
      deleteVoteSpy.mockResolvedValueOnce(undefined);

      const unvoteResult = await service.toggleVote(5, 10, 10);
      expect(unvoteResult).toEqual({ voted: false });
    });

    it('AC1: repeated vote on already-voted slot is idempotent', async () => {
      // First insert succeeds, second returns [] (ON CONFLICT)
      insertVoteSpy
        .mockResolvedValueOnce([{ id: 1, slotId: 5, userId: 10 }])
        .mockResolvedValueOnce([]);
      deleteVoteSpy.mockResolvedValue(undefined);
      mockDb.limit.mockResolvedValue([SCHEDULING_MATCH]);

      // Idempotency: calling vote twice should not throw
      const first = await service.toggleVote(5, 10, 10);
      expect(first).toEqual({ voted: true });

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

      const result = await service.getSchedulePoll(10, null);
      expect(result.match.lineupCreatedById).toBe(42);
    });

    it('omits lineupCreatedById when lineup row is missing', async () => {
      // 1. findMatchOrThrow
      mockDb.limit.mockResolvedValueOnce([FULL_MATCH]);
      // 2. lineup join returns no rows
      mockDb.limit.mockResolvedValueOnce([]);

      const result = await service.getSchedulePoll(10, null);
      // buildPollResponse → buildMatchDetailDto omits the field when null,
      // so the contract DTO surfaces it as undefined rather than null.
      expect(result.match.lineupCreatedById).toBeUndefined();
    });
  });
});
