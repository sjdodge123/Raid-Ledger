/**
 * ROK-2303: the CalendarView wiring of the phone Day-view scroll round trip.
 * Opening an event from the phone Day view must save the window offset, and a
 * Back mount on the same Day must put it back once the grid has loaded. Each
 * case fails if its call in CalendarView is removed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CalendarView } from './CalendarView';
import { useCalendarViewStore } from '../../stores/calendar-view-store';
import { createMockEvent } from '../../test/factories';

const STORAGE_KEY = 'rl:calendar-day-scroll';
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return { ...actual, useNavigate: () => mockNavigate };
});

const mockUseEventsReturn = {
    data: { data: [] as ReturnType<typeof createMockEvent>[] },
    isLoading: false,
    isFetching: false,
};
vi.mock('../../hooks/use-events', () => ({ useEvents: () => mockUseEventsReturn }));

function setWindowValue(key: 'innerWidth' | 'scrollY', value: number): void {
    Object.defineProperty(window, key, { configurable: true, writable: true, value });
}

function renderPhoneDay(): ReturnType<typeof render> {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // MemoryRouter's first location is a POP, like the mount reached by Back.
    return render(
        <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={['/calendar?date=2026-02-10&view=day']}>
                <CalendarView calendarView="day" />
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

describe('CalendarView — phone Day-view scroll round trip (ROK-2303)', () => {
    const originalWidth = window.innerWidth;
    let scrollTo: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        mockNavigate.mockClear();
        useCalendarViewStore.setState({ viewPref: 'day' });
        vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
        scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation((...args: unknown[]) => {
            const y = args[1];
            if (typeof y === 'number') setWindowValue('scrollY', y);
        });
        setWindowValue('innerWidth', 375);
        setWindowValue('scrollY', 0);
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        mockUseEventsReturn.data = { data: [] };
        setWindowValue('innerWidth', originalWidth);
        setWindowValue('scrollY', 0);
    });

    it('saves the window offset when an event is opened from the phone Day view', () => {
        mockUseEventsReturn.data = {
            data: [createMockEvent({ id: 42, title: 'Late Raid', startTime: '2026-02-10T12:00:00Z', endTime: '2026-02-10T13:00:00Z' })],
        };
        const { container } = renderPhoneDay();
        const card = container.querySelector('.rbc-event');
        if (!card) throw new Error('the Day view rendered no event card');
        setWindowValue('scrollY', 480);

        fireEvent.click(card);

        expect(mockNavigate).toHaveBeenCalledWith('/events/42', expect.anything());
        expect(JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null')).toEqual({ date: '2026-02-10', y: 480 });
    });

    it('restores the saved offset when Back mounts the same phone Day', async () => {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ date: '2026-02-10', y: 520 }));

        renderPhoneDay();
        await vi.runAllTimersAsync();

        expect(scrollTo).toHaveBeenCalledWith(expect.any(Number), 520);
        expect(window.scrollY).toBe(520);
    });

    it('holds the restore while the grid is loading', async () => {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ date: '2026-02-10', y: 520 }));
        mockUseEventsReturn.isLoading = true;

        try {
            renderPhoneDay();
            await vi.runAllTimersAsync();
            expect(scrollTo).not.toHaveBeenCalledWith(expect.any(Number), 520);
        } finally {
            mockUseEventsReturn.isLoading = false;
        }
    });
});
