import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { GameTimeWidget } from './GameTimeWidget';

const useGameTimeEditorMock = vi.fn();
vi.mock('../../../hooks/use-game-time-editor', () => ({
    useGameTimeEditor: (options?: unknown) => useGameTimeEditorMock(options),
}));

// Mock useCancelSignup (used by EventBlockPopover)
vi.mock('../../../hooks/use-signups', () => ({
    useCancelSignup: () => ({
        mutateAsync: vi.fn(),
        isPending: false,
    }),
}));

function makeEditorData(overrides: Record<string, unknown> = {}) {
    return {
        slots: [],
        events: [],
        nextWeekEvents: undefined,
        nextWeekSlots: undefined,
        isLoading: false,
        weekStart: '2026-02-08',
        isDirty: false,
        handleChange: vi.fn(),
        save: vi.fn(),
        clear: vi.fn(),
        discard: vi.fn(),
        isSaving: false,
        tzLabel: 'EST',
        todayIndex: 1, // Monday
        currentHour: 16.5,
        overrides: [],
        absences: [],
        ...overrides,
    };
}

function mockEditorData(overrides: Record<string, unknown> = {}) {
    useGameTimeEditorMock.mockReturnValue(makeEditorData(overrides));
}

beforeEach(() => {
    useGameTimeEditorMock.mockReset();
});

function renderWidget(props: {
    eventStart: string;
    eventEnd: string;
    eventTitle?: string;
    gameName?: string;
    attendees?: Array<{
        id: number;
        username: string;
        avatar: string | null;
        customAvatarUrl?: string | null;
        discordId?: string | null;
        characters?: Array<{ gameId: number | string; name?: string; avatarUrl: string | null }>;
    }>;
    attendeeCount?: number;
    gameId?: number;
}) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <MemoryRouter>
            <QueryClientProvider client={queryClient}>
                <GameTimeWidget
                    eventStartTime={props.eventStart}
                    eventEndTime={props.eventEnd}
                    eventTitle={props.eventTitle}
                    gameName={props.gameName}
                    gameId={props.gameId}
                    attendees={props.attendees}
                    attendeeCount={props.attendeeCount}
                />
            </QueryClientProvider>
        </MemoryRouter>,
    );
}

describe('GameTimeWidget — part 1', () => {
    it('shows overlap message when template matches event hours', () => {
        // 2026-02-09 is Monday. Slots use Sunday-first convention (0=Sun..6=Sat),
        // matching JS Date.getDay() — so Monday = dayOfWeek=1. See ROK-1039.
        mockEditorData({
            slots: [
                { dayOfWeek: 1, hour: 19, status: 'available' },
                { dayOfWeek: 1, hour: 20, status: 'available' },
            ],
        });

        renderWidget({ eventStart: '2026-02-09T19:00:00', eventEnd: '2026-02-09T22:00:00' });

        expect(screen.getByText('Inside Game Time')).toBeInTheDocument();
    });

    it('uses the single-week editor mode instead of rolling composite mode', () => {
        mockEditorData();

        renderWidget({ eventStart: '2026-02-09T19:00:00', eventEnd: '2026-02-09T22:00:00' });

        expect(useGameTimeEditorMock).toHaveBeenCalledWith({ enabled: true, rolling: false });
    });

    it('shows no-overlap message when template does not match', () => {
        mockEditorData({
            slots: [
                { dayOfWeek: 5, hour: 10, status: 'available' },
            ],
        });

        renderWidget({ eventStart: '2026-02-09T19:00:00', eventEnd: '2026-02-09T22:00:00' });

        expect(screen.getByText('Outside Game Time')).toBeInTheDocument();
    });

    it('click opens read-only modal with GameTimeGrid', () => {
        mockEditorData({
            slots: [{ dayOfWeek: 0, hour: 19, status: 'available' }],
        });

        renderWidget({ eventStart: '2026-02-09T19:00:00', eventEnd: '2026-02-09T22:00:00' });

        fireEvent.click(screen.getByTestId('game-time-widget'));

        expect(screen.getByText('My Game Time')).toBeInTheDocument();
        expect(screen.getByTestId('game-time-grid')).toBeInTheDocument();
    });

    it('modal shows a simple selected highlight for the current event', () => {
        mockEditorData({
            slots: [{ dayOfWeek: 0, hour: 19, status: 'available' }],
        });

        renderWidget({ eventStart: '2026-02-09T19:00:00', eventEnd: '2026-02-09T22:00:00' });

        fireEvent.click(screen.getByTestId('game-time-widget'));

        const previewBlock = screen.getByTestId('preview-block-1-19');
        expect(previewBlock).toBeInTheDocument();
        expect(previewBlock.style.border).toContain('solid');
        expect(previewBlock).toHaveTextContent('');
    });

    it('modal shows event title inside the highlighted preview block AND in the detail card below', () => {
        mockEditorData({
            slots: [{ dayOfWeek: 0, hour: 19, status: 'available' }],
        });

        renderWidget({
            eventStart: '2026-02-09T19:00:00',
            eventEnd: '2026-02-09T22:00:00',
            eventTitle: 'Raid Night',
            gameName: 'World of Warcraft',
        });

        fireEvent.click(screen.getByTestId('game-time-widget'));

        // Preview block now renders a brief event summary (RichEventBlock) — matches reschedule modal pattern.
        const previewBlock = screen.getByTestId('preview-block-1-19');
        expect(previewBlock).toBeInTheDocument();
        expect(previewBlock).toHaveTextContent('Raid Night');
        expect(previewBlock).toHaveTextContent('World of Warcraft');

        // Title also appears in the EventDetailCard below the grid → 2 matches total.
        const titleMatches = screen.getAllByText('Raid Night');
        expect(titleMatches.length).toBeGreaterThanOrEqual(2);
    });

    it('preview block resolves character avatars when gameId is threaded through (ROK-1133)', () => {
        mockEditorData({
            slots: [{ dayOfWeek: 0, hour: 19, status: 'available' }],
        });

        renderWidget({
            eventStart: '2026-02-09T19:00:00',
            eventEnd: '2026-02-09T22:00:00',
            eventTitle: 'Raid Night',
            gameName: 'World of Warcraft',
            gameId: 5,
            attendees: [
                {
                    id: 42,
                    username: 'Astra',
                    avatar: null,
                    discordId: null,
                    characters: [{ gameId: 5, avatarUrl: '/char.png' }],
                },
            ],
            attendeeCount: 1,
        });

        fireEvent.click(screen.getByTestId('game-time-widget'));

        const previewBlock = screen.getByTestId('preview-block-1-19');
        const charAvatar = previewBlock.querySelector('img[src*="/char.png"]');
        expect(charAvatar).not.toBeNull();
    });

});

describe('GameTimeWidget — part 2', () => {
    it('modal is read-only (cells are not paintable)', () => {
        const handleChange = vi.fn();
        mockEditorData({
            slots: [],
            handleChange,
        });

        renderWidget({ eventStart: '2026-02-09T19:00:00', eventEnd: '2026-02-09T22:00:00' });

        fireEvent.click(screen.getByTestId('game-time-widget'));

        // Try to paint a visible cell — should NOT trigger onChange since grid is readOnly.
        fireEvent.pointerDown(screen.getByTestId('cell-2-18'));
        fireEvent.pointerUp(screen.getByTestId('cell-2-18'));

        expect(handleChange).not.toHaveBeenCalled();
    });

    it('modal has "Edit my game time" link to profile', () => {
        mockEditorData({
            slots: [{ dayOfWeek: 0, hour: 19, status: 'available' }],
        });

        renderWidget({ eventStart: '2026-02-09T19:00:00', eventEnd: '2026-02-09T22:00:00' });

        fireEvent.click(screen.getByTestId('game-time-widget'));

        const link = screen.getByText(/Edit my game time/);
        expect(link).toBeInTheDocument();
        expect(link.closest('a')).toHaveAttribute('href', '/profile/gaming');
    });

    it('modal uses compact grid sizing to match other game-time views', () => {
        mockEditorData({
            slots: [{ dayOfWeek: 0, hour: 19, status: 'available' }],
        });

        renderWidget({ eventStart: '2026-02-09T19:00:00', eventEnd: '2026-02-09T22:00:00' });

        fireEvent.click(screen.getByTestId('game-time-widget'));

        expect(screen.getByTestId('cell-2-18')).toHaveClass('h-4');
    });

});
