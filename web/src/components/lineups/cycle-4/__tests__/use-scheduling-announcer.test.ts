/**
 * Failing-first tests for `useSchedulingAnnouncer` (ROK-1546 AC2).
 *
 * The scheduling poll changes under the viewer without a page transition:
 * their own vote is written optimistically, and the leading slot can flip as
 * other members vote. A sighted user sees both; a screen-reader user was told
 * neither. AC2 adds ONE polite live region that announces exactly two things —
 * the viewer's own vote registering/removing, and the leader changing.
 *
 * Deliberately NOT announced: the first render (nothing changed yet), and a
 * re-derived leader whose slot id is unchanged (a tie that keeps the same
 * winner is not news).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ScheduleSlotWithVotesDto } from '@raid-ledger/contract';
import type { SchedulingLeader } from '../scheduling-leader';
import { useSchedulingAnnouncer } from '../use-scheduling-announcer';

/** Minimal slot — only `id` and `proposedTime` reach the announcement. */
function makeSlot(id: number, proposedTime: string): ScheduleSlotWithVotesDto {
    return {
        id,
        matchId: 500,
        proposedTime,
        overlapScore: 0,
        suggestedBy: 'user',
        createdAt: '2026-06-01T00:00:00.000Z',
        votes: [],
    } as ScheduleSlotWithVotesDto;
}

function makeLeader(
    id: number,
    votes: number,
    proposedTime = '2030-07-01T20:00:00.000Z',
): SchedulingLeader {
    return { slot: makeSlot(id, proposedTime), votes, tied: false };
}

describe('useSchedulingAnnouncer (ROK-1546 AC2)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('says nothing on mount — the first leader is not a change', () => {
        const { result } = renderHook(() =>
            useSchedulingAnnouncer(makeLeader(1, 3)),
        );
        expect(result.current.message).toBe('');
    });

    it('announces a NEW leader once the leading slot id changes', () => {
        const { result, rerender } = renderHook(
            ({ leader }: { leader: SchedulingLeader | null }) =>
                useSchedulingAnnouncer(leader),
            { initialProps: { leader: makeLeader(1, 1) } },
        );
        expect(result.current.message).toBe('');

        rerender({ leader: makeLeader(2, 4, '2030-07-02T18:30:00.000Z') });

        expect(result.current.message).toMatch(/is now leading with 4 votes\.$/);
    });

    it('says nothing when the leader is re-derived with the same slot id', () => {
        const { result, rerender } = renderHook(
            ({ leader }: { leader: SchedulingLeader | null }) =>
                useSchedulingAnnouncer(leader),
            { initialProps: { leader: makeLeader(1, 1) } },
        );
        // Same slot, one more vote, now tied — same winner, so not news.
        rerender({ leader: { ...makeLeader(1, 2), tied: true } });
        expect(result.current.message).toBe('');
    });

    it('announces the viewer\'s own vote registering and being cleared', () => {
        const { result } = renderHook(() =>
            useSchedulingAnnouncer(makeLeader(1, 1)),
        );

        act(() => result.current.announceVote('Wed 1 Jul, 20:00', 'yes'));
        expect(result.current.message).toBe(
            'Your vote for Wed 1 Jul, 20:00 is in.',
        );

        act(() => result.current.announceVote('Wed 1 Jul, 20:00', null));
        expect(result.current.message).toBe(
            'Your answer for Wed 1 Jul, 20:00 was cleared.',
        );
    });

    // ROK-1617 review MAJOR: a NO used to be announced as "your vote was
    // removed" (the server's `voted` is false for a NO), which told a
    // screen-reader user the opposite of what they had just recorded.
    it('announces a NO as its own answer, not as a removed vote', () => {
        const { result } = renderHook(() =>
            useSchedulingAnnouncer(makeLeader(1, 1)),
        );

        act(() => result.current.announceVote('Wed 1 Jul, 20:00', 'no'));

        expect(result.current.message).toBe(
            'You marked Wed 1 Jul, 20:00 as not working for you.',
        );
    });

    it('folds a leader change the vote itself caused into the vote message', () => {
        // The optimistic write re-derives the leader BEFORE the mutation
        // settles, so the leader announcement fires first; the vote's
        // `onSuccess` must not replace it (review MAJOR on ROK-1546).
        const { result, rerender } = renderHook(
            ({ leader }: { leader: SchedulingLeader | null }) =>
                useSchedulingAnnouncer(leader),
            { initialProps: { leader: makeLeader(1, 1) } },
        );
        rerender({ leader: makeLeader(2, 2, '2030-07-02T18:30:00.000Z') });
        const leaderMessage = result.current.message;
        expect(leaderMessage).toMatch(/is now leading with 2 votes\.$/);

        act(() => result.current.announceVote('Thu 2 Jul, 18:30', 'yes'));

        expect(result.current.message).toBe(
            `Your vote for Thu 2 Jul, 18:30 is in. ${leaderMessage}`,
        );
    });

    it('does not fold in a stale leader announcement', () => {
        const { result, rerender } = renderHook(
            ({ leader }: { leader: SchedulingLeader | null }) =>
                useSchedulingAnnouncer(leader),
            { initialProps: { leader: makeLeader(1, 1) } },
        );
        rerender({ leader: makeLeader(2, 2) });
        act(() => {
            vi.advanceTimersByTime(3000);
        });

        act(() => result.current.announceVote('Wed 1 Jul, 20:00', null));

        expect(result.current.message).toBe(
            'Your answer for Wed 1 Jul, 20:00 was cleared.',
        );
    });

    it('clears the message so an identical announcement re-fires', () => {
        const { result } = renderHook(() =>
            useSchedulingAnnouncer(makeLeader(1, 1)),
        );
        act(() => result.current.announceVote('Wed 1 Jul, 20:00', 'yes'));
        expect(result.current.message).not.toBe('');

        act(() => {
            vi.advanceTimersByTime(4000);
        });
        expect(result.current.message).toBe('');
    });

    it('pluralises a single-vote leader', () => {
        const { rerender, result } = renderHook(
            ({ leader }: { leader: SchedulingLeader | null }) =>
                useSchedulingAnnouncer(leader),
            { initialProps: { leader: makeLeader(1, 0) } },
        );
        rerender({ leader: makeLeader(2, 1) });
        expect(result.current.message).toMatch(/is now leading with 1 vote\.$/);
    });
});
