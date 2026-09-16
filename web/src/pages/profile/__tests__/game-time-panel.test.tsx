/**
 * The profile game-time panel picks a shape per viewport (ROK-1569 → ROK-1584).
 *
 * ROK-1584 §3: on a phone the route IS the drawer. ROK-1579's summary card was
 * a stop on the way to the editor — every arrival tapped "Edit my week"
 * immediately — so the card is gone: the page mounts the "My game time" drawer
 * open, and × or Save take the viewer back where they came from. Desktop keeps
 * the seven-column `GameTimePanel` exactly as it was.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { JSX } from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GameTimeAbsence, GameTimeSlot } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../test/render-helpers';
import { ProfileGameTimePanel } from '../game-time-panel';

/** Mon–Fri 7–10 PM, as the API returns it. */
const WEEKDAY_EVENINGS: GameTimeSlot[] = [1, 2, 3, 4, 5].flatMap((dayOfWeek) =>
    [19, 20, 21].map((hour) => ({ dayOfWeek, hour, status: 'available' as const, fromTemplate: true })),
);
const AWAY: GameTimeAbsence[] = [{ id: 1, startDate: '2026-09-17', endDate: '2026-09-19', reason: null }];

let desktop = false;
/** The stub editor stands in only where a test drives the SAVE seam. */
let stubEditor = false;
let gameTime: {
    slots: GameTimeSlot[];
    absences: GameTimeAbsence[];
    gameTimeAgeDays: number | null;
    gameTimeStale: boolean;
} = { slots: [], absences: [], gameTimeAgeDays: null, gameTimeStale: false };

vi.mock('../../../hooks/use-media-query', () => ({
    useMediaQuery: (): boolean => desktop,
}));
vi.mock('../../../hooks/use-auth', () => ({
    useAuth: () => ({ isAuthenticated: true }),
}));
const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
    return { ...actual, useNavigate: () => navigate };
});
vi.mock('../../../components/features/game-time', () => ({
    GameTimePanel: (): JSX.Element => <div data-testid="desktop-game-time-panel" />,
}));
vi.mock('../../../hooks/use-game-time', () => ({
    useGameTime: () => ({ data: gameTime }),
    useConfirmGameTime: () => ({ mutate: vi.fn(), isPending: false }),
    useSaveGameTime: () => ({ mutate: vi.fn(), isPending: false }),
    useCreateAbsence: () => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false }),
    useDeleteAbsence: () => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false }),
    useGameTimeAbsences: () => ({ data: gameTime.absences }),
}));
vi.mock('../../../components/features/game-time/game-time-absence', () => ({
    AbsenceSection: (): JSX.Element => <div data-testid="absence-section" />,
}));

// The real editor only enables Save after a pointer-painted draft (jsdom has no
// geometry), so the save path swaps in a stub that reports done the same way.
vi.mock('../../../components/features/game-time/phone/PhoneWeekCheckStep', async (importOriginal) => {
    const actual = await importOriginal<
        typeof import('../../../components/features/game-time/phone/PhoneWeekCheckStep')
    >();
    const { useStepOneDone } = await import('../../scheduling/game-time-check-step');
    function SaveStub(): JSX.Element {
        const done = useStepOneDone();
        return (
            <div data-testid="phone-week-check">
                <button
                    type="button"
                    data-testid="phone-week-save"
                    onClick={() => {
                        gameTime = { ...gameTime, slots: WEEKDAY_EVENINGS, gameTimeAgeDays: 0 };
                        done();
                    }}
                >
                    Save my week
                </button>
            </div>
        );
    }
    return {
        PhoneWeekCheckStep: (props: Parameters<typeof actual.PhoneWeekCheckStep>[0]): JSX.Element =>
            stubEditor ? <SaveStub /> : <actual.PhoneWeekCheckStep {...props} />,
    };
});

beforeEach(() => {
    vi.clearAllMocks();
    desktop = false;
    stubEditor = false;
    gameTime = { slots: WEEKDAY_EVENINGS, absences: AWAY, gameTimeAgeDays: 9, gameTimeStale: true };
});

describe('ProfileGameTimePanel — the phone route IS the drawer (ROK-1584 §3)', () => {
    it('mounts the editor drawer open, with no summary card in front of it', () => {
        renderWithProviders(<ProfileGameTimePanel />);

        expect(screen.getByTestId('game-time-check-sheet')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'My game time' })).toBeInTheDocument();
        expect(screen.getByTestId('phone-week-check')).toHaveAttribute('data-variant', 'profile');
        expect(screen.queryByTestId('profile-game-time-summary')).not.toBeInTheDocument();
        expect(screen.queryByTestId('profile-game-time-edit')).not.toBeInTheDocument();
    });

    it('opens on the fitted evening, with both hour bands one tap away', async () => {
        renderWithProviders(<ProfileGameTimePanel />);

        // jsdom measures 0px, so the floor of eight rows applies: 5 PM–1 AM.
        expect(screen.getAllByTestId(/^phone-hour-/)).toHaveLength(8);
        expect(screen.getByTestId('phone-hour-0')).toBeInTheDocument();
        expect(screen.queryByTestId('phone-hour-6')).not.toBeInTheDocument();

        await userEvent.click(screen.getByTestId('phone-week-show-earlier'));
        expect(screen.getByTestId('phone-hour-6')).toBeInTheDocument();
        await userEvent.click(screen.getByTestId('phone-week-show-later'));
        expect(screen.getByTestId('phone-hour-5')).toBeInTheDocument();

        // Nothing to answer here, and nothing to skip.
        expect(screen.queryByTestId('phone-week-prompt')).not.toBeInTheDocument();
        expect(screen.queryByTestId('phone-week-same')).not.toBeInTheDocument();
        expect(screen.queryByTestId('phone-week-skip')).not.toBeInTheDocument();
    });

    // react-router stamps `idx` on history.state; > 0 means there is an
    // in-app entry to go back to (the More drawer, the poll, …).
    const arrivedFromInsideTheApp = (): void => window.history.replaceState({ idx: 2 }, '');
    const arrivedByDeepLink = (): void => window.history.replaceState(null, '');

    it('goes back where the viewer came from on ×', async () => {
        arrivedFromInsideTheApp();
        renderWithProviders(<ProfileGameTimePanel />);
        await userEvent.click(screen.getByRole('button', { name: 'Close sheet' }));

        expect(navigate).toHaveBeenCalledWith(-1);
    });

    it('goes back on Save too, without a second tap', async () => {
        arrivedFromInsideTheApp();
        stubEditor = true;
        renderWithProviders(<ProfileGameTimePanel />);
        await userEvent.click(screen.getByTestId('phone-week-save'));

        expect(navigate).toHaveBeenCalledWith(-1);
    });

    it('lands on the profile shell instead of leaving the app when a deep link has no history (review MAJOR-1)', async () => {
        arrivedByDeepLink();
        renderWithProviders(<ProfileGameTimePanel />);
        await userEvent.click(screen.getByRole('button', { name: 'Close sheet' }));

        expect(navigate).not.toHaveBeenCalledWith(-1);
        expect(navigate).toHaveBeenCalledWith('/profile', { replace: true });
    });
});

describe('ProfileGameTimePanel — desktop', () => {
    it('leaves the desktop week grid alone', () => {
        desktop = true;
        renderWithProviders(<ProfileGameTimePanel />);

        expect(screen.getByTestId('desktop-game-time-panel')).toBeInTheDocument();
        expect(screen.queryByTestId('game-time-check-sheet')).not.toBeInTheDocument();
        expect(screen.queryByTestId('phone-week-editor')).not.toBeInTheDocument();
    });

    it('still offers the poll deep link its way back (ROK-1564)', () => {
        desktop = true;
        renderWithProviders(<ProfileGameTimePanel />, {
            initialEntries: ['/profile/gaming/game-time?return=/scheduling/poll-7'],
        });

        expect(screen.getByTestId('game-time-return-link')).toHaveAttribute('href', '/scheduling/poll-7');
    });
});
