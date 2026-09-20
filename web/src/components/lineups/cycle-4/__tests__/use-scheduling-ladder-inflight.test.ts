/**
 * ROK-1617 follow-up, slice S0 — DISCRIMINATE the swallowed "undo" press.
 *
 * The operator pressed "Doesn't work" on a time, then pressed it again to
 * undo, and NOTHING happened: the DB proves only ONE write ever left the
 * browser (vote row 178 survived, and the id sequence stops there). The only
 * line on the page that drops a press with no request, no toast and no state
 * change is `use-scheduling-ladder.ts:126`:
 *
 *     if (!canVote || slotPending.pending.has(slotId)) return;
 *
 * Two candidates: (C1) the per-slot in-flight set is never cleared, because
 * the clear lives in a MUTATE-level `onSettled` (`:132`) — which TanStack
 * Query v5 only invokes while the observer still has listeners AND is still
 * the mutation's observer (`mutationObserver.js:40,56-57,76`); or (C2)
 * `canVote` flipped false.
 *
 * WHY A SIBLING FILE: `use-scheduling-ladder.test.ts` mocks the whole
 * `use-scheduling` module with `mutate: vi.fn()`, so its `onSettled` only ever
 * runs because the test calls it by hand. That harness cannot tell us whether
 * the REAL observer would have called it. These tests therefore use the real
 * `useToggleScheduleVote` over a real QueryClient and mock only the network
 * call, so TanStack's own unmount / re-`mutate` semantics are in play.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import type { ScheduleVoteStance } from '@raid-ledger/contract';
import { createTestQueryClient } from '../../../../test/render-helpers';
import { buildPoll, ME } from './scheduling-poll-fixtures';

type VoteResult = { voted: boolean; stance: ScheduleVoteStance | null };

/** One in-flight vote request, settled by the test when it chooses. */
interface Pending {
    stance: ScheduleVoteStance | undefined;
    slotId: number;
    resolve: (value: VoteResult) => void;
}

const inFlight: Pending[] = [];
const voteApi = vi.fn(
    (_lineupId: number, _matchId: number, slotId: number, stance?: ScheduleVoteStance) =>
        new Promise<VoteResult>((resolve) => {
            inFlight.push({ slotId, stance, resolve });
        }),
);

// Mocked at the network boundary only — the mutation, its optimistic patch and
// its callbacks are the real ones.
vi.mock('../../../../lib/api/scheduling-api', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    toggleScheduleVote: (...args: Parameters<typeof voteApi>) => voteApi(...args),
}));

vi.mock('../../../../hooks/use-auth', () => ({
    useAuth: () => ({ user: { id: ME, role: 'user' } }),
}));

const { useSchedulingLadder } = await import('../use-scheduling-ladder');

const announceVote = vi.fn();
const requestLock = vi.fn();

/**
 * Render the ladder exactly as `SchedulingComposite` does, over a QueryClient
 * the caller may keep across an unmount (the app's client outlives a page
 * remount, so the test's must too).
 */
function renderLadder(queryClient: QueryClient) {
    const poll = buildPoll();
    const wrapper = ({ children }: { children: ReactNode }) =>
        createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(
                MemoryRouter,
                { initialEntries: ['/community-lineup/7/schedule/500'] },
                children,
            ),
        );
    return renderHook(
        () =>
            useSchedulingLadder({
                poll,
                lineupId: 7,
                matchId: 500,
                readOnly: false,
                me: ME,
                lock: { requestLock },
                announcer: { announceVote },
            }),
        { wrapper },
    );
}

/**
 * Settle every request in flight and WAIT for TanStack to finish with it —
 * asserted on the mutation cache, not on a fixed number of microtasks, so a
 * red test below is a dropped press and never an unflushed promise.
 */
async function settleAll(qc: QueryClient, result: VoteResult = { voted: false, stance: 'no' }) {
    const batch = inFlight.splice(0, inFlight.length);
    batch.forEach((p) => p.resolve(result));
    await waitFor(() =>
        expect(
            qc
                .getMutationCache()
                .getAll()
                .filter((m) => m.state.status === 'pending'),
        ).toHaveLength(0),
    );
    await act(async () => {
        await Promise.resolve();
    });
}

/** How many times the network saw a press on this slot. */
function pressesOn(slotId: number): number {
    return voteApi.mock.calls.filter((c) => c[2] === slotId).length;
}

describe('useSchedulingLadder — a second press must reach the network (ROK-1617 S0)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        inFlight.length = 0;
    });

    // T1 — the baseline the operator believed they were doing: press, wait,
    // press again. Expected GREEN; if it is red the `onSettled` wiring itself
    // is broken and no remount is needed to explain the bug.
    it('T1: press NO, let it settle, press NO again — the request goes out twice', async () => {
        const qc = createTestQueryClient();
        const { result } = renderLadder(qc);
        const slotId = result.current.slots[0].id;

        act(() => result.current.onToggleNo(slotId));
        await waitFor(() => expect(inFlight).toHaveLength(1));
        await settleAll(qc);
        act(() => result.current.onToggleNo(slotId));

        // `mutationFn` runs only after `onMutate` resolves, so the second press
        // reaches the network one microtask later — never assert it synchronously.
        await waitFor(() => expect(pressesOn(slotId)).toBe(2));
    });

    // T2 — candidate C1 via the remount the page really performs: the phone
    // game-time sheet swaps the ladder out (`SchedulingComposite.tsx:246`) and
    // the page falls back to a skeleton while `useGameTime()` loads. Unmounting
    // drops the observer's listeners, so the mutate-level `onSettled` at
    // `use-scheduling-ladder.ts:132` never runs for that request.
    it('T2: unmount + remount between the press and its settle — the next press still goes out', async () => {
        const qc = createTestQueryClient();
        const first = renderLadder(qc);
        const slotId = first.result.current.slots[0].id;

        act(() => first.result.current.onToggleNo(slotId));
        await waitFor(() => expect(inFlight).toHaveLength(1));
        first.unmount();
        await settleAll(qc);

        const second = renderLadder(qc);
        act(() => second.result.current.onToggleNo(slotId));

        // `mutationFn` runs only after `onMutate` resolves, so the second press
        // reaches the network one microtask later — never assert it synchronously.
        await waitFor(() => expect(pressesOn(slotId)).toBe(2));
    });

    // T2b — candidate C1 without any unmount, and the variant the per-slot
    // guard does NOT cover: the guard is per slot, but `useToggleScheduleVote`
    // is ONE observer. A press on a second slot re-points that observer
    // (`mutationObserver.js:56-57` — `#mutateOptions` is overwritten and the
    // first mutation loses the observer), so the FIRST slot's mutate-level
    // `onSettled` never fires while its entry in the in-flight set — plain
    // `useState` inside the still-mounted hook — survives. That slot is then
    // pending forever and every later press on it is dropped silently.
    it('T2b: a press on another slot mid-flight must not strand the first slot as pending', async () => {
        const qc = createTestQueryClient();
        const { result } = renderLadder(qc);
        const slotA = result.current.slots[0].id;
        const slotB = result.current.slots[1].id;

        act(() => result.current.onToggleNo(slotA));
        await waitFor(() => expect(inFlight).toHaveLength(1));
        act(() => result.current.onToggleNo(slotB));
        await waitFor(() => expect(inFlight).toHaveLength(2));
        await settleAll(qc);

        act(() => result.current.onToggleNo(slotA));

        // `mutationFn` runs only after `onMutate` resolves, so the second press
        // reaches the network one microtask later — never assert it synchronously.
        await waitFor(() => expect(pressesOn(slotA)).toBe(2));
    });

    // T3 — candidate C2. Nothing the client does may flip `canVote` off after
    // a vote settles; an open poll's member keeps both affordances.
    it.each<[ScheduleVoteStance, VoteResult]>([
        ['yes', { voted: true, stance: 'yes' }],
        ['no', { voted: false, stance: 'no' }],
    ])('T3: canVote survives a settled %s vote', async (stance, settled) => {
        const qc = createTestQueryClient();
        const { result } = renderLadder(qc);
        const slotId = result.current.slots[0].id;

        act(() =>
            stance === 'yes'
                ? result.current.onToggleVote(slotId)
                : result.current.onToggleNo(slotId),
        );
        await waitFor(() => expect(inFlight).toHaveLength(1));
        await settleAll(qc, settled);

        expect(result.current.canVote).toBe(true);
    });
});
