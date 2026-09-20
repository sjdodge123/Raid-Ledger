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
import { formatSlotTime } from '../scheduling-slot-time';
import { ME, buildPoll } from './scheduling-poll-fixtures';

/** The fixture's leading slot: 1 YES (me), 0 NO, earliest of the two. */
const LEADER_SLOT_ID = 1001;
/** The fixture's second slot — 0 YES, later, so it never leads at rest. */
const RUNNER_UP_SLOT_ID = 1002;
/** The two fixture times, formatted exactly as an accessible name carries them. */
const LEADER_LABEL = formatSlotTime('2030-06-10T20:00:00.000Z').label;
const RUNNER_UP_LABEL = formatSlotTime('2030-06-11T20:00:00.000Z').label;

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

/**
 * Render the composite and hand back a `settle` that re-renders it with the
 * NEXT payload — the optimistic cache write, as the card sees it: a new poll
 * object arriving while the press that caused it is still in flight.
 */
async function renderPollWithSettle(poll: SchedulePollPageResponseDto): Promise<{
    settle: (next: SchedulePollPageResponseDto) => void;
}> {
    const { rerender } = renderWithProviders(
        <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
    );
    await screen.findByTestId('scheduling-leader-card');
    return {
        settle: (next) =>
            rerender(
                <SchedulingComposite poll={next} lineupId={7} matchId={500} />,
            ),
    };
}

/** Give a slot `n` extra YES voters (ids never collide with the fixture's). */
function addVotersTo(
    poll: SchedulePollPageResponseDto,
    slotId: number,
    n: number,
): void {
    const slot = poll.slots.find((s) => s.id === slotId);
    for (let i = 0; i < n; i += 1) {
        slot?.votes.push({
            userId: 300 + i,
            displayName: `Yes ${i}`,
            avatar: null,
            discordId: null,
            customAvatarUrl: null,
        });
    }
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
});

describe('leading card vote controls — layout (review item 1)', () => {
    /**
     * `scheduling-poll.smoke.spec.ts` asserts the deadline banner's bottom
     * edge is inside a 375×667 fold with `scrollY === 0`. Anything the card
     * adds ABOVE the banner eats that budget, so the ballot goes below it —
     * and in ONE row, because two stacked 44px buttons are ~100px.
     */
    it('puts the ballot row after the deadline banner, in a single two-column row', async () => {
        const poll: SchedulePollPageResponseDto = {
            ...buildPoll({ mySubmittedAt: '2026-05-20T10:00:00.000Z' }),
            phaseDeadline: '2030-06-09T20:00:00.000Z',
        };
        const card = await renderPoll(poll);

        const ids = Array.from(
            card.querySelectorAll<HTMLElement>('[data-testid]'),
        ).map((el) => el.dataset.testid);
        expect(ids).toContain('poll-deadline-banner');
        expect(ids.indexOf('scheduling-leader-actions')).toBeGreaterThan(
            ids.indexOf('poll-deadline-banner'),
        );

        const actions = within(card).getByTestId('scheduling-leader-actions');
        expect(actions.className).toContain('grid-cols-2');
        expect(actions.className).toContain('min-h-[44px]');
        // Both answers sit in that one row — no second row, no wrap.
        expect(actions.querySelectorAll('button')).toHaveLength(2);
    });
});

describe('leading card vote controls — a press in flight (review item 2)', () => {
    it('stays bound to the pressed time when the optimistic write re-targets the lead', async () => {
        const user = userEvent.setup();
        const { settle } = await renderPollWithSettle(
            buildPoll({ mySubmittedAt: '2026-05-20T10:00:00.000Z' }),
        );

        await user.click(screen.getByTestId('scheduling-leader-no'));
        // The optimistic NO lands: slot 1001 falls to net 0 and the runner-up
        // (now +2) takes the lead — while the press is still in flight.
        const after = buildPoll({
            mySubmittedAt: '2026-05-20T10:00:00.000Z',
            myNoSlotIds: [LEADER_SLOT_ID],
        });
        addVotersTo(after, RUNNER_UP_SLOT_ID, 2);
        settle(after);

        // The control under the viewer's finger must still answer the time
        // they pressed, not the new leader — re-targeting mid-flight means the
        // next press clears/flips a DIFFERENT slot than the one on screen.
        const name = screen
            .getByTestId('scheduling-leader-no')
            .getAttribute('aria-label');
        expect(name).toContain(LEADER_LABEL);
        expect(name).not.toContain(RUNNER_UP_LABEL);
    });

    it('stays mounted when the optimistic write leaves no leading time', async () => {
        const user = userEvent.setup();
        const { settle } = await renderPollWithSettle(
            buildPoll({ mySubmittedAt: '2026-05-20T10:00:00.000Z' }),
        );

        await user.click(screen.getByTestId('scheduling-leader-no'));
        // Nothing else clears the floor, so the card flips to its empty state.
        settle(
            buildPoll({
                mySubmittedAt: '2026-05-20T10:00:00.000Z',
                myNoSlotIds: [LEADER_SLOT_ID],
            }),
        );

        const control = screen.queryByTestId('scheduling-leader-no');
        expect(control).not.toBeNull();
        expect(control?.getAttribute('aria-label')).toContain(LEADER_LABEL);
    });

});

describe('leading card vote controls — nothing to vote on (2)', () => {
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
