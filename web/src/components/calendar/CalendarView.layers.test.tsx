/**
 * ROK-1774 — CalendarView draws plugin calendar layers (a FAKE layer registered
 * here; no Pelican code): bands behind events in week/day, ticks + glyphs, layer
 * events never navigate, month view keeps layers disabled.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CalendarView } from './CalendarView';
import { useCalendarViewStore } from '../../stores/calendar-view-store';
import { usePluginStore } from '../../stores/plugin-store';
import { clearRegistry, registerPlugin } from '../../plugins/plugin-registry';
import type { CalendarLayerItem } from '../../plugins/calendar-layer';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => ({ ...(await vi.importActual('react-router-dom')), useNavigate: () => mockNavigate }));
vi.mock('../../hooks/use-events', () => ({ useEvents: () => ({ data: { data: [] }, isLoading: false, isFetching: false }) }));

const ITEMS: CalendarLayerItem[] = [
    { kind: 'window', id: 'w1', start: '2026-02-10T13:00:00Z', end: '2026-02-10T17:00:00Z', label: 'Server up · Fake Server', ariaLabel: 'Fake Server up' },
    { kind: 'marker', id: 'm1', at: '2026-02-10T15:00:00Z', glyph: 'power', tip: { title: 'Restart · Fake Server · 3:00 PM', detail: 'Online · checked 1 min ago' } },
];
const useItems = vi.fn((_range: unknown, _games: unknown, enabled: boolean) => (enabled ? ITEMS : []));

function renderCalendar() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/calendar']}><CalendarView /></MemoryRouter></QueryClientProvider>);
}

function setup(view: 'week' | 'day' | 'month', active: boolean) {
    useCalendarViewStore.setState({ viewPref: view });
    usePluginStore.setState({ activeSlugs: new Set(active ? ['fake'] : []) });
    return renderCalendar();
}

beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-02-10T12:00:00Z'));
    mockNavigate.mockClear();
    useItems.mockClear();
    clearRegistry();
    registerPlugin('fake', { icon: 'x', color: 'gray', label: 'Fake' }).registerCalendarLayer({ key: 'fake:layer', useItems });
});
afterEach(() => { vi.useRealTimers(); clearRegistry(); });

describe('CalendarView — plugin calendar layer (week/day)', () => {
    it('renders a window as a hatched background event with its label and no game colour', () => {
        const { container } = setup('week', true);
        const bands = container.querySelectorAll<HTMLElement>('.rbc-background-event.rl-layer-window');
        expect(bands.length).toBe(1);
        expect(bands[0]).toHaveTextContent('Server up · Fake Server');
        expect(bands[0]?.style.backgroundColor).toBe('');
        expect(container.querySelector('.rbc-event.rl-layer-window')).toBeNull();
    });

    it('draws the marker tick with its glyph in the day view', () => {
        setup('day', true);
        expect(screen.getAllByTestId('layer-marker-tick')).toHaveLength(1);
        expect(screen.getByTestId('layer-marker-glyph')).toHaveAttribute('aria-label', 'Restart · Fake Server · 3:00 PM. Online · checked 1 min ago');
    });

    it('selecting a layer band never navigates', () => {
        const { container } = setup('week', true);
        const band = container.querySelector<HTMLElement>('.rl-layer-window');
        expect(band).not.toBeNull();
        if (band) fireEvent.click(band);
        expect(mockNavigate).not.toHaveBeenCalled();
    });
});

describe('CalendarView — plugin calendar layer gating', () => {
    it('month view calls the layer with enabled=false and draws nothing', () => {
        const { container } = setup('month', true);
        expect(useItems).toHaveBeenCalled();
        expect(useItems.mock.calls.every((call) => call[2] === false)).toBe(true);
        expect(container.querySelector('.rl-layer-window')).toBeNull();
        expect(screen.queryByTestId('layer-marker-tick')).toBeNull();
    });

    it('an inactive plugin draws no band or tick in week view', () => {
        const { container } = setup('week', false);
        expect(useItems.mock.calls.every((call) => call[2] === false)).toBe(true);
        expect(container.querySelector('.rl-layer-window')).toBeNull();
        expect(screen.queryByTestId('layer-marker-tick')).toBeNull();
    });
});
