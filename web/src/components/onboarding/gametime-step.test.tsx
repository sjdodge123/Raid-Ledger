import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GameTimeStep } from './gametime-step';

// Mock useMediaQuery to control mobile/desktop rendering
vi.mock('../../hooks/use-media-query', () => ({
    useMediaQuery: vi.fn(),
}));

const mockGameTimeEditor = {
    slots: [],
    isLoading: false,
    isDirty: false,
    handleChange: vi.fn(),
    save: vi.fn(),
    tzLabel: 'UTC',
};

vi.mock('../../hooks/use-game-time-editor', () => ({
    useGameTimeEditor: vi.fn(() => mockGameTimeEditor),
}));

vi.mock('../features/game-time/GameTimeGrid', () => ({
    GameTimeGrid: () => <div data-testid="game-time-grid">GameTimeGrid</div>,
}));

vi.mock('../features/game-time/GameTimeMobileEditor', () => ({
    GameTimeMobileEditor: () => <div data-testid="game-time-mobile-editor">GameTimeMobileEditor</div>,
}));

import { useMediaQuery } from '../../hooks/use-media-query';
import { useGameTimeEditor } from '../../hooks/use-game-time-editor';

const mockUseMediaQuery = useMediaQuery as unknown as ReturnType<typeof vi.fn>;
const mockUseGameTimeEditor = useGameTimeEditor as unknown as ReturnType<typeof vi.fn>;

function createQueryClient() {
    return new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
}

function renderWithProviders(ui: React.ReactElement) {
    return render(
        <QueryClientProvider client={createQueryClient()}>
            {ui}
        </QueryClientProvider>
    );
}

describe('GameTimeStep', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('Desktop rendering (≥768px)', () => {
        beforeEach(() => {
            mockUseMediaQuery.mockReturnValue(false); // not mobile
        });

        it('renders the desktop GameTimeGrid on non-mobile viewports', () => {
            renderWithProviders(<GameTimeStep />);
            expect(screen.getByTestId('game-time-grid')).toBeInTheDocument();
            expect(screen.queryByTestId('game-time-mobile-editor')).not.toBeInTheDocument();
        });

        it('shows drag instruction text on desktop', () => {
            renderWithProviders(<GameTimeStep />);
            expect(screen.getByText(/paint your weekly availability/i)).toBeInTheDocument();
        });

        it('renders the "When Do You Play?" heading', () => {
            renderWithProviders(<GameTimeStep />);
            expect(screen.getByText(/when do you play\?/i)).toBeInTheDocument();
        });
    });

    describe('Mobile rendering (<768px)', () => {
        beforeEach(() => {
            mockUseMediaQuery.mockReturnValue(true); // is mobile
        });

        it('renders the mobile GameTimeMobileEditor on mobile viewports', () => {
            renderWithProviders(<GameTimeStep />);
            expect(screen.getByTestId('game-time-mobile-editor')).toBeInTheDocument();
            expect(screen.queryByTestId('game-time-grid')).not.toBeInTheDocument();
        });

        it('shows tap instruction text on mobile', () => {
            renderWithProviders(<GameTimeStep />);
            expect(screen.getByText(/tap days to expand and toggle hours/i)).toBeInTheDocument();
        });

        it('renders the "When Do You Play?" heading on mobile too', () => {
            renderWithProviders(<GameTimeStep />);
            expect(screen.getByText(/when do you play\?/i)).toBeInTheDocument();
        });
    });

    describe('Loading state', () => {
        it('renders a loading spinner while data is loading', () => {
            mockUseMediaQuery.mockReturnValue(false);
            mockUseGameTimeEditor.mockReturnValue({
                slots: [],
                isLoading: true,
                isDirty: false,
                handleChange: vi.fn(),
                save: vi.fn(),
                tzLabel: 'UTC',
            });

            renderWithProviders(<GameTimeStep />);
            expect(screen.getByText(/loading/i)).toBeInTheDocument();
            expect(screen.queryByTestId('game-time-grid')).not.toBeInTheDocument();
            expect(screen.queryByTestId('game-time-mobile-editor')).not.toBeInTheDocument();
        });
    });

    describe('useMediaQuery called with correct breakpoint', () => {
        it('queries for max-width 767px (mobile breakpoint)', () => {
            mockUseMediaQuery.mockReturnValue(false);
            renderWithProviders(<GameTimeStep />);
            expect(mockUseMediaQuery).toHaveBeenCalledWith('(max-width: 767px)');
        });
    });
});
