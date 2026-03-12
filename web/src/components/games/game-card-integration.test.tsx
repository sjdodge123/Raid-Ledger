/**
 * Integration-style tests verifying wrapper components correctly wire
 * UnifiedGameCard with useWantToPlay logic (ROK-805).
 *
 * Tests:
 * 1. OnboardingCardWrapper (inline) — toggle fires only when not isToggling
 * 2. dimWhenInactive visual state via UnifiedGameCard toggle variant
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UnifiedGameCard } from './unified-game-card';
import { useWantToPlay } from '../../hooks/use-want-to-play';
import { useAuth } from '../../hooks/use-auth';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../../hooks/use-auth', () => ({
    useAuth: vi.fn(() => ({ isAuthenticated: true, user: { id: 1 } })),
    getAuthToken: vi.fn(() => 'fake-token'),
}));

vi.mock('../../hooks/use-want-to-play', () => ({
    useWantToPlay: vi.fn(() => ({
        wantToPlay: false,
        toggle: vi.fn(),
        isToggling: false,
        count: 0,
    })),
}));

vi.mock('../../hooks/use-want-to-play-batch', () => ({
    WantToPlayProvider: ({ children }: { children: React.ReactNode }) => (
        <>{children}</>
    ),
}));

const mockUseWantToPlay = vi.mocked(useWantToPlay);
const mockUseAuth = vi.mocked(useAuth);

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderWithProviders(ui: React.ReactElement) {
    const qc = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
    return render(
        <QueryClientProvider client={qc}>
            <MemoryRouter>{ui}</MemoryRouter>
        </QueryClientProvider>,
    );
}

function createGame(id: number, name = 'Test Game') {
    return {
        id,
        name,
        slug: name.toLowerCase().replace(/\s+/g, '-'),
        coverUrl: null as string | null,
        genres: [] as number[],
        aggregatedRating: null as number | null,
        rating: null as number | null,
        gameModes: [] as number[],
    };
}

/**
 * Inline OnboardingCardWrapper (mirrors the real implementation in games-step.tsx).
 * Tests that it correctly wires useWantToPlay to UnifiedGameCard toggle.
 */
function OnboardingCardWrapper({ game }: { game: ReturnType<typeof createGame> }) {
    const { isAuthenticated } = useAuth();
    const { wantToPlay, toggle, isToggling } = useWantToPlay(
        isAuthenticated ? game.id : undefined,
    );
    const handleToggle = (): void => {
        if (!isToggling && isAuthenticated) toggle(!wantToPlay);
    };
    return (
        <UnifiedGameCard
            variant="toggle"
            game={game}
            selected={wantToPlay}
            onToggle={handleToggle}
        />
    );
}

// ── OnboardingCardWrapper — useWantToPlay wiring ──────────────────────────────

describe('OnboardingCardWrapper — useWantToPlay wiring (ROK-805)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockUseAuth.mockReturnValue({
            isAuthenticated: true,
            user: { id: 1 },
        } as ReturnType<typeof useAuth>);
    });

    it('calls useWantToPlay with game.id when authenticated', () => {
        const mockToggle = vi.fn();
        mockUseWantToPlay.mockReturnValue({
            wantToPlay: false,
            toggle: mockToggle,
            isToggling: false,
            count: 0,
        } as ReturnType<typeof useWantToPlay>);

        renderWithProviders(<OnboardingCardWrapper game={createGame(42)} />);

        expect(mockUseWantToPlay).toHaveBeenCalledWith(42);
    });

    it('calls useWantToPlay with undefined when not authenticated', () => {
        mockUseAuth.mockReturnValue({
            isAuthenticated: false,
            user: null,
        } as ReturnType<typeof useAuth>);
        const mockToggle = vi.fn();
        mockUseWantToPlay.mockReturnValue({
            wantToPlay: false,
            toggle: mockToggle,
            isToggling: false,
            count: 0,
        } as ReturnType<typeof useWantToPlay>);

        renderWithProviders(<OnboardingCardWrapper game={createGame(7)} />);

        expect(mockUseWantToPlay).toHaveBeenCalledWith(undefined);
    });

    it('renders game name in the toggle card', () => {
        mockUseWantToPlay.mockReturnValue({
            wantToPlay: false,
            toggle: vi.fn(),
            isToggling: false,
            count: 0,
        } as ReturnType<typeof useWantToPlay>);

        renderWithProviders(<OnboardingCardWrapper game={createGame(1, 'Dark Souls')} />);

        expect(screen.getByText('Dark Souls')).toBeInTheDocument();
    });

    it('calls toggle(true) when clicked and wantToPlay is false', async () => {
        const user = userEvent.setup();
        const mockToggle = vi.fn();
        mockUseWantToPlay.mockReturnValue({
            wantToPlay: false,
            toggle: mockToggle,
            isToggling: false,
            count: 0,
        } as ReturnType<typeof useWantToPlay>);

        renderWithProviders(<OnboardingCardWrapper game={createGame(5)} />);
        await user.click(screen.getByRole('button'));

        expect(mockToggle).toHaveBeenCalledWith(true);
    });

    it('calls toggle(false) when clicked and wantToPlay is true', async () => {
        const user = userEvent.setup();
        const mockToggle = vi.fn();
        mockUseWantToPlay.mockReturnValue({
            wantToPlay: true,
            toggle: mockToggle,
            isToggling: false,
            count: 2,
        } as ReturnType<typeof useWantToPlay>);

        renderWithProviders(<OnboardingCardWrapper game={createGame(6)} />);
        await user.click(screen.getByRole('button'));

        expect(mockToggle).toHaveBeenCalledWith(false);
    });

    it('does not call toggle while isToggling=true (prevents double-fire)', async () => {
        const user = userEvent.setup();
        const mockToggle = vi.fn();
        mockUseWantToPlay.mockReturnValue({
            wantToPlay: false,
            toggle: mockToggle,
            isToggling: true,
            count: 0,
        } as ReturnType<typeof useWantToPlay>);

        renderWithProviders(<OnboardingCardWrapper game={createGame(8)} />);
        await user.click(screen.getByRole('button'));

        expect(mockToggle).not.toHaveBeenCalled();
    });

    it('does not call toggle when not authenticated', async () => {
        const user = userEvent.setup();
        const mockToggle = vi.fn();
        mockUseAuth.mockReturnValue({
            isAuthenticated: false,
            user: null,
        } as ReturnType<typeof useAuth>);
        mockUseWantToPlay.mockReturnValue({
            wantToPlay: false,
            toggle: mockToggle,
            isToggling: false,
            count: 0,
        } as ReturnType<typeof useWantToPlay>);

        renderWithProviders(<OnboardingCardWrapper game={createGame(9)} />);
        await user.click(screen.getByRole('button'));

        expect(mockToggle).not.toHaveBeenCalled();
    });
});

// ── dimWhenInactive visual state ──────────────────────────────────────────────

describe('UnifiedGameCard toggle — dimWhenInactive (ROK-805)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockUseAuth.mockReturnValue({
            isAuthenticated: false,
            user: null,
        } as ReturnType<typeof useAuth>);
        mockUseWantToPlay.mockReturnValue({
            wantToPlay: false,
            toggle: vi.fn(),
            isToggling: false,
            count: 0,
        } as ReturnType<typeof useWantToPlay>);
    });

    it('applies opacity-50 to unselected card when dimWhenInactive=true', () => {
        const { container } = renderWithProviders(
            <UnifiedGameCard
                variant="toggle"
                game={createGame(10)}
                selected={false}
                onToggle={vi.fn()}
                dimWhenInactive
            />,
        );
        const root = container.firstChild as HTMLElement;
        expect(root.className).toContain('opacity-50');
    });

    it('does not apply opacity-50 to selected card when dimWhenInactive=true', () => {
        const { container } = renderWithProviders(
            <UnifiedGameCard
                variant="toggle"
                game={createGame(11)}
                selected={true}
                onToggle={vi.fn()}
                dimWhenInactive
            />,
        );
        const root = container.firstChild as HTMLElement;
        expect(root.className).not.toContain('opacity-50');
    });

    it('does not apply opacity-50 when dimWhenInactive is omitted', () => {
        const { container } = renderWithProviders(
            <UnifiedGameCard
                variant="toggle"
                game={createGame(12)}
                selected={false}
                onToggle={vi.fn()}
            />,
        );
        const root = container.firstChild as HTMLElement;
        expect(root.className).not.toContain('opacity-50');
    });

    it('renders emerald border when selected=true', () => {
        const { container } = renderWithProviders(
            <UnifiedGameCard
                variant="toggle"
                game={createGame(13)}
                selected={true}
                onToggle={vi.fn()}
            />,
        );
        const root = container.firstChild as HTMLElement;
        expect(root.className).toContain('border-emerald-500');
    });
});
