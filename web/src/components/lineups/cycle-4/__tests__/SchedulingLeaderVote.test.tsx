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
import { SchedulingLeaderVoteControls } from '../SchedulingLeaderVoteControls';
import type { SchedulingSlotListProps } from '../SchedulingSlotList';
import { formatSlotTime } from '../scheduling-slot-time';
import { ME, addSlot, buildPoll } from './scheduling-poll-fixtures';

/** A never-leading listed time, added by the cases that need a ladder row. */
const LISTED_SLOT_ID = 1003;

/**
 * The ladder row for a slot id. ROK-1635 renders the LEADING time on the card
 * only, so a row index no longer maps to a slot — every case names one.
 */
function rowFor(slotId: number): HTMLElement {
    const row = screen
        .getAllByTestId('schedule-slot')
        .find((r) => r.getAttribute('data-slot-id') === String(slotId));
    if (!row) throw new Error(`no ladder row for slot ${slotId}`);
    return row;
}

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
    /*
     * ROK-1635 AC1 reverses the premise of the two cases below: the leading
     * time is rendered ONCE, on the card, and its row is excluded from the
     * ladder — so there is no second copy of that slot left to mirror. The
     * intent ("a stance reads back from the one binding, wherever it is
     * drawn") survives intact and is asserted harder: the card reads pressed,
     * the leader has NO duplicate row, and a slot the viewer answered that
     * IS listed reads pressed on its row — i.e. the card and the ladder still
     * read the same `myVotedSlotIds` / `myNoSlotIds`, one surface each.
     */
    it('a YES on the leading slot reads pressed on the card — its only surface — while a listed slot reads pressed on its row', async () => {
        const poll = buildPoll({
            mySubmittedAt: '2026-05-20T10:00:00.000Z',
            myVotedSlotIds: [LEADER_SLOT_ID, LISTED_SLOT_ID],
        });
        addSlot(poll, { id: LISTED_SLOT_ID });
        const card = await renderPoll(poll);

        expect(
            within(card).getByTestId('scheduling-leader-vote'),
        ).toHaveAttribute('aria-pressed', 'true');
        expect(
            screen
                .getAllByTestId('schedule-slot')
                .map((r) => r.getAttribute('data-slot-id')),
        ).not.toContain(String(LEADER_SLOT_ID));
        expect(rowFor(LISTED_SLOT_ID)).toHaveAttribute('data-voted', 'true');
    });

    it('a NO on the leading slot reads pressed on the card — its only surface — while a listed slot reads pressed on its row', async () => {
        const poll = buildPoll({
            mySubmittedAt: '2026-05-20T10:00:00.000Z',
            myNoSlotIds: [LEADER_SLOT_ID, LISTED_SLOT_ID],
        });
        // Keep the slot above the leader floor (net > 0) despite my NO.
        addSupporters(poll, 2);
        addSlot(poll, { id: LISTED_SLOT_ID });
        const card = await renderPoll(poll);

        expect(within(card).getByTestId('scheduling-leader-no')).toHaveAttribute(
            'aria-pressed',
            'true',
        );
        expect(
            screen
                .getAllByTestId('schedule-slot')
                .map((r) => r.getAttribute('data-slot-id')),
        ).not.toContain(String(LEADER_SLOT_ID));
        expect(
            within(rowFor(LISTED_SLOT_ID)).getByTestId('slot-no-toggle'),
        ).toHaveAttribute('aria-pressed', 'true');
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

describe('leading card vote controls — the past gate (review item 6)', () => {
    /** A ladder binding with exactly the slots a case needs. */
    function buildLadder(
        slots: SchedulePollPageResponseDto['slots'],
    ): SchedulingSlotListProps {
        return {
            slots,
            myVotedSlotIds: [],
            myNoSlotIds: [],
            slotConflicts: [],
            readOnly: false,
            canVote: true,
            signedIn: true,
            enrolByVoting: false,
            canLock: false,
            lockableSlotId: null,
            onToggleVote: vi.fn(),
            onToggleNo: vi.fn(),
            onLock: vi.fn(),
        };
    }

    /**
     * The card must not offer a ballot on a time that has already passed —
     * the server refuses the vote, so an affordance that fails on tap is
     * worse than none. `deriveSchedulingLeader` is future-only since review
     * item 3, but the in-flight binding can still hold a slot while the clock
     * crosses it, so the component keeps its own gate. Both halves are
     * asserted together: a FUTURE slot renders, the SAME slot in the past
     * does not, which is what proves the gate and not the harness.
     */
    it('renders the ballot for a future time and nothing for a past one', async () => {
        const poll = buildPoll({ mySubmittedAt: '2026-05-20T10:00:00.000Z' });
        const future = poll.slots[0];
        const past = { ...future, proposedTime: '2020-01-02T20:00:00.000Z' };

        const { unmount } = renderWithProviders(
            <SchedulingLeaderVoteControls
                ladder={buildLadder([future])}
                slot={future}
            />,
        );
        expect(screen.getByTestId('scheduling-leader-vote')).toBeVisible();
        unmount();

        renderWithProviders(
            <SchedulingLeaderVoteControls
                ladder={buildLadder([past])}
                slot={past}
            />,
        );
        expect(screen.queryByTestId('scheduling-leader-vote')).toBeNull();
        expect(screen.queryByTestId('scheduling-leader-no')).toBeNull();
    });

    /**
     * Review item 5: lifting the row's buttons into a shared component must
     * not silently drop a class. `origin/main`'s YES button carried the
     * `disabled:*` pair; nothing renders it `disabled` today (in flight is
     * `aria-disabled` + a dimmed face), so this is a pure parity pin.
     */
    it('keeps the pre-extraction disabled:* classes on the YES control', async () => {
        const poll = buildPoll({ mySubmittedAt: '2026-05-20T10:00:00.000Z' });
        renderWithProviders(
            <SchedulingLeaderVoteControls
                ladder={buildLadder([poll.slots[0]])}
                slot={poll.slots[0]}
            />,
        );

        const vote = screen.getByTestId('scheduling-leader-vote');
        expect(vote.className).toContain('disabled:opacity-50');
        expect(vote.className).toContain('disabled:cursor-not-allowed');
    });
});

describe('leading card vote controls — nothing to vote on (2)', () => {
    /*
     * Same reversal: the leading slot's row is gone, so its third assertion
     * ("the row bound to the in-flight slot is aria-disabled too") is retargeted
     * onto a LISTED slot whose own press is in flight. Nothing is dropped — the
     * case still proves the guard reaches every control bound to the pressed
     * slot, and now also proves it does NOT reach the other slots' controls.
     */
    it('marks every control bound to the pressed slot aria-disabled while it is in flight', async () => {
        const user = userEvent.setup();
        const poll = buildPoll({ mySubmittedAt: '2026-05-20T10:00:00.000Z' });
        addSlot(poll, { id: LISTED_SLOT_ID });
        const card = await renderPoll(poll);

        await user.click(within(card).getByTestId('scheduling-leader-vote'));

        expect(
            within(card).getByTestId('scheduling-leader-vote'),
        ).toHaveAttribute('aria-disabled', 'true');
        expect(within(card).getByTestId('scheduling-leader-no')).toHaveAttribute(
            'aria-disabled',
            'true',
        );
        // The guard is per-slot: a row for another time is still live...
        const toggle = within(rowFor(LISTED_SLOT_ID)).getByTestId(
            'slot-no-toggle',
        );
        expect(toggle).not.toHaveAttribute('aria-disabled', 'true');
        await user.click(toggle);
        expect(toggleVoteMutate).toHaveBeenCalledTimes(2);
        // ...and once ITS press is in flight, that row reads disabled too.
        expect(
            within(rowFor(LISTED_SLOT_ID)).getByTestId('slot-no-toggle'),
        ).toHaveAttribute('aria-disabled', 'true');
    });
});
