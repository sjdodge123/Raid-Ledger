/**
 * ROK-2303: phone Day view → event → Back must land on the same scroll offset.
 * The window is the scroller; the offset is saved when the event is opened and
 * restored only on the next POP mount for the same date in Day view.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { useEffect, type JSX } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { rememberDayViewScroll, useDayViewScrollRestore } from './use-day-view-scroll-restore';

let scrollCalls: number[] = [];

function setWidth(width: number): void {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
}

function setScrollY(y: number): void {
    Object.defineProperty(window, 'scrollY', { configurable: true, value: y });
}

function Probe({ date, isDayView }: { date: string; isDayView: boolean }): null {
    useDayViewScrollRestore(date, isDayView);
    return null;
}

/** Mounts the probe on /calendar after a POP (Back) from /events/1. */
function BackFromEvent({ date, isDayView }: { date: string; isDayView: boolean }): JSX.Element {
    return (
        <MemoryRouter initialEntries={['/calendar', '/events/1']} initialIndex={1}>
            <Routes>
                <Route path="/calendar" element={<Probe date={date} isDayView={isDayView} />} />
                <Route path="/events/1" element={<GoBack />} />
            </Routes>
        </MemoryRouter>
    );
}

/** Mounts the probe on /calendar after a PUSH (a link) from /events/1. */
function LinkFromEvent({ date }: { date: string }): JSX.Element {
    return (
        <MemoryRouter initialEntries={['/events/1']}>
            <Routes>
                <Route path="/calendar" element={<Probe date={date} isDayView />} />
                <Route path="/events/1" element={<GoTo />} />
            </Routes>
        </MemoryRouter>
    );
}

function GoTo(): null {
    const navigate = useNavigate();
    useEffect(() => { void navigate('/calendar'); }, [navigate]);
    return null;
}

function GoBack(): null {
    const navigate = useNavigate();
    useEffect(() => { void navigate(-1); }, [navigate]);
    return null;
}

async function flushFrames(): Promise<void> {
    await vi.runAllTimersAsync();
}

describe('useDayViewScrollRestore', () => {
    const originalWidth = window.innerWidth;
    beforeEach(() => {
        sessionStorage.clear();
        scrollCalls = [];
        vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
        vi.spyOn(window, 'scrollTo').mockImplementation((...args: unknown[]) => {
            const y = args[1];
            if (typeof y !== 'number') return;
            scrollCalls.push(y);
            setScrollY(y);
        });
        setWidth(375);
        setScrollY(640);
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        setWidth(originalWidth);
        setScrollY(0);
    });

    it('restores the saved offset when Back returns to the same date in Day view', async () => {
        rememberDayViewScroll('2026-03-10');
        setScrollY(0);

        render(<BackFromEvent date="2026-03-10" isDayView />);
        await flushFrames();

        expect(scrollCalls).toContain(640);
        expect(window.scrollY).toBe(640);
    });

    it('does not restore on a fresh (PUSH) visit, and drops the saved offset', async () => {
        rememberDayViewScroll('2026-03-10');
        setScrollY(0);

        render(<LinkFromEvent date="2026-03-10" />);
        await flushFrames();

        expect(scrollCalls).toEqual([]);
        expect(sessionStorage.length).toBe(0);
    });

    it('does not restore when Back lands on another date or outside Day view', async () => {
        rememberDayViewScroll('2026-03-10');
        render(<BackFromEvent date="2026-03-11" isDayView />);
        await flushFrames();
        rememberDayViewScroll('2026-03-10');
        render(<BackFromEvent date="2026-03-10" isDayView={false} />);
        await flushFrames();

        expect(scrollCalls).toEqual([]);
    });

    it('saves nothing at tablet/desktop width (>=768px behaves as before)', () => {
        setWidth(768);

        rememberDayViewScroll('2026-03-10');

        expect(sessionStorage.length).toBe(0);
    });
});
