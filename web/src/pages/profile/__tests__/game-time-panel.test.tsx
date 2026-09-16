/**
 * The profile game-time panel picks a shape per viewport (ROK-1569 → ROK-1579).
 *
 * ROK-1579: the phone no longer paints the week editor inline under a 980px
 * box. It shows a summary card — the saved week in words, any absence, and how
 * old the confirmation is — with an "Edit my week" button that opens the SAME
 * drawer the poll's game-time check uses. Desktop keeps the seven-column
 * `GameTimePanel` exactly as it was.
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

describe('ProfileGameTimePanel — the phone summary card (ROK-1579)', () => {
    it('shows the saved week, the absence and the freshness line instead of the editor', () => {
        renderWithProviders(<ProfileGameTimePanel />);

        const card = screen.getByTestId('profile-game-time-summary');
        expect(screen.getByRole('heading', { name: 'My Game Time' })).toBeInTheDocument();
        expect(card).toHaveTextContent('Mon–Fri 7–10 PM');
        expect(card).toHaveTextContent('Away Sep 17–19');
        expect(card).toHaveTextContent('Your game time is 9 days old.');

        expect(screen.queryByTestId('phone-week-check')).not.toBeInTheDocument();
        expect(screen.queryByTestId('phone-week-editor')).not.toBeInTheDocument();
        expect(screen.queryByTestId('game-time-check-sheet')).not.toBeInTheDocument();
        expect(screen.queryByTestId('profile-game-time-phone')).not.toBeInTheDocument();
    });

    it('says so when there is no week yet, and shows no absence line', () => {
        gameTime = { slots: [], absences: [], gameTimeAgeDays: null, gameTimeStale: true };
        renderWithProviders(<ProfileGameTimePanel />);

        expect(screen.getByTestId('profile-game-time-summary')).toHaveTextContent('No game time yet');
        expect(screen.queryByText(/^Away /)).not.toBeInTheDocument();
    });

    it('offers a 44px "Edit my week" button', () => {
        renderWithProviders(<ProfileGameTimePanel />);
        const edit = screen.getByTestId('profile-game-time-edit');
        expect(edit).toHaveTextContent('Edit my week');
        expect(edit.className).toContain('min-h-[44px]');
    });
});

describe('ProfileGameTimePanel — the editor lives in the drawer (ROK-1579)', () => {
    it('opens the profile editor in the game-time drawer, over the profile page', async () => {
        renderWithProviders(<ProfileGameTimePanel />);
        await userEvent.click(screen.getByTestId('profile-game-time-edit'));

        expect(screen.getByTestId('game-time-check-sheet')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'My game time' })).toBeInTheDocument();
        expect(screen.getByTestId('phone-week-check')).toHaveAttribute('data-variant', 'profile');
        // The profile's full 9am–1am range, not the check's evening window.
        expect(screen.getAllByTestId(/^phone-hour-/)).toHaveLength(17);
        expect(screen.getByTestId('phone-hour-9')).toBeInTheDocument();
        expect(screen.getByTestId('phone-hour-1')).toBeInTheDocument();
        // Nothing to answer here, and nothing to skip.
        expect(screen.queryByTestId('phone-week-prompt')).not.toBeInTheDocument();
        expect(screen.queryByTestId('phone-week-same')).not.toBeInTheDocument();
        expect(screen.queryByTestId('phone-week-skip')).not.toBeInTheDocument();
    });

    it('closes the drawer again on ×, leaving the card', async () => {
        renderWithProviders(<ProfileGameTimePanel />);
        await userEvent.click(screen.getByTestId('profile-game-time-edit'));
        await userEvent.click(screen.getByRole('button', { name: 'Close sheet' }));

        expect(screen.queryByTestId('game-time-check-sheet')).not.toBeInTheDocument();
        expect(screen.getByTestId('profile-game-time-summary')).toBeInTheDocument();
    });

    it('re-opens after a close — the drawer is not a one-shot', async () => {
        renderWithProviders(<ProfileGameTimePanel />);
        await userEvent.click(screen.getByTestId('profile-game-time-edit'));
        await userEvent.click(screen.getByRole('button', { name: 'Close sheet' }));
        await userEvent.click(screen.getByTestId('profile-game-time-edit'));

        expect(screen.getByTestId('game-time-check-sheet')).toBeInTheDocument();
    });

    it('collapses the drawer on Save and shows the new week without a reload', async () => {
        stubEditor = true;
        gameTime = { slots: [], absences: [], gameTimeAgeDays: null, gameTimeStale: true };
        renderWithProviders(<ProfileGameTimePanel />);
        expect(screen.getByTestId('profile-game-time-summary')).toHaveTextContent('No game time yet');

        await userEvent.click(screen.getByTestId('profile-game-time-edit'));
        await userEvent.click(screen.getByTestId('phone-week-save'));

        expect(screen.queryByTestId('game-time-check-sheet')).not.toBeInTheDocument();
        expect(screen.getByTestId('profile-game-time-summary')).toHaveTextContent('Mon–Fri 7–10 PM');
    });

    it('opens the drawer straight away when a poll sent the viewer here to edit (?return=)', () => {
        renderWithProviders(<ProfileGameTimePanel />, {
            initialEntries: ['/profile/gaming/game-time?return=/scheduling/poll-7'],
        });

        expect(screen.getByTestId('game-time-check-sheet')).toBeInTheDocument();
        expect(screen.getByTestId('game-time-return-link')).toHaveAttribute('href', '/scheduling/poll-7');
    });
});

describe('ProfileGameTimePanel — desktop', () => {
    it('leaves the desktop week grid alone', () => {
        desktop = true;
        renderWithProviders(<ProfileGameTimePanel />);

        expect(screen.getByTestId('desktop-game-time-panel')).toBeInTheDocument();
        expect(screen.queryByTestId('profile-game-time-summary')).not.toBeInTheDocument();
        expect(screen.queryByTestId('phone-week-editor')).not.toBeInTheDocument();
    });
});
