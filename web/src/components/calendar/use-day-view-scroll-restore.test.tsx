/**
 * ROK-2303: phone Day view → event → Back must land on the same scroll offset.
 * The window is the scroller; the offset is saved when the event is opened and
 * restored only on the next POP mount for the same date in Day view.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { useEffect, type JSX } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { rememberDayViewScroll, restoreWindowScroll, useDayViewScrollRestore } from './use-day-view-scroll-restore';
import { RESTORE_DAY_SCROLL_STATE } from './day-scroll-restore-flag';

let scrollCalls: number[] = [];
/** The window's max scroll offset (the grid's height); grows by `maxGrowth` after every scrollTo. */
let maxY = Number.POSITIVE_INFINITY;
let maxGrowth = 0;

function setWidth(width: number): void {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
}

function setScrollY(y: number): void {
    Object.defineProperty(window, 'scrollY', { configurable: true, value: y });
}

function Probe({ date, isDayView, ready = true }: { date: string; isDayView: boolean; ready?: boolean }): null {
    useDayViewScrollRestore(date, isDayView, ready);
    return null;
}

/** Mounts the probe on /calendar after a POP (Back) from /events/1. */
function BackFromEvent({ date, isDayView, ready = true }: { date: string; isDayView: boolean; ready?: boolean }): JSX.Element {
    return (
        <MemoryRouter initialEntries={['/calendar', '/events/1']} initialIndex={1}>
            <Routes>
                <Route path="/calendar" element={<Probe date={date} isDayView={isDayView} ready={ready} />} />
                <Route path="/events/1" element={<GoBack />} />
            </Routes>
        </MemoryRouter>
    );
}

/** Mounts the probe on /calendar after a PUSH (a link) from /events/1. */
function LinkFromEvent({ date, flagged = false }: { date: string; flagged?: boolean }): JSX.Element {
    return (
        <MemoryRouter initialEntries={['/events/1']}>
            <Routes>
                <Route path="/calendar" element={<Probe date={date} isDayView />} />
                <Route path="/events/1" element={<GoTo flagged={flagged} />} />
            </Routes>
        </MemoryRouter>
    );
}

function GoTo({ flagged }: { flagged: boolean }): null {
    const navigate = useNavigate();
    useEffect(() => { void navigate('/calendar', flagged ? { state: RESTORE_DAY_SCROLL_STATE } : {}); }, [navigate, flagged]);
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

/** Fake frames, a scrollTo spy that records offsets, and a 375px phone scrolled to 640. */
function installHookHarness(): void {
    const originalWidth = window.innerWidth;
    beforeEach(() => {
        sessionStorage.clear();
        scrollCalls = [];
        vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
        vi.spyOn(window, 'scrollTo').mockImplementation((...args: unknown[]) => {
            const y = args[1];
            if (typeof y !== 'number') return;
            scrollCalls.push(y);
            setScrollY(Math.min(y, maxY));
            maxY += maxGrowth;
        });
        maxY = Number.POSITIVE_INFINITY;
        maxGrowth = 0;
        setWidth(375);
        setScrollY(640);
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        setWidth(originalWidth);
        setScrollY(0);
    });
}

describe('useDayViewScrollRestore — restores', () => {
    installHookHarness();

    it('restores the saved offset when Back returns to the same date in Day view', async () => {
        rememberDayViewScroll('2026-03-10');
        setScrollY(0);

        render(<BackFromEvent date="2026-03-10" isDayView />);
        await flushFrames();

        expect(scrollCalls).toContain(640);
        expect(window.scrollY).toBe(640);
    });

    it('restores when the event page\'s "Back to Calendar" button (a flagged PUSH) returns to the same Day', async () => {
        rememberDayViewScroll('2026-03-10');
        setScrollY(0);

        render(<LinkFromEvent date="2026-03-10" flagged />);
        await flushFrames();

        expect(window.scrollY).toBe(640);
    });

    it('waits for the grid to finish loading, then restores on the final layout', async () => {
        rememberDayViewScroll('2026-03-10');
        setScrollY(0);

        const view = render(<BackFromEvent date="2026-03-10" isDayView ready={false} />);
        await flushFrames();
        expect(scrollCalls, 'no restore while the loading block is still above the grid').toEqual([]);

        view.rerender(<BackFromEvent date="2026-03-10" isDayView ready />);
        await flushFrames();
        expect(window.scrollY).toBe(640);
    });
});

describe('useDayViewScrollRestore — does not restore', () => {
    installHookHarness();

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

    it('does not restore when the width is no longer a phone width at restore time', async () => {
        rememberDayViewScroll('2026-03-10');
        setScrollY(0);
        setWidth(1024);

        render(<BackFromEvent date="2026-03-10" isDayView />);
        await flushFrames();

        expect(scrollCalls).toEqual([]);
    });
});

describe('restoreWindowScroll — the retry loop', () => {
    beforeEach(() => {
        scrollCalls = [];
        vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
        vi.spyOn(window, 'scrollTo').mockImplementation((...args: unknown[]) => {
            const y = args[1];
            if (typeof y !== 'number') return;
            scrollCalls.push(y);
            setScrollY(Math.min(y, maxY));
            maxY += maxGrowth;
        });
        setScrollY(0);
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        setScrollY(0);
    });

    it('keeps retrying while the page is too short, and stops once the offset sticks', async () => {
        maxY = 200;
        maxGrowth = 100;

        restoreWindowScroll(640);
        await vi.runAllTimersAsync();

        // Clamped to 200, 300, 400, 500, 600, then 640 sticks on the 6th frame.
        expect(window.scrollY).toBe(640);
        expect(scrollCalls).toHaveLength(6);
    });

    it('gives up after the frame budget when the page never grows tall enough', async () => {
        maxY = 100;
        maxGrowth = 0;

        restoreWindowScroll(640);
        await vi.runAllTimersAsync();

        expect(scrollCalls).toHaveLength(30);
        expect(window.scrollY).toBe(100);
    });

    it('stops on the first touch or wheel, so it never fights the user', async () => {
        for (const type of ['touchstart', 'wheel']) {
            scrollCalls = [];
            maxY = 100;
            maxGrowth = 0;
            restoreWindowScroll(640);
            vi.advanceTimersToNextFrame();
            window.dispatchEvent(new Event(type));
            await vi.runAllTimersAsync();

            expect(scrollCalls, `${type} ends the restore after one frame`).toHaveLength(1);
        }
    });
});
