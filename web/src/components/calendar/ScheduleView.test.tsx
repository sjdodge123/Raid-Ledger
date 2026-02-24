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
        game: { id: 1, name: 'World of Warcraft', slug: 'world-of-warcraft', coverUrl: null },
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
            expect(screen.getByText('No events scheduled')).toBeInTheDocument();
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

        it('does not render days without events', () => {
            // Events on Feb 12 and Feb 14 — Feb 13 should be hidden
            const events = [
                makeCalendarEvent(1, 'Event A', new Date('2026-02-12T10:00:00'), new Date('2026-02-12T12:00:00')),
                makeCalendarEvent(2, 'Event B', new Date('2026-02-14T10:00:00'), new Date('2026-02-14T12:00:00')),
            ];

            render(<ScheduleView {...defaultProps} events={events} />);

            // Feb 12 (Thu) and Feb 14 (Sat) should be present
            expect(screen.getByText('12')).toBeInTheDocument();
            expect(screen.getByText('14')).toBeInTheDocument();

            // Feb 13 (Fri) should NOT be present (no events, not today)
            expect(screen.queryByText('13')).not.toBeInTheDocument();
        });

        it('always shows today even without events', () => {
            // MOCK_NOW is Feb 10. Event only on Feb 12.
            const events = [
                makeCalendarEvent(1, 'Event A', new Date('2026-02-12T10:00:00'), new Date('2026-02-12T12:00:00')),
            ];

            render(<ScheduleView {...defaultProps} events={events} />);

            // Today (Feb 10, Tue) should appear even without events
            expect(screen.getByText('10')).toBeInTheDocument();
            expect(screen.getByText('Tue')).toBeInTheDocument();
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
    });

    describe('Week separators', () => {
        it('renders week separator before first day of each new week', () => {
            // Feb 10 (Tue, week of Feb 8-14) and Feb 16 (Mon, week of Feb 15-21)
            const events = [
                makeCalendarEvent(1, 'Event A', new Date('2026-02-10T10:00:00'), new Date('2026-02-10T12:00:00')),
                makeCalendarEvent(2, 'Event B', new Date('2026-02-16T10:00:00'), new Date('2026-02-16T12:00:00')),
            ];

            const { container } = render(<ScheduleView {...defaultProps} events={events} />);

            const separators = container.querySelectorAll('.week-separator');
            expect(separators.length).toBeGreaterThanOrEqual(2);
        });
    });

    describe('Now line', () => {
        it('renders now-line on today\'s date group', () => {
            // MOCK_NOW is Feb 10 12:00 UTC. Event ends at 20:00 (future).
            const events = [
                makeCalendarEvent(1, 'Today Raid', new Date('2026-02-10T18:00:00'), new Date('2026-02-10T20:00:00')),
            ];

            const { container } = render(<ScheduleView {...defaultProps} events={events} />);

            const nowLines = container.querySelectorAll('.now-line');
            expect(nowLines).toHaveLength(1);
        });

        it('renders now-line alone when today has no events', () => {
            // Event only on Feb 12, not today (Feb 10)
            const events = [
                makeCalendarEvent(1, 'Event A', new Date('2026-02-12T10:00:00'), new Date('2026-02-12T12:00:00')),
            ];

            const { container } = render(<ScheduleView {...defaultProps} events={events} />);

            // Today is shown (always included) with the now line
            const nowLines = container.querySelectorAll('.now-line');
            expect(nowLines).toHaveLength(1);
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
                game: { id: 1, name: 'World of Warcraft', slug: 'world-of-warcraft', coverUrl: null },
            });

            render(<ScheduleView {...defaultProps} events={[event]} />);

            expect(screen.getByText(/World of Warcraft/)).toBeInTheDocument();
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
