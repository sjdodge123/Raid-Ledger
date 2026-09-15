/**
 * The profile game-time editor picks a shape per viewport (ROK-1569).
 *
 * Phones get the poll check's own editor minus the question — one day on
 * screen over the profile's full 9am–1am range, the absence row and the sticky
 * Save. Desktop keeps the seven-column `GameTimePanel` exactly as it was.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { JSX } from 'react';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/render-helpers';
import { ProfileGameTimePanel } from '../game-time-panel';

let desktop = false;

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
    useGameTime: () => ({ data: { slots: [], gameTimeStale: false } }),
    useConfirmGameTime: () => ({ mutate: vi.fn(), isPending: false }),
    useSaveGameTime: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../../../components/features/game-time/game-time-absence', () => ({
    AbsenceSection: (): JSX.Element => <div data-testid="absence-section" />,
}));

beforeEach(() => vi.clearAllMocks());

describe('ProfileGameTimePanel', () => {
    it('gives phones the one-day editor with absences and Save, and nothing to answer', () => {
        desktop = false;
        renderWithProviders(<ProfileGameTimePanel />);

        expect(screen.getByRole('heading', { name: 'My Game Time' })).toBeInTheDocument();
        expect(screen.getByTestId('phone-week-editor')).toBeInTheDocument();
        expect(screen.getByTestId('phone-week-save')).toBeInTheDocument();
        expect(screen.getByTestId('phone-week-away')).toBeInTheDocument();
        expect(screen.queryByTestId('phone-week-prompt')).not.toBeInTheDocument();
        expect(screen.queryByTestId('phone-week-same')).not.toBeInTheDocument();
        expect(screen.queryByTestId('phone-week-skip')).not.toBeInTheDocument();
        expect(screen.queryByTestId('desktop-game-time-panel')).not.toBeInTheDocument();
    });

    it('edits the profile\'s full 9am–1am range, not the check\'s evening window (review MAJOR 3)', () => {
        desktop = false;
        renderWithProviders(<ProfileGameTimePanel />);
        expect(screen.getAllByTestId(/^phone-hour-/)).toHaveLength(17);
        expect(screen.getByTestId('phone-hour-9')).toBeInTheDocument();
        expect(screen.getByTestId('phone-hour-1')).toBeInTheDocument();
    });

    it('bounds the phone editor tall enough for 44px rows (the page scrolls, the editor never does)', () => {
        desktop = false;
        renderWithProviders(<ProfileGameTimePanel />);
        expect(screen.getByTestId('profile-game-time-phone').className).toContain('min-h-[980px]');
    });

    it('leaves the desktop week grid alone', () => {
        desktop = true;
        renderWithProviders(<ProfileGameTimePanel />);

        expect(screen.getByTestId('desktop-game-time-panel')).toBeInTheDocument();
        expect(screen.queryByTestId('phone-week-editor')).not.toBeInTheDocument();
    });
});
