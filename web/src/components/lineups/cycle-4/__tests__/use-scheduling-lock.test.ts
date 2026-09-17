/**
 * useSchedulingLock commit-branch tests.
 *
 * Regression for the linked-poll lock bug: `completeStandalonePoll` must
 * receive the linked event id + the locked slot's start instant, otherwise
 * the backend's eventId-gated auto-signup/re-roster pass never runs and
 * poll voters are not rostered onto the rescheduled event (ROK-1031).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
    MatchDetailResponseDto,
    SchedulePollPageResponseDto,
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
    getSchedulePoll: vi.fn(),
}));

vi.mock('../../../../lib/toast', () => ({
    toast: { success: vi.fn(), error: vi.fn() },
}));

import {
    completeStandalonePoll,
    getSchedulePoll,
} from '../../../../lib/api-client';
import { toast } from '../../../../lib/toast';
import { useSchedulingLock } from '../use-scheduling-lock';

const MATCH_ID = 500;
const LINEUP_ID = 7;
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

function buildSlot(
    proposedTime = FUTURE_TIME,
    voterIds: number[] = [1, 2],
): ScheduleSlotWithVotesDto {
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
        votes: voterIds.map(vote),
    };
}

/** Poll page payload the fresh `fetchQuery` resolves with. */
function buildPoll(
    match: MatchDetailResponseDto,
    slots: ScheduleSlotWithVotesDto[],
    pollStatus: SchedulePollPageResponseDto['pollStatus'] = 'open',
): SchedulePollPageResponseDto {
    return {
        match,
        slots,
        pollStatus,
    } as unknown as SchedulePollPageResponseDto;
}

function wrapper({ children }: { children: ReactNode }) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return createElement(QueryClientProvider, { client: qc }, children);
}

/** Render the hook; the server returns `slots` (default: the same slot). */
function renderLock(
    match: MatchDetailResponseDto,
    slots: ScheduleSlotWithVotesDto[] = [buildSlot()],
    pollStatus: SchedulePollPageResponseDto['pollStatus'] = 'open',
) {
    vi.mocked(getSchedulePoll).mockResolvedValue(
        buildPoll(match, slots, pollStatus),
    );
    return renderHook(() => useSchedulingLock(match, MATCH_ID, LINEUP_ID), {
        wrapper,
    });
}

describe('useSchedulingLock — commit', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('linked-event lock completes the poll with eventId + slot start instant', async () => {
        rescheduleMutate.mockImplementationOnce((_vars, opts) =>
            opts?.onSuccess?.(),
        );
        const { result } = renderLock(buildMatch({ linkedEventId: 77 }));

        await act(() => result.current.requestLock(buildSlot()));

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

    it('does not complete the poll until reschedule succeeds', async () => {
        const { result } = renderLock(buildMatch({ linkedEventId: 77 }));

        await act(() => result.current.requestLock(buildSlot()));

        expect(rescheduleMutate).toHaveBeenCalledTimes(1);
        expect(completeStandalonePoll).not.toHaveBeenCalled();
    });

    it('non-linked lock navigates to /events/new and does NOT complete', async () => {
        const { result } = renderLock(buildMatch());

        await act(() => result.current.requestLock(buildSlot()));

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

    it('a follow-up poll carries copyFromEventId so the create form prefills', async () => {
        const { result } = renderLock(buildMatch({ followupForEventId: 91 }));

        await act(() => result.current.requestLock(buildSlot()));

        const url = (navigate as unknown as { mock: { calls: string[][] } }).mock
            .calls[0][0];
        expect(new URLSearchParams(url.split('?')[1]).get('copyFromEventId')).toBe(
            '91',
        );
    });

    it('an ordinary poll omits copyFromEventId', async () => {
        const { result } = renderLock(buildMatch());

        await act(() => result.current.requestLock(buildSlot()));

        const url = (navigate as unknown as { mock: { calls: string[][] } }).mock
            .calls[0][0];
        expect(
            new URLSearchParams(url.split('?')[1]).has('copyFromEventId'),
        ).toBe(false);
    });

    it('past-time slot aborts with a toast and calls nothing', async () => {
        const { result } = renderLock(buildMatch({ linkedEventId: 77 }), [
            buildSlot('2020-01-01T00:00:00.000Z'),
        ]);

        await act(() =>
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

/** Three members → required voters = 2. */
const THREE = [buildMember(1), buildMember(2), buildMember(3)];
const CHANGED = 'This poll changed — refresh to see the latest';

describe('useSchedulingLock — fresh lock-in count (ROK-1551 AC4)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('awaits a fresh poll and counts ITS voters, not the cached slot', async () => {
        const match = buildMatch({ members: THREE });
        const { result } = renderLock(match, [buildSlot(FUTURE_TIME, [1, 2])]);

        // Cached slot has one voter → would open the early-lock modal.
        await act(() => result.current.requestLock(buildSlot(FUTURE_TIME, [1])));

        expect(getSchedulePoll).toHaveBeenCalledWith(LINEUP_ID, MATCH_ID);
        expect(result.current.pendingSlot).toBeNull();
        expect(navigate).toHaveBeenCalledTimes(1);
    });

    it('fresh count below threshold opens the modal with the fresh number', async () => {
        const members = [...THREE, buildMember(4), buildMember(5)];
        const match = buildMatch({ members });
        const { result } = renderLock(match, [buildSlot(FUTURE_TIME, [1, 2])]);

        await act(() => result.current.requestLock(buildSlot(FUTURE_TIME, [1])));

        expect(result.current.pendingSlot?.id).toBe(1001);
        expect(result.current.pendingDistinctVoters).toBe(2);
        expect(result.current.pendingMemberCount).toBe(5);
        expect(navigate).not.toHaveBeenCalled();
    });

    it('forceConfirm opens the modal even when the threshold is met', async () => {
        const { result } = renderLock(buildMatch());

        await act(() =>
            result.current.requestLock(buildSlot(), { forceConfirm: true }),
        );

        expect(result.current.pendingSlot?.id).toBe(1001);
        expect(navigate).not.toHaveBeenCalled();
        act(() => result.current.confirmLock());
        expect(navigate).toHaveBeenCalledTimes(1);
    });

    it('slot gone from the fresh poll → toast, no modal, no commit', async () => {
        const { result } = renderLock(buildMatch(), []);

        await act(() => result.current.requestLock(buildSlot()));

        expect(toast.error).toHaveBeenCalledWith(CHANGED);
        expect(result.current.pendingSlot).toBeNull();
        expect(navigate).not.toHaveBeenCalled();
    });

    it('poll no longer open → toast, no modal, no commit', async () => {
        const { result } = renderLock(buildMatch(), [buildSlot()], 'locked_in');

        await act(() => result.current.requestLock(buildSlot()));

        expect(toast.error).toHaveBeenCalledWith(CHANGED);
        expect(result.current.pendingSlot).toBeNull();
        expect(navigate).not.toHaveBeenCalled();
    });

    it('fetch failure → toast, no commit', async () => {
        const match = buildMatch();
        const { result } = renderLock(match);
        vi.mocked(getSchedulePoll).mockRejectedValueOnce(new Error('boom'));

        await act(() => result.current.requestLock(buildSlot()));

        expect(toast.error).toHaveBeenCalledWith(CHANGED);
        expect(navigate).not.toHaveBeenCalled();
        expect(result.current.refreshing).toBe(false);
    });
});
