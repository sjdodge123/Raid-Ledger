/**
 * Tech-debt [19] — a `?lock=` deep link on a stale-game-time viewer must not
 * stack two blocking dialogs.
 *
 * The poll-expiry DM opens the lock-in confirm (`EarlyCreateConfirmModal`) via
 * `?lock=<slotId>`. The same viewer's game time is stale, so the game-time
 * check (phone `BottomSheet` / desktop `Modal`) also auto-opens — two
 * `role="dialog"` layers at once. The lock confirm is the action the viewer
 * came for, so the check waits behind it and returns once it is dismissed.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../../test/render-helpers';

vi.mock('../../../../hooks/use-scheduling', () => ({
    useToggleScheduleVote: () => ({
        mutateAsync: vi.fn(() => new Promise<never>(() => {})),
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

vi.mock('../../../../hooks/use-lineup-matches', () => ({
    useLineupMatches: () => ({ data: undefined, isLoading: false }),
}));

vi.mock('../../../../hooks/use-auth', () => ({
    useAuth: () => ({ user: { id: 99, role: 'operator' }, isAuthenticated: true }),
    isOperatorOrAdmin: (u: { role?: string } | null) =>
        u?.role === 'operator' || u?.role === 'admin',
}));

/** A viewer whose game time is stale — the gate opens the check. */
vi.mock('../../../../hooks/use-game-time', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../../hooks/use-game-time')>()),
    useGameTime: () => ({
        data: { slots: [], events: [], weekStart: null, gameTimeStale: true, gameTimeAgeDays: 45 },
        isLoading: false,
    }),
}));

vi.mock('../../../../lib/api-client', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../../lib/api-client')>()),
    getSchedulePoll: vi.fn(),
}));

import { getSchedulePoll } from '../../../../lib/api-client';
import { SchedulingComposite } from '../SchedulingComposite';
import { buildPoll } from './scheduling-poll-fixtures';

/** The fixture's first slot — a future time an operator may lock. */
const LOCK_SLOT_ID = 1001;

/** Force `useMediaQuery('(min-width: 1024px)')` to a known answer. */
function setViewport(isDesktop: boolean): void {
    vi.stubGlobal('matchMedia', (query: string) => ({
        matches: query.includes('1024') ? isDesktop : false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
    }));
}

/** Render the composite as the DM's `?lock=` deep link lands. */
async function renderDeepLinked(): Promise<void> {
    const poll = buildPoll({ lineupCreatedById: 99 });
    vi.mocked(getSchedulePoll).mockResolvedValue(poll);
    renderWithProviders(
        <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
        { initialEntries: [`/lineups/7/schedule/500?lock=${LOCK_SLOT_ID}`] },
    );
    // The lock confirm is the dialog the viewer came for.
    await screen.findByRole('button', { name: 'Cancel' });
}

beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('SchedulingComposite — ?lock= deep link + stale game time ([19])', () => {
    it('phone: renders exactly one blocking dialog — the lock confirm', async () => {
        setViewport(false);
        await renderDeepLinked();

        expect(screen.getAllByRole('dialog')).toHaveLength(1);
        expect(screen.queryByTestId('game-time-check-sheet')).not.toBeInTheDocument();
    });

    it('phone: the game-time check returns once the lock confirm is dismissed', async () => {
        setViewport(false);
        await renderDeepLinked();

        await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel' }));

        expect(await screen.findByTestId('game-time-check-sheet')).toBeInTheDocument();
        await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1));
    });

    it('desktop: renders exactly one blocking dialog — the lock confirm', async () => {
        setViewport(true);
        await renderDeepLinked();

        expect(screen.getAllByRole('dialog')).toHaveLength(1);
        expect(screen.queryByText('Anything changed?')).not.toBeInTheDocument();
    });
});
