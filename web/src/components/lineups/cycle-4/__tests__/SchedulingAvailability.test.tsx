/**
 * ROK-1580 — the "Find a better time" body branches on the viewport.
 *
 * Below 1024px it is the phone module (one day, group mode); from 1024px up it is
 * the week-columns view (ROK-1588 — the painted heatmap is retired). Both are fed
 * by the same `weekStart`, `slotMarks` and pick state, so this file pins the
 * branch, the prefill on both viewports, and that both draw the poll's slots.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';
import type { AggregateGameTimeResponse } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../../test/render-helpers';
import { stubGridLayout } from '../../../../test/stub-grid-layout';
import { SchedulingAvailability, type SchedulingAvailabilityProps } from '../SchedulingAvailability';
import { getWeekStart } from '../scheduling-availability';

const getMatchAvailabilityMock = vi.fn();

vi.mock('../../../../lib/api-client', () => ({
    getSchedulePoll: vi.fn(),
    toggleScheduleVote: vi.fn(),
    suggestSlot: vi.fn(),
    createEventFromSlot: vi.fn(),
    retractAllVotes: vi.fn(),
    getMatchAvailability: (...args: unknown[]) => getMatchAvailabilityMock(...args),
    getSchedulingBanner: vi.fn(),
    getOtherPolls: vi.fn(),
    cancelSchedulePoll: vi.fn(),
    remindVoters: vi.fn(),
    addPollMembers: vi.fn(),
}));

vi.mock('../../../../hooks/use-game-time', () => ({
    useGameTime: () => ({ data: { slots: [] } }),
}));

/** Wednesday 16 Sep 2026, 8 PM — one cell the whole poll is free in. */
const NOW = new Date(2026, 8, 16, 12, 0, 0);
const WED = 3;

function buildAggregate(): AggregateGameTimeResponse {
    return {
        eventId: 1,
        totalUsers: 2,
        totalMembers: 2,
        freshnessDays: 7,
        untemplatedMembers: 0,
        viewerGameTimeAgeDays: 0,
        cells: [
            { dayOfWeek: WED, hour: 20, availableCount: 2, totalCount: 2, staleCount: 0, unknownCount: 0 },
        ],
    } as AggregateGameTimeResponse;
}

/** Force `useMediaQuery('(min-width: 1024px)')` to a known answer. */
function stubViewport(desktop: boolean): void {
    vi.stubGlobal('matchMedia', (query: string) => ({
        matches: desktop && query.includes('1024'),
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
    }));
}

const onPrefill = vi.fn();

/** A poll slot on Wed 16 Sep, 9 PM local, with two votes. */
const SLOTS = [
    { id: 1, proposedTime: new Date(2026, 8, 16, 21).toISOString(), votes: [{}, {}] },
] as unknown as SchedulingAvailabilityProps['slots'];

function renderSection(opts: { slots?: SchedulingAvailabilityProps['slots']; readOnly?: boolean } = {}) {
    return renderWithProviders(
        <SchedulingAvailability
            lineupId={3}
            matchId={9}
            slots={opts.slots ?? []}
            readOnly={opts.readOnly ?? false}
            onPrefill={onPrefill}
        />,
    );
}

describe('SchedulingAvailability viewport branch (ROK-1580)', () => {
    beforeAll(() => { stubGridLayout(); });

    beforeEach(() => {
        vi.clearAllMocks();
        getMatchAvailabilityMock.mockResolvedValue(buildAggregate());
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(NOW);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('mounts the phone module below 1024px, not the seven-column grid', async () => {
        stubViewport(false);
        renderSection();

        expect(await screen.findByTestId('phone-week-editor')).toBeInTheDocument();
        expect(screen.queryByTestId('heatmap-grid')).toBeNull();
    });

    it('mounts the week-columns view from 1024px up, not the retired heatmap', async () => {
        stubViewport(true);
        renderSection();

        expect(await screen.findByTestId('group-week-view')).toBeInTheDocument();
        expect(screen.queryByTestId('heatmap-grid')).toBeNull();
        expect(screen.queryByTestId('phone-week-editor')).toBeNull();
    });

    it('prefills the suggest form from a phone tap, in the displayed week', async () => {
        stubViewport(false);
        renderSection();

        fireEvent.click(await screen.findByTestId(`phone-group-cell-${WED}-20`));

        expect(onPrefill).toHaveBeenCalledWith('2026-09-16T20:00');
    });

    it('re-queries the neighbouring week when the pager rolls past Saturday', async () => {
        stubViewport(false);
        renderSection();
        const next = await screen.findByRole('button', { name: 'Next day' });

        for (let i = 0; i < 4; i += 1) fireEvent.click(next);

        const nextWeek = getWeekStart(NOW);
        nextWeek.setDate(nextWeek.getDate() + 7);
        await waitFor(() =>
            expect(getMatchAvailabilityMock).toHaveBeenCalledWith(3, 9, nextWeek),
        );
    });
});

describe('SchedulingAvailability desktop week view (ROK-1588)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getMatchAvailabilityMock.mockResolvedValue(buildAggregate());
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(NOW);
        stubViewport(true);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('prefills the suggest form from a cell pick and marks the cell picked', async () => {
        renderSection();

        fireEvent.click(await screen.findByTestId(`group-week-cell-${WED}-20`));

        expect(onPrefill).toHaveBeenCalledWith('2026-09-16T20:00');
        expect(screen.getByTestId(`group-week-cell-${WED}-20`)).toHaveAttribute('data-picked', 'true');
    });

    it('clears the pick when the week changes', async () => {
        renderSection();
        fireEvent.click(await screen.findByTestId(`group-week-cell-${WED}-20`));

        fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Previous week' }));

        const cell = await screen.findByTestId(`group-week-cell-${WED}-20`);
        expect(cell).not.toHaveAttribute('data-picked');
    });

    it("draws the poll's slots as vote marks in the displayed week", async () => {
        renderSection({ slots: SLOTS });

        expect(await screen.findByTestId(`group-week-cell-${WED}-21`)).toHaveAttribute('data-votes', '2');
    });

    it('renders no cell buttons for a read-only poll', async () => {
        renderSection({ readOnly: true });

        const grid = await screen.findByTestId('group-week-grid');
        expect(within(grid).queryAllByRole('button')).toHaveLength(0);
    });

    it('hands the phone module the same slot marks', async () => {
        stubViewport(false);
        renderSection({ slots: SLOTS });

        expect(await screen.findByTestId('phone-group-slot-block-21')).toBeInTheDocument();
    });
});
