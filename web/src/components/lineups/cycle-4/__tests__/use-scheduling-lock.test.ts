/**
 * useSchedulingLock commit-branch tests.
 *
 * Regression for the linked-poll lock bug: `completeStandalonePoll` must
 * receive the linked event id + the locked slot's start instant, otherwise
 * the backend's eventId-gated auto-signup/re-roster pass never runs and
 * poll voters are not rostered onto the rescheduled event (ROK-1031).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type {
    MatchDetailResponseDto,
    ScheduleSlotWithVotesDto,
} from '@raid-ledger/contract';

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
    const actual =
        await vi.importActual<typeof import('react-router-dom')>(
            'react-router-dom',
        );
    return { ...actual, useNavigate: () => navigate };
});

const rescheduleMutate = vi.fn();
vi.mock('../../../../hooks/use-reschedule', () => ({
    useRescheduleEvent: () => ({ mutate: rescheduleMutate, isPending: false }),
}));

vi.mock('../../../../lib/api-client', () => ({
    completeStandalonePoll: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../lib/toast', () => ({
    toast: { success: vi.fn(), error: vi.fn() },
}));

import { completeStandalonePoll } from '../../../../lib/api-client';
import { toast } from '../../../../lib/toast';
import { useSchedulingLock } from '../use-scheduling-lock';

const MATCH_ID = 500;
const FUTURE_TIME = '2035-06-10T20:00:00.000Z';

/** Two members → required voters = 2; slots below carry 2 distinct votes so
 *  requestLock commits directly (no early-lock confirm modal). */
function buildMember(
    userId: number,
): MatchDetailResponseDto['members'][number] {
    return {
        id: userId * 10,
        matchId: MATCH_ID,
        userId,
        source: 'voted',
        createdAt: '2026-05-15T00:00:00.000Z',
        displayName: `User ${userId}`,
        avatar: null,
        discordId: null,
        customAvatarUrl: null,
        schedulingSubmittedAt: null,
    };
}

function buildMatch(
    overrides: Partial<MatchDetailResponseDto> = {},
): MatchDetailResponseDto {
    return {
        id: MATCH_ID,
        lineupId: 7,
        gameId: 42,
        status: 'scheduling',
        thresholdMet: true,
        voteCount: 3,
        votePercentage: 60,
        fitType: 'normal',
        linkedEventId: null,
        minVoteThreshold: 2,
        thresholdNotifiedAt: null,
        createdAt: '2026-05-15T00:00:00.000Z',
        updatedAt: '2026-05-15T00:00:00.000Z',
        gameName: 'Valheim',
        gameCoverUrl: null,
        lineupCreatedById: 1,
        members: [buildMember(1), buildMember(2)],
        ...overrides,
    };
}

function buildSlot(proposedTime = FUTURE_TIME): ScheduleSlotWithVotesDto {
    const vote = (userId: number) => ({
        userId,
        displayName: `User ${userId}`,
        avatar: null,
        discordId: null,
        customAvatarUrl: null,
    });
    return {
        id: 1001,
        matchId: MATCH_ID,
        proposedTime,
        overlapScore: 0.8,
        suggestedBy: 'system',
        createdAt: '2026-05-16T00:00:00.000Z',
        votes: [vote(1), vote(2)],
    };
}

describe('useSchedulingLock — commit', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('linked-event lock completes the poll with eventId + slot start instant', () => {
        rescheduleMutate.mockImplementationOnce((_vars, opts) =>
            opts?.onSuccess?.(),
        );
        const { result } = renderHook(() =>
            useSchedulingLock(buildMatch({ linkedEventId: 77 }), MATCH_ID),
        );

        act(() => result.current.requestLock(buildSlot()));

        expect(rescheduleMutate).toHaveBeenCalledWith(
            {
                startTime: FUTURE_TIME,
                endTime: new Date(
                    new Date(FUTURE_TIME).getTime() + 2 * 60 * 60 * 1000,
                ).toISOString(),
            },
            expect.objectContaining({ onSuccess: expect.any(Function) }),
        );
        expect(completeStandalonePoll).toHaveBeenCalledWith(
            MATCH_ID,
            77,
            FUTURE_TIME,
        );
        // Backend matches startTime to a slot via Date-getTime equality.
        const [, , startTime] = vi.mocked(completeStandalonePoll).mock
            .calls[0];
        expect(new Date(startTime!).getTime()).toBe(
            new Date(FUTURE_TIME).getTime(),
        );
        expect(toast.success).toHaveBeenCalledWith('Event rescheduled');
        expect(navigate).not.toHaveBeenCalled();
    });

    it('does not complete the poll until reschedule succeeds', () => {
        const { result } = renderHook(() =>
            useSchedulingLock(buildMatch({ linkedEventId: 77 }), MATCH_ID),
        );

        act(() => result.current.requestLock(buildSlot()));

        expect(rescheduleMutate).toHaveBeenCalledTimes(1);
        expect(completeStandalonePoll).not.toHaveBeenCalled();
    });

    it('non-linked lock navigates to /events/new and does NOT complete', () => {
        const { result } = renderHook(() =>
            useSchedulingLock(buildMatch(), MATCH_ID),
        );

        act(() => result.current.requestLock(buildSlot()));

        const params = new URLSearchParams();
        params.set('gameId', '42');
        params.set('startTime', FUTURE_TIME);
        params.set('matchId', String(MATCH_ID));
        expect(navigate).toHaveBeenCalledWith(
            `/events/new?${params.toString()}`,
        );
        expect(completeStandalonePoll).not.toHaveBeenCalled();
        expect(rescheduleMutate).not.toHaveBeenCalled();
    });

    it('past-time slot aborts with a toast and calls nothing', () => {
        const { result } = renderHook(() =>
            useSchedulingLock(buildMatch({ linkedEventId: 77 }), MATCH_ID),
        );

        act(() =>
            result.current.requestLock(buildSlot('2020-01-01T00:00:00.000Z')),
        );

        expect(toast.error).toHaveBeenCalledWith(
            'Cannot lock a time in the past',
        );
        expect(rescheduleMutate).not.toHaveBeenCalled();
        expect(completeStandalonePoll).not.toHaveBeenCalled();
        expect(navigate).not.toHaveBeenCalled();
    });
});
