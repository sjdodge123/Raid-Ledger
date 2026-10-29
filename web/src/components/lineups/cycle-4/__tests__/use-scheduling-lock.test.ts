/**
 * useSchedulingLock commit-branch tests.
 *
 * Regression for the linked-poll lock bug: the reschedule lock-in must
 * carry the locked slot's start instant, otherwise the backend's slot-gated
 * re-roster pass never runs (ROK-1031). ROK-2040: it is ONE claim-first
 * request — no PATCH reschedule followed by `/complete` — and a 409 (another
 * organizer won the race) shows the lost-race toast.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
    EventResponseDto,
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

vi.mock('../../../../lib/api-client', () => ({
    rescheduleLockInSchedulingPoll: vi.fn().mockResolvedValue({ id: 77 }),
    getSchedulePoll: vi.fn(),
}));

vi.mock('../../../../lib/toast', () => ({
    toast: { success: vi.fn(), error: vi.fn() },
}));

import {
    getSchedulePoll,
    rescheduleLockInSchedulingPoll,
} from '../../../../lib/api-client';
import { withHttpStatus } from '../../../../lib/api/api-error';
import { toast } from '../../../../lib/toast';
import {
    RESCHEDULE_LOCK_IN_LOST_TOAST,
    useSchedulingLock,
} from '../use-scheduling-lock';
import { at } from '../../../../test/defined';
import { createMockEvent } from '../../../../test/factories';

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
        joinedAt: '2026-05-15T00:00:00.000Z',
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
        playerCap: null,
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
        noVotes: [],
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

    it('linked-event lock calls the claim-first reschedule lock-in once with the slot instant', async () => {
        const { result } = renderLock(buildMatch({ linkedEventId: 77 }));

        await act(() => result.current.requestLock(buildSlot()));

        expect(rescheduleLockInSchedulingPoll).toHaveBeenCalledTimes(1);
        expect(rescheduleLockInSchedulingPoll).toHaveBeenCalledWith(MATCH_ID, {
            startTime: FUTURE_TIME,
            endTime: new Date(
                new Date(FUTURE_TIME).getTime() + 2 * 60 * 60 * 1000,
            ).toISOString(),
        });
        // Backend matches startTime to a slot via Date-getTime equality.
        const [, body] = at(vi.mocked(rescheduleLockInSchedulingPoll).mock.calls, 0);
        expect(new Date(body.startTime).getTime()).toBe(
            new Date(FUTURE_TIME).getTime(),
        );
        expect(toast.success).toHaveBeenCalledWith('Event rescheduled');
        expect(navigate).not.toHaveBeenCalled();
    });

    it('linked-event lock refetches the event once the lock-in resolves (ROK-2031)', async () => {
        const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
        const { result } = renderLock(buildMatch({ linkedEventId: 77 }));

        await act(() => result.current.requestLock(buildSlot()));

        // The lock-in resolves on a later microtask; flush it, then assert.
        await act(async () => {});
        expect(invalidate).toHaveBeenCalledWith({ queryKey: ['events', 77] });
        invalidate.mockRestore();
    });

    it('a lost lock-in race (409) shows the lost-race toast, not success (ROK-2040)', async () => {
        vi.mocked(rescheduleLockInSchedulingPoll).mockRejectedValueOnce(
            withHttpStatus(new Error('This poll has already been locked in'), 409),
        );
        const { result } = renderLock(buildMatch({ linkedEventId: 77 }));

        await act(() => result.current.requestLock(buildSlot()));
        await act(async () => {});

        expect(toast.error).toHaveBeenCalledWith(RESCHEDULE_LOCK_IN_LOST_TOAST);
        expect(toast.success).not.toHaveBeenCalled();
    });

    it('a double click while the lock-in runs sends one request and one toast (ROK-2040)', async () => {
        let settle: (v: EventResponseDto) => void = () => {};
        vi.mocked(rescheduleLockInSchedulingPoll).mockImplementationOnce(
            () => new Promise<EventResponseDto>((resolve) => { settle = resolve; }),
        );
        const { result } = renderLock(buildMatch({ linkedEventId: 77 }));

        let first: Promise<void> = Promise.resolve();
        await act(async () => {
            first = result.current.requestLock(buildSlot());
            await vi.waitFor(() =>
                expect(rescheduleLockInSchedulingPoll).toHaveBeenCalledTimes(1),
            );
        });
        expect(result.current.refreshing).toBe(true);
        await act(() => result.current.requestLock(buildSlot()));
        await act(async () => {
            settle(createMockEvent({ id: 77 }));
            await first;
        });

        expect(rescheduleLockInSchedulingPoll).toHaveBeenCalledTimes(1);
        expect(toast.success).toHaveBeenCalledTimes(1);
        expect(toast.error).not.toHaveBeenCalled();
        expect(result.current.refreshing).toBe(false);
    });

    it('any other lock-in failure shows the server message', async () => {
        vi.mocked(rescheduleLockInSchedulingPoll).mockRejectedValueOnce(
            withHttpStatus(new Error('Event not found'), 404),
        );
        const { result } = renderLock(buildMatch({ linkedEventId: 77 }));

        await act(() => result.current.requestLock(buildSlot()));
        await act(async () => {});

        expect(toast.error).toHaveBeenCalledWith('Event not found');
        expect(toast.success).not.toHaveBeenCalled();
    });

    it('non-linked lock navigates to /events/new and does NOT lock in', async () => {
        const { result } = renderLock(buildMatch());

        await act(() => result.current.requestLock(buildSlot()));

        const params = new URLSearchParams();
        params.set('gameId', '42');
        params.set('startTime', FUTURE_TIME);
        params.set('matchId', String(MATCH_ID));
        params.set('lineupId', String(LINEUP_ID));
        expect(navigate).toHaveBeenCalledWith(
            `/events/new?${params.toString()}`,
        );
        expect(rescheduleLockInSchedulingPoll).not.toHaveBeenCalled();
    });

    it('a follow-up poll carries copyFromEventId so the create form prefills', async () => {
        const { result } = renderLock(buildMatch({ followupForEventId: 91 }));

        await act(() => result.current.requestLock(buildSlot()));

        const { calls } = (navigate as unknown as { mock: { calls: string[][] } }).mock;
        const url = at(at(calls, 0), 0);
        expect(new URLSearchParams(url.split('?')[1]).get('copyFromEventId')).toBe(
            '91',
        );
    });

    it('an ordinary poll omits copyFromEventId', async () => {
        const { result } = renderLock(buildMatch());

        await act(() => result.current.requestLock(buildSlot()));

        const { calls } = (navigate as unknown as { mock: { calls: string[][] } }).mock;
        const url = at(at(calls, 0), 0);
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
        expect(rescheduleLockInSchedulingPoll).not.toHaveBeenCalled();
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
