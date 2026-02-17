import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScheduleView } from './ScheduleView';
import type { CalendarEvent } from './CalendarView';
import type { EventResponseDto } from '@raid-ledger/contract';

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
        it('renders events grouped under correct day abbreviation and date', () => {
            const events = [
                makeCalendarEvent(1, 'Event A', new Date('2026-02-12T10:00:00'), new Date('2026-02-12T12:00:00')),
                makeCalendarEvent(2, 'Event B', new Date('2026-02-13T15:00:00'), new Date('2026-02-13T17:00:00')),
            ];

            render(<ScheduleView {...defaultProps} events={events} />);

            // Day abbreviations
            expect(screen.getByText('Thu')).toBeInTheDocument();
            expect(screen.getByText('Fri')).toBeInTheDocument();

            // Date numbers
            expect(screen.getByText('12')).toBeInTheDocument();
            expect(screen.getByText('13')).toBeInTheDocument();

            // Event titles rendered as buttons
            expect(screen.getByText('Event A')).toBeInTheDocument();
            expect(screen.getByText('Event B')).toBeInTheDocument();
        });

        it('groups multiple events under same day', () => {
            const events = [
                makeCalendarEvent(1, 'Morning Raid', new Date('2026-02-12T08:00:00'), new Date('2026-02-12T10:00:00')),
                makeCalendarEvent(2, 'Evening Raid', new Date('2026-02-12T18:00:00'), new Date('2026-02-12T20:00:00')),
            ];

            render(<ScheduleView {...defaultProps} events={events} />);

            // Only one day abbreviation for Thu
            const thuLabels = screen.getAllByText('Thu');
            expect(thuLabels).toHaveLength(1);

            // Both event titles present
            expect(screen.getByText('Morning Raid')).toBeInTheDocument();
            expect(screen.getByText('Evening Raid')).toBeInTheDocument();
        });

        it('renders events sorted by start time within the same day', () => {
            const events = [
                makeCalendarEvent(2, 'Evening Raid', new Date('2026-02-12T18:00:00'), new Date('2026-02-12T20:00:00')),
                makeCalendarEvent(1, 'Morning Raid', new Date('2026-02-12T08:00:00'), new Date('2026-02-12T10:00:00')),
            ];

            render(<ScheduleView {...defaultProps} events={events} />);

            const buttons = screen.getAllByRole('button');
            expect(buttons[0]).toHaveTextContent('Morning Raid');
            expect(buttons[1]).toHaveTextContent('Evening Raid');
        });

        it('renders day groups in ascending date order', () => {
            const events = [
                makeCalendarEvent(2, 'Later Event', new Date('2026-02-14T10:00:00'), new Date('2026-02-14T12:00:00')),
                makeCalendarEvent(1, 'Earlier Event', new Date('2026-02-12T10:00:00'), new Date('2026-02-12T12:00:00')),
            ];

            render(<ScheduleView {...defaultProps} events={events} />);

            const buttons = screen.getAllByRole('button');
            expect(buttons[0]).toHaveTextContent('Earlier Event');
            expect(buttons[1]).toHaveTextContent('Later Event');
        });
    });

    describe('Google Calendar-style day headers', () => {
        it('renders day abbreviation and date number in left column', () => {
            const events = [
                makeCalendarEvent(1, 'Raid A', new Date('2026-02-12T10:00:00'), new Date('2026-02-12T12:00:00')),
            ];

            render(<ScheduleView {...defaultProps} events={events} />);

            expect(screen.getByText('Thu')).toBeInTheDocument();
            expect(screen.getByText('12')).toBeInTheDocument();
        });

        it('highlights today with emerald styling', () => {
            // MOCK_NOW is 2026-02-10T12:00:00Z (Tuesday)
            const events = [
                makeCalendarEvent(1, 'Today Raid', new Date('2026-02-10T18:00:00'), new Date('2026-02-10T20:00:00')),
            ];

            render(<ScheduleView {...defaultProps} events={events} />);

            const dayAbbr = screen.getByText('Tue');
            expect(dayAbbr).toHaveClass('text-emerald-400');

            const dateNum = screen.getByText('10');
            expect(dateNum).toHaveClass('bg-emerald-500', 'rounded-full');
        });

        it('does not highlight non-today dates with emerald styling', () => {
            const events = [
                makeCalendarEvent(1, 'Tomorrow Raid', new Date('2026-02-11T10:00:00'), new Date('2026-02-11T12:00:00')),
            ];

            render(<ScheduleView {...defaultProps} events={events} />);

            const dayAbbr = screen.getByText('Wed');
            expect(dayAbbr).toHaveClass('text-muted');
            expect(dayAbbr).not.toHaveClass('text-emerald-400');

            const dateNum = screen.getByText('11');
            expect(dateNum).toHaveClass('text-foreground');
            expect(dateNum).not.toHaveClass('bg-emerald-500');
        });
    });

    describe('Event blocks', () => {
        it('renders a button for each event with title and time', () => {
            const events = [
                makeCalendarEvent(1, 'Raid A', new Date('2026-02-12T10:00:00'), new Date('2026-02-12T12:00:00')),
                makeCalendarEvent(2, 'Raid B', new Date('2026-02-12T14:00:00'), new Date('2026-02-12T16:00:00')),
                makeCalendarEvent(3, 'Raid C', new Date('2026-02-13T10:00:00'), new Date('2026-02-13T12:00:00')),
            ];

            render(<ScheduleView {...defaultProps} events={events} />);

            const buttons = screen.getAllByRole('button');
            expect(buttons).toHaveLength(3);
        });

        it('calls onSelectEvent when an event block is clicked', () => {
            const onSelectEvent = vi.fn();
            const event = makeCalendarEvent(1, 'Raid A', new Date('2026-02-12T10:00:00'), new Date('2026-02-12T12:00:00'));

            render(<ScheduleView {...defaultProps} events={[event]} onSelectEvent={onSelectEvent} />);

            fireEvent.click(screen.getByRole('button'));
            expect(onSelectEvent).toHaveBeenCalledTimes(1);
            expect(onSelectEvent).toHaveBeenCalledWith(event);
        });

        it('displays game name alongside time in event block', () => {
            const event = makeCalendarEvent(1, 'WoW Raid', new Date('2026-02-12T15:00:00'), new Date('2026-02-12T17:00:00'), {
                game: { id: 1, name: 'World of Warcraft', slug: 'wow', coverUrl: null },
            });

            render(<ScheduleView {...defaultProps} events={[event]} />);

            expect(screen.getByText(/World of Warcraft/)).toBeInTheDocument();
        });

        it('applies game-specific background color via inline style', () => {
            const event = makeCalendarEvent(1, 'WoW Raid', new Date('2026-02-12T15:00:00'), new Date('2026-02-12T17:00:00'), {
                game: { id: 1, name: 'World of Warcraft', slug: 'wow', coverUrl: null },
            });

            render(<ScheduleView {...defaultProps} events={[event]} />);

            const button = screen.getByRole('button');
            // The button should have inline backgroundColor and borderLeft styles
            expect(button).toHaveStyle({ backgroundColor: expect.any(String) });
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
                changedTouches: [{ clientX: 200, clientY: 205 }], // dx=-100, dy=5 -> swipe left -> next day
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
                changedTouches: [{ clientX: 310, clientY: 205 }], // dx=110, dy=5 -> swipe right -> prev day
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
});
