/**
 * Tests for `useSchedulingLadder` (ROK-1574).
 *
 * The ladder binding used to live inline in `SchedulingComposite`; ROK-1574
 * extracts it so the phone game-time sheet can render the SAME ballot on its
 * step 2 with the SAME handlers. These tests pin the extracted behaviour:
 * the derived gates, the in-flight guard, and the success-only announcement.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ScheduleSlotWithVotesDto } from '@raid-ledger/contract';
import { buildPoll, ME } from './scheduling-poll-fixtures';

const toggleMutate = vi.fn();
vi.mock('../../../../hooks/use-scheduling', () => ({
    useToggleScheduleVote: () => ({ mutate: toggleMutate, isPending: false }),
}));

const mockUser = vi.fn<() => { id: number; role: string } | null>(() => ({ id: ME, role: 'user' }));
vi.mock('../../../../hooks/use-auth', () => ({
    useAuth: () => ({ user: mockUser() }),
}));

const { useSchedulingLadder } = await import('../use-scheduling-ladder');

const announceVote = vi.fn();
const requestLock = vi.fn();

/** Render the hook over a poll fixture with the composite's own arguments. */
function renderLadder(overrides: Parameters<typeof buildPoll>[0] = {}) {
    const poll = buildPoll(overrides);
    return renderHook(() =>
        useSchedulingLadder({
            poll,
            lineupId: 7,
            matchId: 500,
            readOnly: (overrides.pollStatus ?? 'open') !== 'open',
            me: ME,
            lock: { requestLock },
            announcer: { announceVote },
        }),
    );
}

describe('useSchedulingLadder', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockUser.mockReturnValue({ id: ME, role: 'user' });
    });

    it('returns the SchedulingSlotList props straight off the poll payload', () => {
        const { result } = renderLadder({ myVotedSlotIds: [1] });
        expect(result.current.myVotedSlotIds).toEqual([1]);
        expect(result.current.readOnly).toBe(false);
        expect(result.current.canVote).toBe(true);
        expect(result.current.signedIn).toBe(true);
        expect(result.current.slots.length).toBeGreaterThan(0);
        expect(result.current.onLock).toBe(requestLock);
    });

    it('marks a member viewer as NOT enrol-by-voting, a non-member as enrolling', () => {
        const member = renderLadder();
        expect(member.result.current.enrolByVoting).toBe(false);

        const stranger = renderLadder({ members: [] });
        expect(stranger.result.current.enrolByVoting).toBe(true);
    });

    it('grants canLock to an operator and withholds it from a plain member', () => {
        expect(renderLadder().result.current.canLock).toBe(false);
        mockUser.mockReturnValue({ id: ME, role: 'operator' });
        expect(renderLadder().result.current.canLock).toBe(true);
    });

    it('toggles the vote through the mutation with the viewer attached', () => {
        const { result } = renderLadder();
        const slotId = result.current.slots[0].id;
        act(() => result.current.onToggleVote(slotId));
        expect(toggleMutate).toHaveBeenCalledTimes(1);
        expect(toggleMutate.mock.calls[0][0]).toMatchObject({ lineupId: 7, matchId: 500, slotId });
        expect(toggleMutate.mock.calls[0][0].viewer).toMatchObject({ userId: ME });
    });

    it('ignores a second tap on the same slot while the first is in flight', () => {
        const { result } = renderLadder();
        const slotId = result.current.slots[0].id;
        act(() => result.current.onToggleVote(slotId));
        act(() => result.current.onToggleVote(slotId));
        expect(toggleMutate).toHaveBeenCalledTimes(1);
    });

    it('does nothing at all when the viewer may not vote', () => {
        const { result } = renderLadder({ pollStatus: 'closed', canVote: false });
        act(() => result.current.onToggleVote(result.current.slots[0].id));
        expect(toggleMutate).not.toHaveBeenCalled();
    });

    it('announces the slot label on SUCCESS only (a rolled-back vote is silent)', () => {
        const { result } = renderLadder();
        const slot = result.current.slots[0] as ScheduleSlotWithVotesDto;
        act(() => result.current.onToggleVote(slot.id));
        const opts = toggleMutate.mock.calls[0][1];
        act(() => opts.onSuccess({ voted: true, stance: 'yes' }));
        expect(announceVote).toHaveBeenCalledWith(expect.any(String), 'yes');
        announceVote.mockClear();
        act(() => opts.onSettled());
        expect(announceVote).not.toHaveBeenCalled();
    });

    // ROK-1617 review MAJOR: `voted` means "the caller now holds a YES", so a
    // successful NO arrives as `voted:false` and used to be announced as
    // "your vote was removed". The live region must read the STANCE.
    it.each([
        ['no' as const, 'no'],
        [null, null],
    ])('announces the stance %s the server returned, not `voted`', (stance, expected) => {
        const { result } = renderLadder();
        const slot = result.current.slots[0] as ScheduleSlotWithVotesDto;
        act(() => result.current.onToggleNo(slot.id));
        const opts = toggleMutate.mock.calls[0][1];

        act(() => opts.onSuccess({ voted: false, stance }));

        expect(announceVote).toHaveBeenCalledWith(expect.any(String), expected);
    });
});
