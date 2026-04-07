import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GameTimeStep } from './gametime-step';

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

/** Captures the most recent props passed to GameTimeGrid */
let capturedGridProps: Record<string, unknown> = {};

vi.mock('../features/game-time/GameTimeGrid', () => ({
    GameTimeGrid: (props: Record<string, unknown>) => {
        capturedGridProps = props;
        return <div data-testid="game-time-grid">GameTimeGrid</div>;
    },
}));

import { useGameTimeEditor } from '../../hooks/use-game-time-editor';

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

describe('GameTimeStep — rendering (ROK-1011)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        capturedGridProps = {};
    });

    it('always renders GameTimeGrid with compact mode', () => {
        renderWithProviders(<GameTimeStep />);
        expect(screen.getByTestId('game-time-grid')).toBeInTheDocument();
        expect(screen.queryByTestId('game-time-mobile-editor')).not.toBeInTheDocument();
    });

    it('shows drag instruction text', () => {
        renderWithProviders(<GameTimeStep />);
        expect(screen.getByText(/paint your weekly availability/i)).toBeInTheDocument();
    });

    it('renders the "When Do You Play?" heading', () => {
        renderWithProviders(<GameTimeStep />);
        expect(screen.getByText(/when do you play\?/i)).toBeInTheDocument();
    });

    it('passes noStickyOffset to GameTimeGrid for FTE dialog without nav bar', () => {
        renderWithProviders(<GameTimeStep />);
        expect(capturedGridProps.noStickyOffset).toBe(true);
    });
});

describe('GameTimeStep — loading', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders a loading spinner while data is loading', () => {
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
    });
});
