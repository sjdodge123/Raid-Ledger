/**
 * ROK-1635 (AC1, AC2) — the leading time appears exactly ONCE on the page.
 *
 * Split out of `SchedulingComposite.test.tsx`, which is at the 750-line test
 * cap. Same harness (identical hook mocks + fixtures), so these cases test the
 * same component under the same conditions as its siblings.
 *
 * AC1 — the time the leader card names is NOT repeated as a ladder row, and a
 *       lead change moves both in ONE render (no frame with both or neither).
 * AC2 — when no time leads (every net ≤ 0, the ROK-1617 floor), the card says
 *       so and the ladder lists every proposed time.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import type {
    GroupedMatchesResponseDto,
    SchedulePollPageResponseDto,
} from '@raid-ledger/contract';
import { renderWithProviders } from '../../../../test/render-helpers';

// ── Hook mocks ────────────────────────────────────────────────────────
// The composite consumes these hooks directly; mock them so the test drives
// behavior without a live API (mirrors the sibling composite specs).
const toggleVoteMutate = vi.fn(() => new Promise<never>(() => {}));

vi.mock('../../../../hooks/use-scheduling', () => ({
    useToggleScheduleVote: () => ({
        mutateAsync: toggleVoteMutate,
        isPending: false,
    }),
    useSuggestSlot: () => ({ mutate: vi.fn(), isPending: false }),
    useMatchAvailability: () => ({ data: undefined, isLoading: false }),
    useCancelSchedulePoll: () => ({ mutate: vi.fn(), isPending: false }),
    useCreateEventFromSlot: () => ({ mutate: vi.fn(), isPending: false }),
    useRemindVoters: () => ({
        mutate: vi.fn(),
        reset: vi.fn(),
        isPending: false,
        isSuccess: false,
    }),
    useRallyNonVoters: () => ({
        mutate: vi.fn(),
        reset: vi.fn(),
        isPending: false,
        data: undefined,
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
vi.mock('../../../../hooks/use-auth', () => ({
    useAuth: () => ({ user: authUser(), isAuthenticated: true }),
    isOperatorOrAdmin: (u: { role?: string } | null) =>
        u?.role === 'operator' || u?.role === 'admin',
}));

import { SchedulingComposite } from '../SchedulingComposite';
import { buildPoll } from './scheduling-poll-fixtures';

/** The slot ids the ladder actually rendered, in render order. */
function renderedIds(): (string | null)[] {
    return screen
        .queryAllByTestId('schedule-slot')
        .map((el) => el.getAttribute('data-slot-id'));
}

/** A yes-voter on a slot, in the payload's shape. */
function voter(userId: number): { userId: number; displayName: string } {
    return { userId, displayName: `User ${userId}` };
}

/** The same poll with `slotId` carrying `count` yes votes. */
function withVotes(
    poll: SchedulePollPageResponseDto,
    slotId: number,
    count: number,
): SchedulePollPageResponseDto {
    return {
        ...poll,
        slots: poll.slots.map((slot) =>
            slot.id === slotId
                ? {
                      ...slot,
                      votes: Array.from({ length: count }, (_, i) =>
                          voter(200 + i),
                      ) as (typeof slot)['votes'],
                  }
                : slot,
        ),
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    authUser.mockReturnValue({ id: 99 });
});
afterEach(() => {
    lineupMatchesData.mockReturnValue(undefined);
});

describe('SchedulingComposite — the leader shows once (ROK-1635)', () => {
    it('AC1 — the card names the leading time and the ladder omits its row', async () => {
        // Fixture: slot 1001 has one yes vote, 1002 none → 1001 leads.
        renderWithProviders(
            <SchedulingComposite
                poll={buildPoll()}
                lineupId={7}
                matchId={500}
            />,
        );
        await screen.findByTestId('scheduling-leader-card');

        expect(screen.getByTestId('scheduling-leader-votes')).toHaveTextContent(
            '1 of 2',
        );
        expect(renderedIds()).toEqual(['1002']);
    });

    it('AC1 §4.4 — a lead change swaps both rows in the same render', async () => {
        const { rerender } = renderWithProviders(
            <SchedulingComposite
                poll={buildPoll()}
                lineupId={7}
                matchId={500}
            />,
        );
        await screen.findByTestId('scheduling-leader-card');
        expect(renderedIds()).toEqual(['1002']);

        // What the optimistic cache write looks like once 1002 overtakes 1001.
        rerender(
            <SchedulingComposite
                poll={withVotes(buildPoll(), 1002, 2)}
                lineupId={7}
                matchId={500}
            />,
        );

        // ONE assertion over both facts: a frame showing both rows (or
        // neither) fails here rather than passing on a second poll.
        await waitFor(() => {
            expect(renderedIds()).toEqual(['1001']);
        });
        expect(screen.getByTestId('scheduling-leader-votes')).toHaveTextContent(
            '2 of 2',
        );
    });

    it('AC2 — nothing leads (every net ≤ 0), so every time is listed', async () => {
        const poll = buildPoll({ noVotersBySlot: { 1001: 1, 1002: 1 } });
        renderWithProviders(
            <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
        );
        await screen.findByTestId('scheduling-leader-card');

        expect(
            screen.getByText('No time works for the group yet.'),
        ).toBeInTheDocument();
        expect(renderedIds()).toEqual(['1001', '1002']);
    });

    it('§4.3 — a tie on net hides exactly one row and keeps the tie badge', async () => {
        // Both slots on one yes vote → tied on net; earliest time wins.
        const poll = withVotes(buildPoll(), 1002, 1);
        renderWithProviders(
            <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
        );
        await screen.findByTestId('scheduling-leader-card');

        expect(screen.getByTestId('scheduling-leader-tie')).toBeInTheDocument();
        expect(renderedIds()).toEqual(['1002']);
    });
});
