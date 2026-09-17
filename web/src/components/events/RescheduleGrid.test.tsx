/**
 * RescheduleGrid (ROK-1588 lane R) — the Reschedule picker on the shared
 * week-columns view (desktop) and the group day module (phone).
 *
 * Time is pinned to Wed Sep 16 2026 12:00 LOCAL and every instant is built in
 * local time, so the assertions hold in any TZ the runner uses.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { AggregateGameTimeResponse } from '@raid-ledger/contract';
import { RescheduleGrid, type RescheduleGridProps } from './RescheduleGrid';
import { PHONE_MQ } from '../../lib/breakpoints';

const media = vi.hoisted(() => ({ phone: false }));
vi.mock('../../hooks/use-media-query', () => ({
    useMediaQuery: vi.fn((query: string) => (query === '(max-width: 1023px)' ? media.phone : !media.phone)),
}));

vi.mock('../../hooks/use-game-time', () => ({
    useGameTime: vi.fn(() => ({ data: { slots: [{ dayOfWeek: 5, hour: 19, status: 'available' }] } })),
}));

// The phone module has its own suite; here it only has to prove what it is fed.
vi.mock('../lineups/cycle-4/PhoneGroupAvailability', () => ({
    PhoneGroupAvailability: (p: {
        onPickHour: (d: number, h: number) => void; sizeNoun?: string;
        suggested?: { dayOfWeek: number; hour: number } | null;
    }) => (
        <div data-testid="phone-group-availability" data-size-noun={p.sizeNoun}
            data-suggested={p.suggested ? `${p.suggested.dayOfWeek}-${p.suggested.hour}` : ''}>
            <button type="button" onClick={() => p.onPickHour(4, 21)}>phone-pick</button>
        </div>
    ),
}));

const NOW = new Date(2026, 8, 16, 12, 0);          // Wed Sep 16 2026, noon
const NEXT_WEEK_EVENT = new Date(2026, 8, 23, 20); // Wed Sep 23 2026, 8 PM

const DATA: AggregateGameTimeResponse = {
    eventId: 42,
    totalUsers: 5,
    cells: [
        { dayOfWeek: 3, hour: 20, availableCount: 5, totalCount: 5 },
        { dayOfWeek: 4, hour: 21, availableCount: 4, totalCount: 5 },
    ],
};

function renderGrid(overrides: Partial<RescheduleGridProps> = {}) {
    const onPick = vi.fn();
    const props: RescheduleGridProps = {
        data: DATA, isLoading: false, currentStart: NEXT_WEEK_EVENT, picked: null, onPick, ...overrides,
    };
    const view = render(<RescheduleGrid {...props} />);
    return { ...view, onPick: props.onPick as ReturnType<typeof vi.fn> };
}

const cell = (day: number, hour: number) => screen.getByTestId(`group-week-cell-${day}-${hour}`);

beforeEach(() => {
    media.phone = false;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
});
afterEach(() => { vi.useRealTimers(); });

describe('RescheduleGrid — desktop', () => {
    it('mounts the shared week view, not the retired heatmap grid', () => {
        renderGrid();
        expect(screen.getByTestId('group-week-view')).toBeInTheDocument();
        expect(screen.queryByTestId('game-time-grid')).not.toBeInTheDocument();
        expect(screen.queryByTestId('phone-group-availability')).not.toBeInTheDocument();
    });

    it('notes the current start with its date', () => {
        renderGrid();
        expect(screen.getByTestId('reschedule-current')).toHaveTextContent(
            'Currently Wed Sep 23, 8 PM. Pick a new time; everyone signed up is notified.',
        );
    });

    it('opens on the event week when the event is ahead: a pick lands on that week, not the next occurrence', () => {
        const { onPick } = renderGrid();
        fireEvent.click(cell(4, 21));
        // nextOccurrence(Thu, 21) from Wed Sep 16 would be Sep 17.
        expect(onPick).toHaveBeenCalledWith('2026-09-24T21:00', { dayOfWeek: 4, hour: 21 });
    });

    it('opens on this week when the current start is in the past', () => {
        const { onPick } = renderGrid({ currentStart: new Date(2026, 1, 25, 20) });
        fireEvent.click(cell(6, 20));
        expect(onPick).toHaveBeenCalledWith('2026-09-19T20:00', { dayOfWeek: 6, hour: 20 });
    });

    it('paging back a week moves the picked date with the displayed week', () => {
        const { onPick } = renderGrid();
        fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
        fireEvent.click(cell(4, 21));
        expect(onPick).toHaveBeenCalledWith('2026-09-17T21:00', { dayOfWeek: 4, hour: 21 });
    });

    it('disables past cells and ignores clicks on them', () => {
        const { onPick } = renderGrid({ currentStart: new Date(2026, 1, 25, 20) });
        expect(cell(1, 20)).toHaveAttribute('aria-disabled', 'true'); // Mon Sep 14
        fireEvent.click(cell(1, 20));
        expect(onPick).not.toHaveBeenCalled();
        expect(cell(4, 21)).not.toHaveAttribute('aria-disabled');     // Thu Sep 17, ahead
    });

    it('marks the current start cell and does not let it be picked', () => {
        const { onPick } = renderGrid();
        expect(cell(3, 20)).toHaveAttribute('data-current', 'true');
        fireEvent.click(cell(3, 20));
        expect(onPick).not.toHaveBeenCalled();
    });

    it('only marks the current start in its own week', () => {
        renderGrid();
        fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
        expect(cell(3, 20)).not.toHaveAttribute('data-current');
    });

    it('outlines the picked start only while its week is displayed', () => {
        renderGrid({ picked: new Date(2026, 8, 24, 21) });
        expect(cell(4, 21)).toHaveAttribute('data-picked', 'true');
        fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
        expect(cell(4, 21)).not.toHaveAttribute('data-picked');
    });

    it('shows the viewer\'s own game time and legacy counts (no freshness model)', () => {
        renderGrid();
        expect(cell(5, 19)).toHaveAttribute('data-you', 'true');
        expect(cell(4, 21).getAttribute('aria-label')).toBe('Thu 9 PM: 4 of 5 free');
        expect(screen.queryByTestId('group-week-members')).not.toBeInTheDocument();
    });
});

describe('RescheduleGrid — states', () => {
    it('keeps the loading copy', () => {
        renderGrid({ isLoading: true, data: undefined });
        expect(screen.getByText('Loading availability data...')).toBeInTheDocument();
        expect(screen.queryByTestId('group-week-view')).not.toBeInTheDocument();
    });

    it('keeps the zero-signup copy and hides the week view', () => {
        renderGrid({ data: { ...DATA, totalUsers: 0, cells: [] } });
        expect(screen.getByText('No players signed up yet -- no availability data to display.')).toBeInTheDocument();
        expect(screen.queryByTestId('group-week-view')).not.toBeInTheDocument();
    });
});

describe('RescheduleGrid — phone', () => {
    beforeEach(() => { media.phone = true; });

    it('mounts the group day module sized by "signed up"', () => {
        expect(PHONE_MQ).toBe('(max-width: 1023px)'); // the mock above keys on it
        renderGrid();
        const phone = screen.getByTestId('phone-group-availability');
        expect(phone).toHaveAttribute('data-size-noun', 'signed up');
        expect(screen.queryByTestId('group-week-view')).not.toBeInTheDocument();
        expect(screen.queryByTestId('reschedule-current')).not.toBeInTheDocument();
    });

    it('a tap uses the same displayed-week start computation', () => {
        const { onPick } = renderGrid();
        fireEvent.click(screen.getByText('phone-pick'));
        expect(onPick).toHaveBeenCalledWith('2026-09-24T21:00', { dayOfWeek: 4, hour: 21 });
    });

    it('passes the picked start through as the Suggested block', () => {
        renderGrid({ picked: new Date(2026, 8, 24, 21) });
        expect(screen.getByTestId('phone-group-availability')).toHaveAttribute('data-suggested', '4-21');
    });
});
