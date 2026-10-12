/**
 * The viewer's own-calendar busy band (ROK-1595 S2, NP-1; spec §8 AC 8, §9 R4).
 *
 * jsdom has no layout, so every render passes explicit dims, as
 * `SlotBlockLayer.test.tsx` does.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { GameTimeCalendarBusy } from '@raid-ledger/contract';
import type { GridDims } from './game-time-grid.types';
import { CalendarBusyLayer } from './CalendarBusyLayer';
import { DayBlockEditor } from './phone/DayBlockEditor';
import { busyHourCount, busyRunsForDays } from './calendar-busy.utils';

const DIMS: GridDims = { colWidth: 100, rowHeight: 40, headerHeight: 0, colStartLeft: 52 };
const EVENING = [17, 18, 19, 20, 21, 22, 23];
const busy = (dayOfWeek: number, startHour: number, endHour: number): GameTimeCalendarBusy =>
    ({ dayOfWeek, startHour, endHour, provider: 'google' });

describe('CalendarBusyLayer', () => {
    it('draws one band per calendarBusy entry on the days shown', () => {
        render(<CalendarBusyLayer busy={[busy(2, 18, 20), busy(4, 21, 22)]} gridDims={DIMS} hours={EVENING} />);
        expect(screen.getAllByText('Busy · Google Calendar')).toHaveLength(2);
        expect(screen.getByTestId('calendar-busy-band-2-18')).toBeInTheDocument();
        expect(screen.getByTestId('calendar-busy-band-4-21')).toBeInTheDocument();
    });

    it('places a band on its own day column and hour rows', () => {
        render(<CalendarBusyLayer busy={[busy(2, 18, 20)]} gridDims={DIMS} hours={EVENING} />);
        const band = screen.getByTestId('calendar-busy-band-2-18');
        expect(band.style.left).toBe(`${52 + 2 * 101}px`);
        expect(band.style.top).toBe(`${1 * 40 + 1}px`);
        expect(band.style.height).toBe(`${2 * 40 - 2}px`);
    });

    it('paints with the busy token only and never takes a pointer event', () => {
        render(<CalendarBusyLayer busy={[busy(2, 18, 20)]} gridDims={DIMS} hours={EVENING} />);
        const band = screen.getByTestId('calendar-busy-band-2-18');
        expect(band.className).toMatch(/\bbg-busy\b/);
        expect(band.className).toMatch(/\bborder-busy\b/);
        expect(band.className).not.toMatch(/#[0-9a-f]{3,6}|purple|violet/i);
        expect(band.className).toContain('pointer-events-none');
        expect(screen.getByTestId('calendar-busy-layer').className).toContain('pointer-events-none');
    });

    it('draws nothing when calendarBusy is absent or empty', () => {
        const { rerender } = render(<CalendarBusyLayer busy={undefined} gridDims={DIMS} hours={EVENING} />);
        expect(screen.queryByTestId('calendar-busy-layer')).not.toBeInTheDocument();
        rerender(<CalendarBusyLayer busy={[]} gridDims={DIMS} hours={EVENING} />);
        expect(screen.queryByTestId('calendar-busy-layer')).not.toBeInTheDocument();
    });

    it('skips a range entirely outside the visible hours', () => {
        render(<CalendarBusyLayer busy={[busy(2, 9, 11)]} gridDims={DIMS} hours={EVENING} />);
        expect(screen.queryByText('Busy · Google Calendar')).not.toBeInTheDocument();
    });
});

describe('DayBlockEditor — busy band on the phone day (S2)', () => {
    const renderDay = (dayOfWeek: number, calendarBusy?: GameTimeCalendarBusy[]) => render(
        <DayBlockEditor slots={[]} onChange={vi.fn()} dayOfWeek={dayOfWeek} hours={EVENING} dims={DIMS}
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

    it('counts distinct visible busy hours on one day, overlaps once', () => {
        expect(busyHourCount([busy(2, 18, 20), busy(2, 19, 21), busy(3, 18, 23)], 2, EVENING)).toBe(3);
        expect(busyHourCount([busy(2, 9, 11)], 2, EVENING)).toBe(0);
    });
});
