import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WeekEventCard } from './WeekEventCard';
import type { CalendarEvent } from './CalendarView';
import type { EventResponseDto } from '@raid-ledger/contract';

// --- Helpers ---

function createMockEvent(overrides: Partial<EventResponseDto> = {}): CalendarEvent {
    const resource: EventResponseDto = {
        id: 1,
        title: 'Test Raid',
        description: 'A test event',
        startTime: '2026-02-10T20:00:00Z',
        endTime: '2026-02-10T23:00:00Z',
        creator: { id: 10, username: 'RaidLeader', avatar: null },
        game: { id: 1, name: 'World of Warcraft', slug: 'world-of-warcraft', coverUrl: null },
        signupCount: 3,
        createdAt: '2026-02-01T00:00:00Z',
        updatedAt: '2026-02-01T00:00:00Z',
        ...overrides,
    };
    return {
        id: resource.id,
        title: resource.title,
        start: new Date(resource.startTime),
        end: resource.endTime ? new Date(resource.endTime) : new Date(resource.startTime),
        resource,
    };
}

/** Build event with a specific duration in minutes */
function eventWithDuration(mins: number, overrides: Partial<EventResponseDto> = {}): CalendarEvent {
    const start = new Date('2026-02-10T20:00:00Z');
    const end = new Date(start.getTime() + mins * 60 * 1000);
    return createMockEvent({
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        ...overrides,
    });
}

const noopOverlap = () => false;

function renderCard(event?: CalendarEvent, overlapFn?: (s: Date, e: Date) => boolean) {
    return render(
        <WeekEventCard
            event={event ?? createMockEvent()}
            eventOverlapsGameTime={overlapFn ?? noopOverlap}
        />,
    );
}

// --- Tests ---

describe('WeekEventCard', () => {
    describe('tier selection', () => {
        it('selects minimal tier for events under 150 minutes', () => {
            const { container } = renderCard(eventWithDuration(120));
            const block = container.querySelector('.week-event-block');
            expect(block).toHaveAttribute('data-tier', 'minimal');
        });

        it('selects compact tier for 150-minute events', () => {
            const { container } = renderCard(eventWithDuration(150));
            const block = container.querySelector('.week-event-block');
            expect(block).toHaveAttribute('data-tier', 'compact');
        });

        it('selects compact tier for 240-minute events', () => {
            const { container } = renderCard(eventWithDuration(240));
            const block = container.querySelector('.week-event-block');
            expect(block).toHaveAttribute('data-tier', 'compact');
        });

        it('selects standard tier for events over 240 minutes', () => {
            const { container } = renderCard(eventWithDuration(300));
            const block = container.querySelector('.week-event-block');
            expect(block).toHaveAttribute('data-tier', 'standard');
        });
    });

    describe('content visibility', () => {
        it('always shows title, game name, and time', () => {
            renderCard(eventWithDuration(120));
            expect(screen.getByText('Test Raid')).toBeInTheDocument();
            expect(screen.getByText('World of Warcraft')).toBeInTheDocument();
            // Time range should be present (exact text depends on timezone)
            const timeEl = screen.getByText((_content, element) =>
                element?.classList.contains('week-event-time') ?? false,
            );
            expect(timeEl).toBeInTheDocument();
        });

        it('does not show creator name in any tier', () => {
            renderCard(eventWithDuration(300));
            expect(screen.queryByText('by RaidLeader')).not.toBeInTheDocument();
        });
    });

    describe('signup badge', () => {
        it('shows signup badge on minimal tier when signupCount > 0 and no preview', () => {
            renderCard(eventWithDuration(120, { signupCount: 5 }));
            const badge = screen.getByTestId('signup-badge');
            expect(badge).toBeInTheDocument();
            expect(badge).toHaveTextContent('5');
        });

        it('shows signup badge as fallback on compact tier when no signupsPreview', () => {
            renderCard(eventWithDuration(180, { signupCount: 3 }));
            const badge = screen.getByTestId('signup-badge');
            expect(badge).toBeInTheDocument();
            expect(badge).toHaveTextContent('3');
        });

        it('does not show signup badge when signupCount is 0', () => {
            renderCard(eventWithDuration(120, { signupCount: 0 }));
            expect(screen.queryByTestId('signup-badge')).not.toBeInTheDocument();
        });
    });

    describe('avatar rendering', () => {
        const mockSignups = [
            { id: 1, username: 'Player1', avatar: null, discordId: '1' },
            { id: 2, username: 'Player2', avatar: null, discordId: '2' },
            { id: 3, username: 'Player3', avatar: null, discordId: '3' },
            { id: 4, username: 'Player4', avatar: null, discordId: '4' },
            { id: 5, username: 'Player5', avatar: null, discordId: '5' },
        ];

        it('hides avatars on minimal tier even with signupsPreview', () => {
            renderCard(eventWithDuration(120, {
                signupCount: 5,
                signupsPreview: mockSignups,
            }));
            // Minimal tier should show badge, not avatars
            expect(screen.getByTestId('signup-badge')).toBeInTheDocument();
            expect(screen.queryByTitle('Player1')).not.toBeInTheDocument();
        });

        it('shows avatars on compact tier', () => {
            renderCard(eventWithDuration(180, {
                signupCount: 5,
                signupsPreview: mockSignups,
            }));
            expect(screen.queryByTestId('signup-badge')).not.toBeInTheDocument();
            // Avatars should be present (AttendeeAvatars component renders)
            expect(screen.getByTitle('Player1')).toBeInTheDocument();
        });

        it('shows avatars on standard tier', () => {
            renderCard(eventWithDuration(300, {
                signupCount: 5,
                signupsPreview: mockSignups,
            }));
            expect(screen.queryByTestId('signup-badge')).not.toBeInTheDocument();
            expect(screen.getByTitle('Player1')).toBeInTheDocument();
        });
    });

    describe('overlap indicator', () => {
        it('shows overlap dot when eventOverlapsGameTime returns true', () => {
            const { container } = renderCard(createMockEvent(), () => true);
            const dot = container.querySelector('[title="Overlaps with your game time"]');
            expect(dot).toBeInTheDocument();
        });

        it('hides overlap dot when eventOverlapsGameTime returns false', () => {
            const { container } = renderCard(createMockEvent(), () => false);
            const dot = container.querySelector('[title="Overlaps with your game time"]');
            expect(dot).not.toBeInTheDocument();
        });
    });

});
