/**
 * ROK-2033 — the stalled lock-in on the REAL page path.
 *
 * A stalled claim is `status = 'scheduled'` with no linked event, so the PAGE
 * routes it to `CompletedPollState` before the composite ever renders. The
 * `SchedulingReopenLockInAction` specs mount the banner directly, which is why
 * a page that never mounted it went unnoticed (fleet verify lane). These tests
 * render the page itself.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import type { JSX } from 'react';
import type { SchedulePollPageResponseDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../test/render-helpers';
import { buildPoll } from '../../components/lineups/cycle-4/__tests__/scheduling-poll-fixtures';
import { REOPEN_BANNER_COPY } from '../../components/lineups/cycle-4/SchedulingReopenLockInAction';
import { SchedulingPollPage } from '../scheduling-poll-page';

const schedulePoll = vi.fn();

vi.mock('../../hooks/use-scheduling', () => ({
    useSchedulePoll: () => schedulePoll(),
    useOtherPolls: () => ({ data: undefined, isLoading: false }),
    useReopenLockIn: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('../../hooks/use-schedule-poll-realtime', () => ({
    useLiveSchedulePoll: () => schedulePoll(),
}));

vi.mock('../../hooks/use-game-time', () => ({
    useGameTime: () => ({ data: undefined, isLoading: false }),
}));

let authedUser: { id: number; role: string } | null = { id: 1, role: 'admin' };
vi.mock('../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../hooks/use-auth')>()),
    useAuth: () => ({ user: authedUser, isAuthenticated: authedUser !== null }),
}));

vi.mock('../../hooks/use-media-query', () => ({
    useMediaQuery: () => true,
}));

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

/**
 * A claimed-never-linked match as the server returns it: `scheduled`, no
 * linked event, and `lockInRecoverable` only when the viewer is an admin.
 */
function buildStalledPoll(recoverable: boolean): SchedulePollPageResponseDto {
    const poll = buildPoll({ pollStatus: 'locked_in', canVote: false });
    poll.match.status = 'scheduled';
    poll.match.linkedEventId = null;
    return recoverable ? { ...poll, lockInRecoverable: true } : poll;
}

const FALSE_CLAIM = /an event has been created/i;
const LOCKED_IN_COPY = 'This poll has been locked in.';

describe('SchedulingPollPage — stalled lock-in (ROK-2033)', () => {
    beforeEach(() => {
        schedulePoll.mockReset();
        authedUser = { id: 1, role: 'admin' };
    });

    it('admin + stalled claim → warning banner with "Reopen lock-in", no success card', () => {
        renderPage(buildStalledPoll(true));
        const banner = screen.getByTestId('scheduling-reopen-lock-in');
        expect(banner).toHaveTextContent(REOPEN_BANNER_COPY);
        expect(
            screen.getByRole('button', { name: 'Reopen lock-in' }),
        ).toBeInTheDocument();
        expect(screen.queryByTestId('match-status-badge')).not.toBeInTheDocument();
        expect(screen.queryByText(FALSE_CLAIM)).not.toBeInTheDocument();
    });

    it('linked event → completed state, no Reopen banner', () => {
        const poll = buildPoll({ pollStatus: 'locked_in', canVote: false });
        poll.match.status = 'scheduled';
        poll.match.linkedEventId = 314;
        renderPage(poll);
        expect(screen.getByTestId('match-status-badge')).toHaveTextContent(
            /poll complete/i,
        );
        expect(
            screen.queryByTestId('scheduling-reopen-lock-in'),
        ).not.toBeInTheDocument();
    });

    it('non-admin + stalled claim → no Reopen button and no "event created" claim', () => {
        authedUser = { id: 2, role: 'member' };
        renderPage(buildStalledPoll(false));
        expect(screen.getByTestId('match-status-badge')).toBeInTheDocument();
        expect(
            screen.queryByRole('button', { name: 'Reopen lock-in' }),
        ).not.toBeInTheDocument();
        expect(screen.queryByText(FALSE_CLAIM)).not.toBeInTheDocument();
        expect(screen.getByText(LOCKED_IN_COPY)).toBeInTheDocument();
    });

    it('admin + no recoverable flag (deleted event / legacy row) → completed card, locked-in copy, no banner', () => {
        renderPage(buildStalledPoll(false));
        expect(screen.getByTestId('match-status-badge')).toHaveTextContent(
            /poll complete/i,
        );
        expect(screen.getByText(LOCKED_IN_COPY)).toBeInTheDocument();
        expect(
            screen.queryByTestId('scheduling-reopen-lock-in'),
        ).not.toBeInTheDocument();
        expect(screen.queryByText(FALSE_CLAIM)).not.toBeInTheDocument();
    });
});
