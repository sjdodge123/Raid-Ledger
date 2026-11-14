/** The mount-time scroll to today is flagged as app-started before it starts. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { ScheduleView } from './ScheduleView';
import type { CalendarEvent } from './CalendarView';
import type { EventResponseDto } from '@raid-ledger/contract';

const hoisted = vi.hoisted(() => ({ ignoreScrollFor: vi.fn() }));
vi.mock('../../hooks/use-scroll-direction', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../hooks/use-scroll-direction')>()),
    ignoreScrollFor: hoisted.ignoreScrollFor,
}));

const NOW = new Date('2026-02-10T12:00:00Z');

function todayEvent(): CalendarEvent {
    const resource: EventResponseDto = {
        id: 1, title: 'Raid', description: '', startTime: '2026-02-10T20:00:00Z', endTime: '2026-02-10T22:00:00Z',
        creator: { id: 1, username: 'Tester', avatar: null },
        game: { id: 1, name: 'World of Warcraft', slug: 'world-of-warcraft', coverUrl: null },
        signupCount: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    };
    return { id: 1, title: 'Raid', start: new Date(resource.startTime), end: new Date(resource.endTime), resource };
}

describe('ScheduleView — scroll to today on mount', () => {
    const original = Element.prototype.scrollIntoView;
    const scrollIntoView = vi.fn();

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        hoisted.ignoreScrollFor.mockClear();
        scrollIntoView.mockClear();
        Element.prototype.scrollIntoView = scrollIntoView;
    });
    afterEach(() => {
        Element.prototype.scrollIntoView = original;
        vi.useRealTimers();
    });

    it('calls ignoreScrollFor before scrollIntoView so the tab bar stays shown', () => {
        render(<ScheduleView events={[todayEvent()]} currentDate={NOW} onDateChange={vi.fn()} onSelectEvent={vi.fn()} eventOverlapsGameTime={() => false} />);
        act(() => vi.advanceTimersByTime(150));
        expect(scrollIntoView).toHaveBeenCalledTimes(1);
        expect(hoisted.ignoreScrollFor).toHaveBeenCalledTimes(1);
        const ignoreOrder = hoisted.ignoreScrollFor.mock.invocationCallOrder[0] ?? Infinity;
        const scrollOrder = scrollIntoView.mock.invocationCallOrder[0] ?? -Infinity;
        expect(ignoreOrder).toBeLessThan(scrollOrder);
    });
});
