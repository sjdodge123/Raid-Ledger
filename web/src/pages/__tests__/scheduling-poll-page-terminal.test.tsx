/**
 * SchedulingPollPage terminal states (ROK-1545, review F1).
 *
 * The composite specs used to assert the locked-in banner by handing the
 * composite `pollStatus: 'locked_in'` — a value it can never receive in
 * production, because the PAGE short-circuits a `scheduled` match to
 * `CompletedPollState` before the composite renders. These tests drive the
 * REAL path: a `scheduled` match goes through the page and must show the
 * banner the two Playwright specs assert
 * (`read-only-banner[data-poll-status="locked_in"]` + `terminal-event-link`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import type { JSX } from 'react';
import type { SchedulePollPageResponseDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../test/render-helpers';
import { buildPoll } from '../../components/lineups/cycle-4/__tests__/scheduling-poll-fixtures';
import { SchedulingPollPage } from '../scheduling-poll-page';
import type { SubjectDiscussionCardProps } from '../../components/discussion/SubjectDiscussionCard';

const schedulePoll = vi.fn();

vi.mock('../../hooks/use-scheduling', () => ({
    useSchedulePoll: () => schedulePoll(),
    useOtherPolls: () => ({ data: undefined, isLoading: false }),
}));

vi.mock('../../hooks/use-schedule-poll-realtime', () => ({
    useLiveSchedulePoll: () => schedulePoll(),
}));

vi.mock('../../hooks/use-game-time', () => ({
    useGameTime: () => ({ data: undefined, isLoading: false }),
}));

vi.mock('../scheduling/GameTimeRefreshModal', () => ({
    GameTimeRefreshModal: (): JSX.Element | null => null,
}));

// The composite pulls a wide hook surface; the page-level cases only care
// about which branch the page picks, so keep it out of the render tree.
vi.mock('../../components/lineups/cycle-4/SchedulingComposite', () => ({
    SchedulingComposite: (): JSX.Element => (
        <div data-testid="scheduling-composite" />
    ),
}));

// ROK-2272 S9: a probe for the Discussion card, so the page wiring (which
// subject, and whether a locked-in poll hands over its event) is pinned.
vi.mock('../../components/discussion/subject-discussion-lazy', () => ({
    SubjectDiscussionCardLazy: (p: SubjectDiscussionCardProps): JSX.Element => (
        <div
            data-testid="poll-discussion-probe"
            data-subject={`${p.subject.kind}:${p.subject.id}`}
            data-locked-in={String(p.lockedInEventId ?? 'none')}
        />
    ),
}));

/** Render the page at its real route so `useParams` resolves. */
function renderPage(poll: SchedulePollPageResponseDto) {
    schedulePoll.mockReturnValue({ data: poll, isLoading: false, error: null });
    return renderWithProviders(
        <Routes>
            <Route
                path="/community-lineup/:lineupId/schedule/:matchId"
                element={<SchedulingPollPage />}
            />
        </Routes>,
        { initialEntries: ['/community-lineup/7/schedule/500'] },
    );
}

/** A locked-in poll exactly as the server returns it after create-event. */
function buildLockedInPoll(): SchedulePollPageResponseDto {
    const poll = buildPoll({
        pollStatus: 'locked_in',
        lockedInTime: '2030-06-10T20:00:00.000Z',
        canVote: false,
    });
    poll.match.status = 'scheduled';
    poll.match.linkedEventId = 314;
    return poll;
}

describe('SchedulingPollPage — locked-in ending (ROK-1545)', () => {
    beforeEach(() => {
        schedulePoll.mockReset();
    });

    it('renders the terminal banner for a scheduled match — the real locked-in path', () => {
        renderPage(buildLockedInPoll());
        const banner = screen.getByTestId('read-only-banner');
        expect(banner).toHaveAttribute('data-poll-status', 'locked_in');
        expect(banner).toHaveTextContent(/locked in/i);
    });

    /**
     * ROK-1546 AC4 — on the REAL locked-in path (a `scheduled` match routed to
     * `CompletedPollState`) the ending is still an announced live region, and
     * it is the ONLY one on the page: the "Poll Complete" card beside it
     * repeats the same news, so a second status region would double-announce.
     */
    it('AC4 — the locked-in ending is the page\'s single role=status region', () => {
        renderPage(buildLockedInPoll());
        const statuses = screen.getAllByRole('status');
        expect(statuses).toHaveLength(1);
        expect(statuses[0]).toHaveAttribute(
            'data-testid',
            'read-only-banner',
        );
        expect(statuses[0]).toHaveTextContent(/locked in/i);
    });

    it('links the created event from inside the banner', () => {
        renderPage(buildLockedInPoll());
        const banner = screen.getByTestId('read-only-banner');
        expect(
            banner.querySelector('[data-testid="terminal-event-link"]'),
        ).toHaveAttribute('href', '/events/314');
    });

    it('keeps the Poll Complete badge the shipped smoke specs resolve', () => {
        renderPage(buildLockedInPoll());
        expect(screen.getByTestId('match-status-badge')).toHaveTextContent(
            /poll complete/i,
        );
    });

    it('routes a still-open poll to the composite, not the completed state', () => {
        const poll = buildPoll({ pollStatus: 'open', canVote: true });
        poll.match.status = 'scheduling';
        renderPage(poll);
        expect(screen.getByTestId('scheduling-composite')).toBeInTheDocument();
        expect(screen.queryByTestId('read-only-banner')).not.toBeInTheDocument();
    });
});

describe('SchedulingPollPage — Discussion card wiring (ROK-2272 S9)', () => {
    beforeEach(() => {
        schedulePoll.mockReset();
    });

    it('a locked-in poll hands its linked event to the card (read-only + "View the event")', () => {
        renderPage(buildLockedInPoll());
        const probe = screen.getByTestId('poll-discussion-probe');
        expect(probe).toHaveAttribute('data-subject', 'poll:500');
        expect(probe).toHaveAttribute('data-locked-in', '314');
    });

    it('an open poll (even a reschedule with a linked event) keeps the card writable', () => {
        const poll = buildPoll({ pollStatus: 'open', canVote: true });
        poll.match.status = 'scheduling';
        poll.match.linkedEventId = 314;
        renderPage(poll);
        const probe = screen.getByTestId('poll-discussion-probe');
        expect(probe).toHaveAttribute('data-subject', 'poll:500');
        expect(probe).toHaveAttribute('data-locked-in', 'none');
    });
});

describe('SchedulingPollPage — locked-in poll whose event was cancelled (ROK-2330)', () => {
    beforeEach(() => {
        schedulePoll.mockReset();
    });

    /** The locked-in poll after its event was cancelled. */
    function buildCancelledEventPoll(): SchedulePollPageResponseDto {
        return { ...buildLockedInPoll(), linkedEventCancelledAt: '2030-06-09T12:00:00.000Z' };
    }

    it('shows the cancelled-event state instead of "Locked in"', () => {
        renderPage(buildCancelledEventPoll());
        const banner = screen.getByTestId('read-only-banner');
        expect(banner).toHaveAttribute('data-event-cancelled', 'true');
        expect(banner).toHaveTextContent(/event cancelled/i);
        expect(banner).not.toHaveTextContent(/^locked in/i);
    });

    it('offers no live link to the cancelled event anywhere on the page', () => {
        renderPage(buildCancelledEventPoll());
        expect(screen.queryByTestId('terminal-event-link')).toBeNull();
        expect(screen.queryByRole('link', { name: /view event/i })).toBeNull();
        expect(screen.getByTestId('match-status-badge')).toHaveTextContent(/poll complete/i);
        expect(screen.getByText(/its event was later cancelled/i)).toBeInTheDocument();
        expect(screen.getByTestId('poll-discussion-probe')).toHaveAttribute('data-locked-in', 'none');
    });

    it('drops the outcome card to the neutral tone, not the green success tone', () => {
        renderPage(buildCancelledEventPoll());
        const card = screen.getByTestId('poll-outcome-card');
        expect(card).toHaveAttribute('data-tone', 'neutral');
        expect(card.className).not.toMatch(/success/);
        expect(screen.getByTestId('match-status-badge').className).not.toMatch(/success/);
        expect(screen.getByText(/its event was later cancelled/i).className).not.toMatch(/success/);
    });

    it('keeps the green success tone when the linked event is live', () => {
        renderPage(buildLockedInPoll());
        expect(screen.getByTestId('poll-outcome-card')).toHaveAttribute('data-tone', 'success');
    });
});
