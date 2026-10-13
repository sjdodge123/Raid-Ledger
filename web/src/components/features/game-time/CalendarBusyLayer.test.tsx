/**
 * The viewer's own-calendar busy band (ROK-1595 S2, NP-1; spec §8 AC 8, §9 R4).
 *
 * jsdom has no layout, so every render passes explicit dims, as
 * `SlotBlockLayer.test.tsx` does.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { GameTimeCalendarBusy, GameTimeSlot } from '@raid-ledger/contract';
import type { GridDims } from './game-time-grid.types';
import { CalendarBusyLayer } from './CalendarBusyLayer';
import { DayBlockEditor } from './phone/DayBlockEditor';
import { busyHourCount, busyInsideGameTime, busyRunsForDays } from './calendar-busy.utils';

const DIMS: GridDims = { colWidth: 100, rowHeight: 40, headerHeight: 0, colStartLeft: 52 };
const EVENING = [17, 18, 19, 20, 21, 22, 23];
const busy = (dayOfWeek: number, startHour: number, endHour: number): GameTimeCalendarBusy =>
    ({ dayOfWeek, startHour, endHour, provider: 'google' });
const free = (dayOfWeek: number, hours: number[]): GameTimeSlot[] =>
    hours.map((hour) => ({ dayOfWeek, hour, status: 'available' }));
/** Every hour of every day free, for tests about placement rather than the R5 clip. */
const ALL_FREE: GameTimeSlot[] = [0, 1, 2, 3, 4, 5, 6].flatMap((d) => free(d, Array.from({ length: 24 }, (_, h) => h)));

describe('CalendarBusyLayer', () => {
    it('draws one band per calendarBusy entry on the days shown', () => {
        render(<CalendarBusyLayer busy={[busy(2, 18, 20), busy(4, 21, 22)]} slots={ALL_FREE} gridDims={DIMS} hours={EVENING} />);
        expect(screen.getAllByText('Busy · Google Calendar')).toHaveLength(2);
        expect(screen.getByTestId('calendar-busy-band-2-18')).toBeInTheDocument();
        expect(screen.getByTestId('calendar-busy-band-4-21')).toBeInTheDocument();
    });

    it('places a band on its own day column and hour rows', () => {
        render(<CalendarBusyLayer busy={[busy(2, 18, 20)]} slots={ALL_FREE} gridDims={DIMS} hours={EVENING} />);
        const band = screen.getByTestId('calendar-busy-band-2-18');
        expect(band.style.left).toBe(`${52 + 2 * 101}px`);
        expect(band.style.top).toBe(`${1 * 40 + 1}px`);
        expect(band.style.height).toBe(`${2 * 40 - 2}px`);
    });

    it('paints with the busy token only and never takes a pointer event', () => {
        render(<CalendarBusyLayer busy={[busy(2, 18, 20)]} slots={ALL_FREE} gridDims={DIMS} hours={EVENING} />);
        const band = screen.getByTestId('calendar-busy-band-2-18');
        expect(band.className, 'R4: the fill is the busy token at 30%').toMatch(/\bbg-busy\/30\b/);
        expect(band.className).toMatch(/\bborder-busy\b/);
        expect(band.className).not.toMatch(/#[0-9a-f]{3,6}|purple|violet/i);
        expect(band.className).toContain('pointer-events-none');
        expect(screen.getByTestId('calendar-busy-layer').className).toContain('pointer-events-none');
    });

    it('draws nothing when calendarBusy is absent or empty', () => {
        const { rerender } = render(<CalendarBusyLayer busy={undefined} slots={ALL_FREE} gridDims={DIMS} hours={EVENING} />);
        expect(screen.queryByTestId('calendar-busy-layer')).not.toBeInTheDocument();
        rerender(<CalendarBusyLayer busy={[]} slots={ALL_FREE} gridDims={DIMS} hours={EVENING} />);
        expect(screen.queryByTestId('calendar-busy-layer')).not.toBeInTheDocument();
    });

    it('skips a range entirely outside the visible hours', () => {
        render(<CalendarBusyLayer busy={[busy(2, 9, 11)]} slots={ALL_FREE} gridDims={DIMS} hours={EVENING} />);
        expect(screen.queryByText('Busy · Google Calendar')).not.toBeInTheDocument();
    });
});

describe('DayBlockEditor — busy band on the phone day (S2)', () => {
    const renderDay = (dayOfWeek: number, calendarBusy?: GameTimeCalendarBusy[]) => render(
        <DayBlockEditor slots={ALL_FREE} onChange={vi.fn()} dayOfWeek={dayOfWeek} hours={EVENING} dims={DIMS}
            calendarBusy={calendarBusy} />,
    );

    it('draws only the day on screen, in the first column', () => {
        renderDay(2, [busy(2, 20, 21), busy(3, 20, 21)]);
        expect(screen.getAllByText('Busy · Google Calendar')).toHaveLength(1);
        expect(screen.getByTestId('calendar-busy-band-2-20').style.left).toBe('52px');
        expect(screen.queryByTestId('calendar-busy-band-3-20')).not.toBeInTheDocument();
    });

    // R4: dayOfWeek is the display convention (0 = Sunday), not the DB's 0 = Monday.
    it('treats dayOfWeek 0 as Sunday (display convention, R4)', () => {
        renderDay(0, [busy(0, 19, 20), busy(1, 19, 20)]);
        expect(screen.getByTestId('calendar-busy-band-0-19')).toBeInTheDocument();
        expect(screen.queryByTestId('calendar-busy-band-1-19')).not.toBeInTheDocument();
    });

    it('draws no band without calendarBusy', () => {
        renderDay(2);
        expect(screen.queryByTestId('calendar-busy-layer')).not.toBeInTheDocument();
    });
});

describe('calendar-busy.utils', () => {
    it('maps a range into a wrapping window by hour, not by arithmetic', () => {
        const hours = [22, 23, 0, 1];
        expect(busyRunsForDays([busy(5, 0, 24)], [5], hours)).toEqual([
            { dayOfWeek: 5, startIndex: 0, endIndex: 4, provider: 'google' },
        ]);
        expect(busyRunsForDays([busy(5, 21, 23)], [5], hours)).toEqual([
            { dayOfWeek: 5, startIndex: 0, endIndex: 1, provider: 'google' },
        ]);
    });

    it('counts distinct busy hours that fall on the day\'s free slots, overlaps once', () => {
        const slots = free(2, [17, 18, 19, 20, 21, 22, 23]);
        expect(busyHourCount([busy(2, 18, 20), busy(2, 19, 21), busy(3, 18, 23)], slots, 2, EVENING)).toBe(3);
        expect(busyHourCount([busy(2, 9, 11)], free(2, [9, 10]), 2, EVENING)).toBe(0);
    });

    it('does not count a busy hour that falls outside every slot (busy ∩ slots)', () => {
        // Free 19:00 and 20:00 on Tuesday: busy 17-19 touches neither; busy 20-22 overlaps at 20 only.
        const slots = free(2, [19, 20]);
        expect(busyHourCount([busy(2, 17, 19)], slots, 2, EVENING)).toBe(0);
        expect(busyHourCount([busy(2, 20, 22)], slots, 2, EVENING)).toBe(1);
        expect(busyHourCount([busy(2, 20, 22)], [...slots, { dayOfWeek: 2, hour: 21, status: 'blocked' }], 2, EVENING)).toBe(1);
    });
});

describe('busyRunsForDays — overlapping ranges (review #3)', () => {
    it('unions overlapping and adjacent ranges on a day into one run', () => {
        const runs = busyRunsForDays([busy(2, 20, 22), busy(2, 20, 21), busy(2, 22, 23), busy(4, 18, 19)], [2, 4], EVENING);
        expect(runs).toEqual([
            { dayOfWeek: 2, startIndex: 3, endIndex: 6, provider: 'google' },
            { dayOfWeek: 4, startIndex: 1, endIndex: 2, provider: 'google' },
        ]);
    });

    it('keeps a gap between two ranges as two runs', () => {
        expect(busyRunsForDays([busy(2, 17, 18), busy(2, 20, 21)], [2], EVENING)).toEqual([
            { dayOfWeek: 2, startIndex: 0, endIndex: 1, provider: 'google' },
            { dayOfWeek: 2, startIndex: 3, endIndex: 4, provider: 'google' },
        ]);
    });

    it('draws two calendars busy at the same hour as ONE band, not a stacked pair', () => {
        render(<CalendarBusyLayer busy={[busy(2, 20, 21), busy(2, 20, 22)]} slots={ALL_FREE} gridDims={DIMS} hours={EVENING} />);
        expect(screen.getAllByText('Busy · Google Calendar')).toHaveLength(1);
        expect(screen.getByTestId('calendar-busy-band-2-20').style.height).toBe(`${2 * 40 - 2}px`);
    });
});

describe('busy bands only inside the viewer\'s game time (operator R5)', () => {
    it('clips a range to the free hours of its day, one range per free stretch', () => {
        const slots = [...free(2, [18, 19, 21]), { dayOfWeek: 2, hour: 20, status: 'blocked' as const }];
        expect(busyInsideGameTime([busy(2, 17, 23)], slots)).toEqual([busy(2, 18, 20), busy(2, 21, 22)]);
    });

    it('counts a committed hour as game time: the band draws and the header counts it (Lead ruling)', () => {
        const slots = [...free(2, [18]), { dayOfWeek: 2, hour: 19, status: 'committed' as const }];
        expect(busyInsideGameTime([busy(2, 18, 21)], slots)).toEqual([busy(2, 18, 20)]);
        expect(busyHourCount([busy(2, 18, 21)], slots, 2, EVENING)).toBe(2);
    });

    it('drops a range on a day with no game time, and never borrows another day\'s hours', () => {
        expect(busyInsideGameTime([busy(3, 18, 20)], free(2, [18, 19]))).toEqual([]);
    });

    it('draws no band on a busy hour outside the game time, and draws the one inside it', () => {
        render(<CalendarBusyLayer busy={[busy(2, 17, 19), busy(4, 20, 21)]} slots={free(2, [18, 19])} gridDims={DIMS} hours={EVENING} />);
        expect(screen.queryByTestId('calendar-busy-band-2-17'), 'the 5 PM busy hour is outside game time').not.toBeInTheDocument();
        expect(screen.getByTestId('calendar-busy-band-2-18'), 'the 6 PM busy hour is inside game time').toBeInTheDocument();
        expect(screen.queryByTestId('calendar-busy-band-4-20'), 'Thursday has no game time').not.toBeInTheDocument();
    });
});
