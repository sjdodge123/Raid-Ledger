/**
 * ROK-1617 — the anti-vote, on the scheduling composite.
 *
 * Split out of `SchedulingComposite.test.tsx`, which is at the 750-line test
 * cap. Same harness (identical hook mocks + fixtures), so the two files test
 * the same component under the same conditions.
 *
 * AC4 — every votable row offers a "doesn't work" control, and pressing it
 *       sends `stance: 'no'` rather than a second yes.
 * AC5 — the anti-votes are visible as their own tally beside the vote count.
 * AC6 — the viewer's own anti-vote reads back as pressed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
    GroupedMatchesResponseDto,
} from '@raid-ledger/contract';
import { renderWithProviders } from '../../../../test/render-helpers';

// ── Hook mocks ────────────────────────────────────────────────────────
// The composite consumes these hooks directly; mock them so the test
// drives behavior without a live API. Mirrors how the sibling Cycle-4
// composites isolate their server state.
// ROK-1617 follow-up: the ladder presses through `mutateAsync`; the default
// mock never settles, so the in-flight guard stays held after a press.
const toggleVoteMutate = vi.fn(() => new Promise<never>(() => {}));
const suggestSlotMutate = vi.fn();
const cancelPollMutate = vi.fn();

// ROK-1300 rework round 1: the composite now owns the heatmap
// (useMatchAvailability), the operator Cancel (useCancelSchedulePoll), and the
// game-ref drawer. Mock the full hook set it consumes.
vi.mock('../../../../hooks/use-scheduling', () => ({
    useToggleScheduleVote: () => ({ mutateAsync: toggleVoteMutate, isPending: false }),
    useSuggestSlot: () => ({ mutate: suggestSlotMutate, isPending: false }),
    // One availability cell so AvailabilityHeatmapSection renders (it returns
    // null on empty data) → the in-composite heatmap test can assert it.
    useMatchAvailability: () => ({
        data: {
            eventId: 0,
            totalUsers: 2,
            cells: [
                { dayOfWeek: 1, hour: 19, availableCount: 2, totalCount: 2 },
            ],
        },
        isLoading: false,
    }),
    useCancelSchedulePoll: () => ({ mutate: cancelPollMutate, isPending: false }),
    // ROK-1610: the post-expiry lock-in's write, called unconditionally by
    // `useExpiredLockIn` (hook rules) even on an open poll.
    useCreateEventFromSlot: () => ({ mutate: vi.fn(), isPending: false }),
    // ROK-1395: SchedulingRemindAction calls this unconditionally (hook rules)
    // even when the visibility gate later renders null.
    useRemindVoters: () => ({
        mutate: vi.fn(),
        reset: vi.fn(),
        isPending: false,
        isSuccess: false,
    }),
}));

const lineupMatchesData = vi.fn<[], GroupedMatchesResponseDto | undefined>(
    () => undefined,
);
vi.mock('../../../../hooks/use-lineup-matches', () => ({
    useLineupMatches: () => ({ data: lineupMatchesData(), isLoading: false }),
}));

const authUser = vi.fn<[], { id: number; role?: string } | null>(() => ({
    id: 99,
}));
// Preserve isOperatorOrAdmin (SchedulingCancelAction gates on it) while
// stubbing the user; mirror the real predicate.
vi.mock('../../../../hooks/use-auth', () => ({
    useAuth: () => ({ user: authUser(), isAuthenticated: true }),
    isOperatorOrAdmin: (u: { role?: string } | null) =>
        u?.role === 'operator' || u?.role === 'admin',
}));

// ROK-1551 (AC4): lock-in refetches the poll before deciding confirm-vs-commit.
vi.mock('../../../../lib/api-client', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../../lib/api-client')>()),
    getSchedulePoll: vi.fn(),
}));

// Import AFTER vi.mock so the mocks are in place. The module does not yet
// exist — this import is the primary failure trigger.
import { SchedulingComposite } from '../SchedulingComposite';
import { ME, buildPoll } from './scheduling-poll-fixtures';


beforeEach(() => {
    vi.clearAllMocks();
    lineupMatchesData.mockReturnValue(undefined);
    authUser.mockReturnValue({ id: ME });
});

// ROK-1580: several cases below pin the viewport with `setViewport`; the stub
// must not leak into the next file-level test, which relies on the default.
afterEach(() => {
    vi.unstubAllGlobals();
});

// ─────────────────────────────────────────────────────────────────────
// AC1 — From-match mode: 4-phase ribbon hero + Match N of M cross-ref
// ─────────────────────────────────────────────────────────────────────

describe('SchedulingComposite — the anti-vote (ROK-1617)', () => {
    it('offers a "doesn\u2019t work" control on every votable row (AC4)', async () => {
        const poll = buildPoll({ mySubmittedAt: '2026-05-20T10:00:00.000Z' });
        renderWithProviders(
            <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
        );
        await screen.findByTestId('scheduling-leader-card');
        expect(screen.getAllByTestId('slot-no-toggle')).toHaveLength(2);
    });

    it('sends stance "no" and never a second yes (AC4)', async () => {
        const user = userEvent.setup();
        const poll = buildPoll({ mySubmittedAt: '2026-05-20T10:00:00.000Z' });
        renderWithProviders(
            <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
        );
        await screen.findByTestId('scheduling-leader-card');

        const rows = screen.getAllByTestId('schedule-slot');
        await user.click(within(rows[1]).getByTestId('slot-no-toggle'));

        expect(toggleVoteMutate).toHaveBeenCalledTimes(1);
        // ROK-1617 follow-up: variables only — the in-flight guard no longer
        // rides a mutate-level `onSettled` (see use-scheduling-ladder.ts).
        expect(toggleVoteMutate).toHaveBeenCalledWith(
            expect.objectContaining({ slotId: 1002, stance: 'no' }),
        );
    });

    it('shows the viewer\u2019s own anti-vote as pressed (AC6)', async () => {
        const poll = buildPoll({
            mySubmittedAt: '2026-05-20T10:00:00.000Z',
            myNoSlotIds: [1002],
        });
        renderWithProviders(
            <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
        );
        await screen.findByTestId('scheduling-leader-card');

        const row = screen
            .getAllByTestId('schedule-slot')
            .find((r) => r.getAttribute('data-slot-id') === '1002');
        expect(row).toBeDefined();
        expect(row).toHaveAttribute('data-no-voted', 'true');
        expect(within(row!).getByTestId('slot-no-toggle')).toHaveAttribute(
            'aria-pressed',
            'true',
        );
    });

    it('renders the anti-vote tally beside the vote count (AC5)', async () => {
        const poll = buildPoll({
            mySubmittedAt: '2026-05-20T10:00:00.000Z',
            noVotersBySlot: { 1002: 2 },
        });
        renderWithProviders(
            <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
        );
        await screen.findByTestId('scheduling-leader-card');

        const row = screen
            .getAllByTestId('schedule-slot')
            .find((r) => r.getAttribute('data-slot-id') === '1002');
        expect(within(row!).getByTestId('slot-no-count')).toHaveTextContent(
            '2 can',
        );
    });
});
