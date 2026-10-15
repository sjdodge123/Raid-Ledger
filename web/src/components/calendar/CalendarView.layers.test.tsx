/**
 * ROK-1775 — the server-schedule layer in the Month and Schedule views, through the
 * real CalendarView: one glyph per day in Month (tooltip lists the day's items by
 * time), muted wrapping rows interleaved with events in Schedule, and both gone when
 * the layer is toggled off, its plugin is inactive, or the game filter excludes it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState, type ReactElement } from 'react';
import { act, render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CalendarView } from './CalendarView';
import { useCalendarViewStore } from '../../stores/calendar-view-store';
import { useTimezoneStore } from '../../stores/timezone-store';
import { usePluginStore } from '../../stores/plugin-store';
import { useCalendarLayerFilterStore } from '../../stores/calendar-layer-filter-store';
import { clearRegistry, registerPlugin } from '../../plugins/plugin-registry';
import type { CalendarLayer, CalendarLayerItem } from '../../plugins/calendar-layer';
import { createMockEvent } from '../../test/factories';

vi.mock('react-router-dom', async () => ({ ...(await vi.importActual('react-router-dom')), useNavigate: () => vi.fn() }));

const EVENT = createMockEvent({ id: 41, title: 'Valheim Night', startTime: '2026-10-14T20:00:00Z', endTime: '2026-10-14T21:30:00Z' });
const mockEvents = { data: { data: [EVENT] }, isLoading: false, isFetching: false };
vi.mock('../../hooks/use-events', () => ({ useEvents: () => mockEvents }));

const RESTART = 'Restart · Valheim Dedicated · 8:05 AM';
const UP = 'Server up · Valheim Dedicated · 10:00 PM – 6:00 AM';
const ITEMS: readonly CalendarLayerItem[] = [
    { kind: 'window', id: 'w1', start: '2026-10-14T22:00:00Z', end: '2026-10-15T06:00:00Z', label: 'Server up · Valheim Dedicated', ariaLabel: 'up' },
    { kind: 'marker', id: 'm1', at: '2026-10-14T08:05:00Z', glyph: 'power', tip: { title: RESTART, detail: 'Online · checked 2 min ago' } },
];
const spy = vi.fn<CalendarLayer['useItems']>();

/** Items belong to the `valheim` game, the way Pelican filters client-side. */
const layer: CalendarLayer = {
    key: 'fake:sched', filterLabel: 'Server schedules',
    useItems(range, selectedGames, enabled) {
        const [stable] = useState(ITEMS);
        spy(range, selectedGames, enabled);
        return enabled && (!selectedGames || selectedGames.has('valheim')) ? stable : [];
    },
};

function renderCalendar(ui: ReactElement) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/calendar']}>{ui}</MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-14T12:00:00Z'));
    useTimezoneStore.setState({ resolved: 'UTC' });
    useCalendarViewStore.setState({ viewPref: 'month' });
    useCalendarLayerFilterStore.getState()._reset();
    clearRegistry();
    spy.mockClear();
    registerPlugin('fake', { icon: 'x', color: 'gray', label: 'Fake' }).registerCalendarLayer(layer);
    act(() => usePluginStore.getState().setActiveSlugs(['fake']));
});

afterEach(() => vi.useRealTimers());

const scheduleDates = () => screen.queryAllByTestId('schedule-day').map((d) => d.dataset['date']);

function scheduleDay(date: string): HTMLElement {
    const day = screen.queryAllByTestId('schedule-day').find((d) => d.dataset['date'] === date);
    if (!day) throw new Error(`schedule lists no ${date}; listed: ${scheduleDates().join(', ')}`);
    return day;
}

describe('CalendarView month — layer glyph per day (ROK-1775)', () => {
    it('draws one glyph on each day an item touches, and no bands', () => {
        renderCalendar(<CalendarView currentDate={new Date(2026, 9, 14)} />);
        expect(screen.getAllByTestId('layer-month-glyph')).toHaveLength(2); // the 14th, and the 15th the window runs into
        expect(document.querySelector('.rl-layer-window')).toBeNull();
        expect(screen.getByText('Valheim Night')).toBeInTheDocument();
    });

    it('tap opens a tooltip listing the day\'s items by time; a second tap and Escape close it', () => {
        renderCalendar(<CalendarView currentDate={new Date(2026, 9, 14)} />);
        const day = screen.getAllByTestId('layer-month-day')[0];
        if (!day) throw new Error('no month day with a glyph');
        const glyph = within(day).getByTestId('layer-month-glyph');
        const tip = within(day).getByRole('tooltip', { hidden: true });
        expect(within(tip).getAllByTestId('layer-tip-entry').map((e) => e.textContent)).toEqual([`${RESTART}Online · checked 2 min ago`, UP]);
        expect(tip.className).toContain('top-full');
        fireEvent.click(glyph);
        expect(tip.className).toContain('visible opacity-100');
        fireEvent.click(glyph);
        expect(tip.className).toContain('invisible');
        fireEvent.click(glyph);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(tip.className).toContain('invisible');
    });
});

describe('CalendarView schedule — muted layer rows (ROK-1775)', () => {
    it('interleaves wrapping layer rows with the day\'s events by time', () => {
        renderCalendar(<CalendarView currentDate={new Date(2026, 9, 14)} calendarView="schedule" />);
        const rows = within(scheduleDay('2026-10-14')).getAllByTestId('schedule-layer-row');
        expect(rows.map((r) => r.textContent)).toEqual([RESTART, UP]);
        const text = document.body.textContent ?? '';
        expect(text.indexOf(RESTART)).toBeLessThan(text.indexOf('Valheim Night'));
        expect(text.indexOf('Valheim Night')).toBeLessThan(text.indexOf(UP));
        for (const row of rows) {
            expect(row.querySelector('.truncate')).toBeNull();
            expect(row.querySelector('.break-words')).not.toBeNull();
        }
    });
});

describe('Schedule — server-only days (ROK-1775 Lead ruling)', () => {
    it('lists an event-free day that has only server rows, with a muted header', () => {
        renderCalendar(<CalendarView currentDate={new Date(2026, 9, 14)} calendarView="schedule" />);
        const day = scheduleDay('2026-10-15'); // the 22:00–06:00 window runs into the 15th; no event that day
        expect(day.dataset['layerOnly']).toBe('true');
        expect(within(day).getAllByTestId('schedule-layer-row').map((r) => r.textContent)).toEqual([UP]);
        expect(within(day).getByText('15').className).toContain('text-dim');
        expect(scheduleDay('2026-10-14').dataset['layerOnly']).toBeUndefined();
    });

    it('drops the server-only day again when the layer is toggled OFF (today and event days stay)', () => {
        renderCalendar(<CalendarView currentDate={new Date(2026, 9, 14)} calendarView="schedule" />);
        expect(scheduleDates()).toEqual(['2026-10-14', '2026-10-15']);
        act(() => useCalendarLayerFilterStore.setState({ hiddenLayers: new Set(['fake:sched']) }));
        expect(scheduleDates()).toEqual(['2026-10-14']);
    });
});

describe('Month + Schedule layer gating (ROK-1775)', () => {
    const views = [['month', {}], ['schedule', { calendarView: 'schedule' }]] as const;

    it.each(views)('%s: the Filters toggle OFF draws nothing and never enables the layer', (_name, viewProps) => {
        useCalendarLayerFilterStore.setState({ hiddenLayers: new Set(['fake:sched']) });
        renderCalendar(<CalendarView currentDate={new Date(2026, 9, 14)} {...viewProps} />);
        expect(screen.queryByTestId('layer-month-glyph')).toBeNull();
        expect(screen.queryByTestId('schedule-layer-row')).toBeNull();
        expect(spy.mock.calls.every(([, , enabled]) => enabled === false)).toBe(true);
    });

    it.each(views)('%s: an inactive plugin draws nothing', (_name, viewProps) => {
        act(() => usePluginStore.getState().setActiveSlugs([]));
        renderCalendar(<CalendarView currentDate={new Date(2026, 9, 14)} {...viewProps} />);
        expect(screen.queryByTestId('layer-month-glyph')).toBeNull();
        expect(screen.queryByTestId('schedule-layer-row')).toBeNull();
    });

    it.each(views)('%s: the game filter reaches the layer and hides another game\'s items', (_name, viewProps) => {
        const selected = new Set([EVENT.game?.slug ?? 'none', 'wow']); // keeps the event, excludes the layer's game
        renderCalendar(<CalendarView currentDate={new Date(2026, 9, 14)} {...viewProps} selectedGames={selected} />);
        expect(spy).toHaveBeenLastCalledWith(expect.anything(), selected, true);
        expect(screen.queryByTestId('layer-month-glyph')).toBeNull();
        expect(screen.queryByTestId('schedule-layer-row')).toBeNull();
        expect(screen.getByText('Valheim Night')).toBeInTheDocument();
    });
});
