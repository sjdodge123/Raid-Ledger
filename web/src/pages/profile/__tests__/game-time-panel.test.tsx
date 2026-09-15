/**
 * The profile game-time editor picks a shape per viewport (ROK-1569).
 *
 * Phones get the poll check's own editor minus the question — one day on
 * screen, sticky Save, nothing else. Desktop keeps the seven-column
 * `GameTimePanel` exactly as it was.
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

beforeEach(() => vi.clearAllMocks());

describe('ProfileGameTimePanel', () => {
    it('gives phones the one-day editor with Save and nothing to answer', () => {
        desktop = false;
        renderWithProviders(<ProfileGameTimePanel />);

        expect(screen.getByTestId('phone-week-editor')).toBeInTheDocument();
        expect(screen.getByTestId('phone-week-save')).toBeInTheDocument();
        expect(screen.queryByTestId('phone-week-prompt')).not.toBeInTheDocument();
        expect(screen.queryByTestId('phone-week-same')).not.toBeInTheDocument();
        expect(screen.queryByTestId('phone-week-skip')).not.toBeInTheDocument();
        expect(screen.queryByTestId('desktop-game-time-panel')).not.toBeInTheDocument();
    });

    it('bounds the phone editor so nothing scrolls inside it', () => {
        desktop = false;
        renderWithProviders(<ProfileGameTimePanel />);
        expect(screen.getByTestId('profile-game-time-phone').className).toContain('h-[70dvh]');
    });

    it('leaves the desktop week grid alone', () => {
        desktop = true;
        renderWithProviders(<ProfileGameTimePanel />);

        expect(screen.getByTestId('desktop-game-time-panel')).toBeInTheDocument();
        expect(screen.queryByTestId('phone-week-editor')).not.toBeInTheDocument();
    });
});
