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

const schedulePoll = vi.fn();

vi.mock('../../hooks/use-scheduling', () => ({
    useSchedulePoll: () => schedulePoll(),
    useOtherPolls: () => ({ data: undefined, isLoading: false }),
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
