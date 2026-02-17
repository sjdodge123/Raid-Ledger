import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScheduleView } from './ScheduleView';
import type { CalendarEvent } from './CalendarView';
import type { EventResponseDto } from '@raid-ledger/contract';

// Mock MobileEventCard so we can assert it renders without full integration
vi.mock('../events/mobile-event-card', () => ({
    MobileEventCard: ({ event, onClick, matchesGameTime }: { event: EventResponseDto; onClick?: () => void; matchesGameTime?: boolean }) => (
        <div
            data-testid="mobile-event-card"
            data-event-id={event.id}
            data-matches-game-time={matchesGameTime ? 'true' : 'false'}
            onClick={onClick}
        >
            {event.title}
        </div>
    ),
}));

const MOCK_NOW = new Date('2026-02-10T12:00:00Z');

function makeMockEventDto(overrides: Partial<EventResponseDto> = {}): EventResponseDto {
    return {
        id: 1,
        title: 'Test Raid',
        description: '',
        startTime: '2026-02-10T20:00:00Z',
        endTime: '2026-02-10T22:00:00Z',
        creator: { id: 1, username: 'Tester', avatar: null },
        game: { id: 1, name: 'World of Warcraft', slug: 'wow', coverUrl: null },
        signupCount: 0,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        ...overrides,
    };
}

function makeCalendarEvent(
    id: number,
    title: string,
    start: Date,
    end: Date,
    dtoOverrides: Partial<EventResponseDto> = {},
): CalendarEvent {
    return {
        id,
        title,
        start,
        end,
        resource: makeMockEventDto({ id, title, ...dtoOverrides }),
    };
}

const defaultProps = {
    events: [] as CalendarEvent[],
    currentDate: MOCK_NOW,
    onDateChange: vi.fn(),
    onSelectEvent: vi.fn(),
    eventOverlapsGameTime: vi.fn(() => false),
};

describe('ScheduleView', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(MOCK_NOW);
        defaultProps.onDateChange.mockClear();
        defaultProps.onSelectEvent.mockClear();
        (defaultProps.eventOverlapsGameTime as ReturnType<typeof vi.fn>).mockClear();
        (defaultProps.eventOverlapsGameTime as ReturnType<typeof vi.fn>).mockReturnValue(false);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('Empty state', () => {
        it('renders empty state when no events', () => {
            render(<ScheduleView {...defaultProps} events={[]} />);
            expect(screen.getByText('No events this week')).toBeInTheDocument();
        });

        it('does not render schedule-view container when empty', () => {
            const { container } = render(<ScheduleView {...defaultProps} events={[]} />);
            expect(container.querySelector('.schedule-view')).toBeNull();
        });
    });

    describe('Event grouping by day', () => {
        it('renders events grouped under correct day header', () => {
            const events = [
                makeCalendarEvent(1, 'Event A', new Date('2026-02-12T10:00:00'), new Date('2026-02-12T12:00:00')),
                makeCalendarEvent(2, 'Event B', new Date('2026-02-13T15:00:00'), new Date('2026-02-13T17:00:00')),
            ];

            render(<ScheduleView {...defaultProps} events={events} />);

            // Both day groups present
            expect(screen.getByText(/Thursday, Feb 12/)).toBeInTheDocument();
            expect(screen.getByText(/Friday, Feb 13/)).toBeInTheDocument();

            // Both event cards present
            const cards = screen.getAllByTestId('mobile-event-card');
            expect(cards).toHaveLength(2);
        });

        it('groups multiple events under same day header', () => {
            const events = [
                makeCalendarEvent(1, 'Morning Raid', new Date('2026-02-12T08:00:00'), new Date('2026-02-12T10:00:00')),
                makeCalendarEvent(2, 'Evening Raid', new Date('2026-02-12T18:00:00'), new Date('2026-02-12T20:00:00')),
            ];

            render(<ScheduleView {...defaultProps} events={events} />);

            // Only one day header
            const headers = screen.getAllByText(/Thursday, Feb 12/);
            expect(headers).toHaveLength(1);

            // Two event cards
            const cards = screen.getAllByTestId('mobile-event-card');
            expect(cards).toHaveLength(2);
        });

        it('renders events sorted by start time within the same day', () => {
            const events = [
                makeCalendarEvent(2, 'Evening Raid', new Date('2026-02-12T18:00:00'), new Date('2026-02-12T20:00:00')),
                makeCalendarEvent(1, 'Morning Raid', new Date('2026-02-12T08:00:00'), new Date('2026-02-12T10:00:00')),
            ];

            render(<ScheduleView {...defaultProps} events={events} />);

            const cards = screen.getAllByTestId('mobile-event-card');
            expect(cards[0]).toHaveTextContent('Morning Raid');
            expect(cards[1]).toHaveTextContent('Evening Raid');
        });

        it('renders day groups in ascending date order', () => {
            const events = [
                makeCalendarEvent(2, 'Later Event', new Date('2026-02-14T10:00:00'), new Date('2026-02-14T12:00:00')),
                makeCalendarEvent(1, 'Earlier Event', new Date('2026-02-12T10:00:00'), new Date('2026-02-12T12:00:00')),
            ];

            render(<ScheduleView {...defaultProps} events={events} />);

            const headers = screen.getAllByRole('heading', { level: 3 });
            expect(headers[0]).toHaveTextContent('Thursday, Feb 12');
            expect(headers[1]).toHaveTextContent('Saturday, Feb 14');
        });
    });

    describe('Sticky day headers', () => {
        it('renders sticky headers with correct class', () => {
            const events = [
                makeCalendarEvent(1, 'Raid A', new Date('2026-02-12T10:00:00'), new Date('2026-02-12T12:00:00')),
            ];

            const { container } = render(<ScheduleView {...defaultProps} events={events} />);

            const stickyHeader = container.querySelector('.sticky');
            expect(stickyHeader).toBeInTheDocument();
            expect(stickyHeader).toHaveClass('top-0', 'z-10');
        });

        it('renders one sticky header per day group', () => {
            const events = [
                makeCalendarEvent(1, 'Day 1 Raid', new Date('2026-02-12T10:00:00'), new Date('2026-02-12T12:00:00')),
                makeCalendarEvent(2, 'Day 2 Raid', new Date('2026-02-13T10:00:00'), new Date('2026-02-13T12:00:00')),
            ];

            const { container } = render(<ScheduleView {...defaultProps} events={events} />);

            const stickyHeaders = container.querySelectorAll('.sticky');
            expect(stickyHeaders).toHaveLength(2);
        });

        it('labels today as "Today - ..."', () => {
            // MOCK_NOW is 2026-02-10T12:00:00Z
            const events = [
                makeCalendarEvent(1, 'Today Raid', new Date('2026-02-10T18:00:00'), new Date('2026-02-10T20:00:00')),
            ];

            render(<ScheduleView {...defaultProps} events={events} />);

            expect(screen.getByText(/^Today - Tuesday, Feb 10$/)).toBeInTheDocument();
        });

        it('does not label non-today dates with "Today"', () => {
            const events = [
                makeCalendarEvent(1, 'Tomorrow Raid', new Date('2026-02-11T10:00:00'), new Date('2026-02-11T12:00:00')),
            ];

            render(<ScheduleView {...defaultProps} events={events} />);

            expect(screen.queryByText(/Today/)).toBeNull();
            expect(screen.getByText(/Wednesday, Feb 11/)).toBeInTheDocument();
        });
    });

    describe('MobileEventCard usage', () => {
        it('renders a MobileEventCard for each event', () => {
            const events = [
                makeCalendarEvent(1, 'Raid A', new Date('2026-02-12T10:00:00'), new Date('2026-02-12T12:00:00')),
                makeCalendarEvent(2, 'Raid B', new Date('2026-02-12T14:00:00'), new Date('2026-02-12T16:00:00')),
                makeCalendarEvent(3, 'Raid C', new Date('2026-02-13T10:00:00'), new Date('2026-02-13T12:00:00')),
            ];

            render(<ScheduleView {...defaultProps} events={events} />);

            const cards = screen.getAllByTestId('mobile-event-card');
            expect(cards).toHaveLength(3);
        });

        it('calls onSelectEvent when a card is clicked', () => {
            const onSelectEvent = vi.fn();
            const event = makeCalendarEvent(1, 'Raid A', new Date('2026-02-12T10:00:00'), new Date('2026-02-12T12:00:00'));

            render(<ScheduleView {...defaultProps} events={[event]} onSelectEvent={onSelectEvent} />);

            fireEvent.click(screen.getByTestId('mobile-event-card'));
            expect(onSelectEvent).toHaveBeenCalledTimes(1);
            expect(onSelectEvent).toHaveBeenCalledWith(event);
        });

        it('passes matchesGameTime=true when event overlaps game time', () => {
            const eventOverlapsGameTime = vi.fn(() => true);
            const event = makeCalendarEvent(1, 'Game Time Raid', new Date('2026-02-12T10:00:00'), new Date('2026-02-12T12:00:00'));

            render(<ScheduleView {...defaultProps} events={[event]} eventOverlapsGameTime={eventOverlapsGameTime} />);

            const card = screen.getByTestId('mobile-event-card');
            expect(card).toHaveAttribute('data-matches-game-time', 'true');
        });

        it('passes matchesGameTime=false when event does not overlap game time', () => {
            const eventOverlapsGameTime = vi.fn(() => false);
            const event = makeCalendarEvent(1, 'Normal Raid', new Date('2026-02-12T10:00:00'), new Date('2026-02-12T12:00:00'));

            render(<ScheduleView {...defaultProps} events={[event]} eventOverlapsGameTime={eventOverlapsGameTime} />);

            const card = screen.getByTestId('mobile-event-card');
            expect(card).toHaveAttribute('data-matches-game-time', 'false');
        });

        it('calls eventOverlapsGameTime with correct start/end times', () => {
            const eventOverlapsGameTime = vi.fn(() => false);
            const start = new Date('2026-02-12T10:00:00');
            const end = new Date('2026-02-12T12:00:00');
            const event = makeCalendarEvent(1, 'Raid A', start, end);

            render(<ScheduleView {...defaultProps} events={[event]} eventOverlapsGameTime={eventOverlapsGameTime} />);

            expect(eventOverlapsGameTime).toHaveBeenCalledWith(start, end);
        });
    });

    describe('Swipe gesture handling', () => {
        it('calls onDateChange with next day on swipe left (dx < -50)', () => {
            const onDateChange = vi.fn();
            const events = [
                makeCalendarEvent(1, 'Raid A', new Date('2026-02-12T10:00:00'), new Date('2026-02-12T12:00:00')),
            ];

            const { container } = render(
                <ScheduleView {...defaultProps} events={events} onDateChange={onDateChange} />
            );

            const scheduleView = container.querySelector('.schedule-view')!;

            fireEvent.touchStart(scheduleView, {
                touches: [{ clientX: 300, clientY: 200 }],
            });
            fireEvent.touchEnd(scheduleView, {
                changedTouches: [{ clientX: 200, clientY: 205 }], // dx=-100, dy=5 → swipe left → next day
            });

            expect(onDateChange).toHaveBeenCalledTimes(1);
            const newDate = onDateChange.mock.calls[0][0] as Date;
            expect(newDate.getDate()).toBe(MOCK_NOW.getDate() + 1);
        });

        it('calls onDateChange with previous day on swipe right (dx > 50)', () => {
            const onDateChange = vi.fn();
            const events = [
                makeCalendarEvent(1, 'Raid A', new Date('2026-02-12T10:00:00'), new Date('2026-02-12T12:00:00')),
            ];

            const { container } = render(
                <ScheduleView {...defaultProps} events={events} onDateChange={onDateChange} />
            );

            const scheduleView = container.querySelector('.schedule-view')!;

            fireEvent.touchStart(scheduleView, {
                touches: [{ clientX: 200, clientY: 200 }],
            });
            fireEvent.touchEnd(scheduleView, {
                changedTouches: [{ clientX: 310, clientY: 205 }], // dx=110, dy=5 → swipe right → prev day
            });

            expect(onDateChange).toHaveBeenCalledTimes(1);
            const newDate = onDateChange.mock.calls[0][0] as Date;
            expect(newDate.getDate()).toBe(MOCK_NOW.getDate() - 1);
        });

        it('does not call onDateChange when horizontal movement < 50px', () => {
            const onDateChange = vi.fn();
            const events = [
                makeCalendarEvent(1, 'Raid A', new Date('2026-02-12T10:00:00'), new Date('2026-02-12T12:00:00')),
            ];

            const { container } = render(
                <ScheduleView {...defaultProps} events={events} onDateChange={onDateChange} />
            );

            const scheduleView = container.querySelector('.schedule-view')!;

            fireEvent.touchStart(scheduleView, {
                touches: [{ clientX: 200, clientY: 200 }],
            });
            fireEvent.touchEnd(scheduleView, {
                changedTouches: [{ clientX: 230, clientY: 205 }], // dx=30 < 50
            });

            expect(onDateChange).not.toHaveBeenCalled();
        });

        it('does not call onDateChange when vertical movement dominates', () => {
            const onDateChange = vi.fn();
            const events = [
                makeCalendarEvent(1, 'Raid A', new Date('2026-02-12T10:00:00'), new Date('2026-02-12T12:00:00')),
            ];

            const { container } = render(
                <ScheduleView {...defaultProps} events={events} onDateChange={onDateChange} />
            );

            const scheduleView = container.querySelector('.schedule-view')!;

            fireEvent.touchStart(scheduleView, {
                touches: [{ clientX: 200, clientY: 200 }],
            });
            fireEvent.touchEnd(scheduleView, {
                changedTouches: [{ clientX: 260, clientY: 400 }], // dx=60 but dy=200 > dx
            });

            expect(onDateChange).not.toHaveBeenCalled();
        });
    });

    describe('Accessibility', () => {
        it('renders day group headings as h3', () => {
            const events = [
                makeCalendarEvent(1, 'Raid A', new Date('2026-02-12T10:00:00'), new Date('2026-02-12T12:00:00')),
            ];

            render(<ScheduleView {...defaultProps} events={events} />);

            const headings = screen.getAllByRole('heading', { level: 3 });
            expect(headings.length).toBeGreaterThan(0);
        });
    });
});
