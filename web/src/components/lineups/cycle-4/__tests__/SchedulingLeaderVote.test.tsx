/**
 * ROK-1617 follow-up (item B) — vote / "doesn't work" ON the leading card.
 *
 * Operator, 2026-09-20: "I should be able to vote/antivote on the lead time
 * card itself." The controls are the SAME component the ladder row renders
 * (`SchedulingVoteControls`) bound to the SAME ladder handlers, so the two
 * placements cannot disagree and there is only one mutation path.
 *
 * Same harness as `SchedulingComposite.antivote.test.tsx` (identical hook
 * mocks + fixtures) — this file exists because that one is near the 750-line
 * test cap.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
    GroupedMatchesResponseDto,
    SchedulePollPageResponseDto,
} from '@raid-ledger/contract';
import { renderWithProviders } from '../../../../test/render-helpers';

// The default mock never settles, so the in-flight guard stays held after a
// press — which is what the `aria-disabled` case reads.
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

vi.mock('../../../../lib/api-client', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../../lib/api-client')>()),
    getSchedulePoll: vi.fn(),
}));

import { SchedulingComposite } from '../SchedulingComposite';
import { ME, buildPoll } from './scheduling-poll-fixtures';

/** The fixture's leading slot: 1 YES (me), 0 NO, earliest of the two. */
const LEADER_SLOT_ID = 1001;

beforeEach(() => {
    vi.clearAllMocks();
    lineupMatchesData.mockReturnValue(undefined);
    authUser.mockReturnValue({ id: ME });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

/** Render the composite and wait for the leader card. */
async function renderPoll(
    poll: SchedulePollPageResponseDto,
): Promise<HTMLElement> {
    renderWithProviders(
        <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
    );
    return screen.findByTestId('scheduling-leader-card');
}

/** Add extra YES voters to the leading slot so it still clears the floor. */
function addSupporters(poll: SchedulePollPageResponseDto, n: number): void {
    for (let i = 0; i < n; i += 1) {
        poll.slots[0].votes.push({
            userId: 200 + i,
            displayName: `Yes ${i}`,
            avatar: null,
            discordId: null,
            customAvatarUrl: null,
        });
    }
}

describe('leading card vote controls (ROK-1617 follow-up, item B)', () => {
    it('renders both controls for a member of an open poll with a leader', async () => {
        const card = await renderPoll(
            buildPoll({ mySubmittedAt: '2026-05-20T10:00:00.000Z' }),
        );

        expect(within(card).getByTestId('scheduling-leader-vote')).toBeVisible();
        expect(within(card).getByTestId('scheduling-leader-no')).toBeVisible();
    });

    it('presses YES on the leading slot through the ladder handler the row uses', async () => {
        const user = userEvent.setup();
        const card = await renderPoll(
            buildPoll({ mySubmittedAt: '2026-05-20T10:00:00.000Z' }),
        );

        await user.click(within(card).getByTestId('scheduling-leader-vote'));

        expect(toggleVoteMutate).toHaveBeenCalledTimes(1);
        expect(toggleVoteMutate).toHaveBeenCalledWith(
            expect.objectContaining({ slotId: LEADER_SLOT_ID, stance: 'yes' }),
        );
    });

    it('presses NO on the leading slot through the ladder handler the row uses', async () => {
        const user = userEvent.setup();
        const card = await renderPoll(
            buildPoll({ mySubmittedAt: '2026-05-20T10:00:00.000Z' }),
        );

        await user.click(within(card).getByTestId('scheduling-leader-no'));

        expect(toggleVoteMutate).toHaveBeenCalledTimes(1);
        expect(toggleVoteMutate).toHaveBeenCalledWith(
            expect.objectContaining({ slotId: LEADER_SLOT_ID, stance: 'no' }),
        );
    });

});

describe('leading card vote controls — states and gating', () => {
    it('mirrors the row: a YES on the leading slot reads pressed in both places', async () => {
        const card = await renderPoll(
            buildPoll({
                mySubmittedAt: '2026-05-20T10:00:00.000Z',
                myVotedSlotIds: [LEADER_SLOT_ID],
            }),
        );

        expect(
            within(card).getByTestId('scheduling-leader-vote'),
        ).toHaveAttribute('aria-pressed', 'true');
        const row = screen
            .getAllByTestId('schedule-slot')
            .find((r) => r.getAttribute('data-slot-id') === String(LEADER_SLOT_ID));
        expect(row).toHaveAttribute('data-voted', 'true');
    });

    it('mirrors the row: a NO on the leading slot reads pressed in both places', async () => {
        const poll = buildPoll({
            mySubmittedAt: '2026-05-20T10:00:00.000Z',
            myNoSlotIds: [LEADER_SLOT_ID],
        });
        // Keep the slot above the leader floor (net > 0) despite my NO.
        addSupporters(poll, 2);
        const card = await renderPoll(poll);

        expect(within(card).getByTestId('scheduling-leader-no')).toHaveAttribute(
            'aria-pressed',
            'true',
        );
        const row = screen
            .getAllByTestId('schedule-slot')
            .find((r) => r.getAttribute('data-slot-id') === String(LEADER_SLOT_ID));
        expect(within(row!).getByTestId('slot-no-toggle')).toHaveAttribute(
            'aria-pressed',
            'true',
        );
    });

});

describe('leading card vote controls — nothing to vote on', () => {
    it('renders no controls when no time clears the leader floor', async () => {
        const card = await renderPoll(
            buildPoll({
                mySubmittedAt: '2026-05-20T10:00:00.000Z',
                myNoSlotIds: [1001, 1002],
            }),
        );

        expect(card).toHaveTextContent('No time works for the group yet.');
        expect(screen.queryByTestId('scheduling-leader-vote')).toBeNull();
        expect(screen.queryByTestId('scheduling-leader-no')).toBeNull();
    });

    it('renders no controls for a viewer who cannot vote', async () => {
        const card = await renderPoll(
            buildPoll({
                mySubmittedAt: '2026-05-20T10:00:00.000Z',
                pollStatus: 'closed',
            }),
        );

        expect(within(card).getByTestId('scheduling-leader-time')).toBeVisible();
        expect(screen.queryByTestId('scheduling-leader-vote')).toBeNull();
        expect(screen.queryByTestId('scheduling-leader-no')).toBeNull();
    });

    it('marks both controls aria-disabled while a press on that slot is in flight', async () => {
        const user = userEvent.setup();
        const card = await renderPoll(
            buildPoll({ mySubmittedAt: '2026-05-20T10:00:00.000Z' }),
        );

        await user.click(within(card).getByTestId('scheduling-leader-vote'));

        expect(
            within(card).getByTestId('scheduling-leader-vote'),
        ).toHaveAttribute('aria-disabled', 'true');
        expect(within(card).getByTestId('scheduling-leader-no')).toHaveAttribute(
            'aria-disabled',
            'true',
        );
        const row = screen
            .getAllByTestId('schedule-slot')
            .find((r) => r.getAttribute('data-slot-id') === String(LEADER_SLOT_ID));
        expect(within(row!).getByTestId('slot-no-toggle')).toHaveAttribute(
            'aria-disabled',
            'true',
        );
    });
});
