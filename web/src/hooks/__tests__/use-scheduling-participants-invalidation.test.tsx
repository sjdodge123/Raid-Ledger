/**
 * ROK-1557 AC3 — the participants roster must stay current while the
 * scheduling poll is being voted on.
 *
 * The modal reads `PARTICIPANTS_KEY`; every mutation that changes who has
 * voted (tap a slot, retract everything, suggest a new time — which
 * auto-votes since ROK-1543) has to invalidate it, or the "Voted / Waiting"
 * chips keep showing the state from page load.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { createTestQueryClient } from '../../test/render-helpers';
import { PARTICIPANTS_KEY } from '../use-lineups';
import {
    useToggleScheduleVote,
    useRetractAllVotes,
    useSuggestSlot,
    useAddPollMembers,
} from '../use-scheduling';

const toggleScheduleVoteMock = vi.fn();
const retractAllVotesMock = vi.fn();
const suggestSlotMock = vi.fn();
const addPollMembersMock = vi.fn();

vi.mock('../../lib/api-client', () => ({
    getSchedulePoll: vi.fn(),
    toggleScheduleVote: (...args: unknown[]) => toggleScheduleVoteMock(...args),
    suggestSlot: (...args: unknown[]) => suggestSlotMock(...args),
    createEventFromSlot: vi.fn(),
    retractAllVotes: (...args: unknown[]) => retractAllVotesMock(...args),
    getMatchAvailability: vi.fn(),
    getSchedulingBanner: vi.fn(),
    getOtherPolls: vi.fn(),
    cancelSchedulePoll: vi.fn(),
    remindVoters: vi.fn(),
    addPollMembers: (...args: unknown[]) => addPollMembersMock(...args),
}));

/** Render a hook against a client whose `invalidateQueries` is spied on. */
function setup<T>(hook: () => T) {
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    function wrapper({ children }: { children: ReactNode }) {
        return createElement(QueryClientProvider, { client: queryClient }, children);
    }
    const { result } = renderHook(hook, { wrapper });
    return { result, invalidateSpy };
}

/**
 * True when any invalidate call targeted THIS poll's roster key
 * (`[...PARTICIPANTS_KEY, lineupId, matchId]`) — scoped, so other lineups'
 * cached rosters are left alone (review finding on the first cut, which
 * invalidated the whole prefix).
 */
function invalidatedParticipants(
    spy: ReturnType<typeof vi.spyOn>,
    lineupId = 1,
    matchId = 2,
): boolean {
    return spy.mock.calls.some((call) => {
        const key = (call[0] as { queryKey?: unknown[] } | undefined)?.queryKey;
        return (
            Array.isArray(key) &&
            key[0] === PARTICIPANTS_KEY[0] &&
            key[1] === PARTICIPANTS_KEY[1] &&
            key[2] === lineupId &&
            key[3] === matchId
        );
    });
}

describe('scheduling mutations invalidate the participants roster', () => {
    beforeEach(() => {
        toggleScheduleVoteMock.mockReset().mockResolvedValue({ voted: true });
        retractAllVotesMock.mockReset().mockResolvedValue(undefined);
        suggestSlotMock.mockReset().mockResolvedValue({ id: 99 });
        addPollMembersMock
            .mockReset()
            .mockResolvedValue({ added: 1, memberCount: 4 });
    });

    it('invalidates the roster after a slot vote toggles', async () => {
        const { result, invalidateSpy } = setup(() => useToggleScheduleVote());

        await act(async () => {
            result.current.mutate({ lineupId: 1, matchId: 2, slotId: 3 });
        });

        await waitFor(() =>
            expect(invalidatedParticipants(invalidateSpy)).toBe(true),
        );
    });

    it('invalidates the roster after retracting all votes', async () => {
        const { result, invalidateSpy } = setup(() => useRetractAllVotes());

        await act(async () => {
            result.current.mutate({ lineupId: 1, matchId: 2 });
        });

        await waitFor(() =>
            expect(invalidatedParticipants(invalidateSpy)).toBe(true),
        );
    });

    it('invalidates the roster after suggesting a slot (auto-votes)', async () => {
        const { result, invalidateSpy } = setup(() => useSuggestSlot());

        await act(async () => {
            result.current.mutate({
                lineupId: 1,
                matchId: 2,
                proposedTime: '2026-01-01T20:00:00.000Z',
            });
        });

        await waitFor(() =>
            expect(invalidatedParticipants(invalidateSpy)).toBe(true),
        );
    });

    it('invalidates the roster after adding poll members (Codex P2)', async () => {
        const { result, invalidateSpy } = setup(() => useAddPollMembers());

        await act(async () => {
            result.current.mutate({ lineupId: 1, matchId: 2, userIds: [7] });
        });

        await waitFor(() =>
            expect(invalidatedParticipants(invalidateSpy)).toBe(true),
        );
    });
});
