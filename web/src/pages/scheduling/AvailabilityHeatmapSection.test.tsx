/**
 * Tests for the poll's desktop group availability (ROK-1588 — the painted
 * heatmap is retired; this section mounts `GroupWeekView`). Also pins the
 * stale-viewer refresh hint (ROK-1560) that survived the retirement.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import type { AggregateGameTimeResponse } from '@raid-ledger/contract';
import { renderWithProviders } from '../../test/render-helpers';
import type { SlotMark } from '../../components/features/game-time/slot-marks.utils';
import { groupCellKey } from '../../components/features/game-time/phone/group-day.utils';
import { AvailabilityHeatmapSection, type AvailabilityHeatmapSectionProps } from './AvailabilityHeatmapSection';

vi.mock('../../hooks/use-game-time', () => ({
  useGameTime: () => ({ data: { slots: [] } }),
}));

/** Sunday 10 May 2026, local midnight. */
const WEEK_START = new Date(2026, 4, 10);

function buildData(overrides: Partial<AggregateGameTimeResponse> = {}): AggregateGameTimeResponse {
  return {
    eventId: 42,
    totalUsers: 9,
    cells: [{ dayOfWeek: 1, hour: 20, availableCount: 3, totalCount: 9, staleCount: 2, unknownCount: 4 }],
    totalMembers: 9,
    freshnessDays: 7,
    untemplatedMembers: 4,
    viewerGameTimeAgeDays: 0,
    ...overrides,
  } as AggregateGameTimeResponse;
}

function renderSection(data: AggregateGameTimeResponse, props: Partial<AvailabilityHeatmapSectionProps> = {}) {
  return renderWithProviders(
    <AvailabilityHeatmapSection
      data={data} isLoading={false} readOnly weekStart={WEEK_START} onWeekChange={() => {}} {...props}
    />,
  );
}

describe('AvailabilityHeatmapSection week view (ROK-1588)', () => {
  it('mounts the week-columns view, not the retired heatmap grid or legend', () => {
    renderSection(buildData());
    expect(screen.getByTestId('group-week-view')).toBeInTheDocument();
    expect(screen.queryByTestId('heatmap-grid')).toBeNull();
    expect(screen.queryByTestId('heatmap-legend')).toBeNull();
    expect(screen.queryByTestId('cell-1-20')).toBeNull();
  });

  it('labels a freshness cell with its counts', () => {
    renderSection(buildData());
    expect(screen.getByTestId('group-week-cell-1-20')).toHaveAttribute('aria-label', 'Mon 8 PM: 3 free, 2 stale');
  });

  it('renders no cell buttons for a read-only poll', () => {
    renderSection(buildData());
    expect(within(screen.getByTestId('group-week-grid')).queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByTestId('group-week-cell-1-20')).toHaveAttribute('role', 'img');
  });

  it('calls onPick on a cell click and marks the picked cell', () => {
    const onPick = vi.fn();
    renderSection(buildData(), { readOnly: false, onPick, picked: { dayOfWeek: 1, hour: 20 } });
    const cell = screen.getByTestId('group-week-cell-1-20');
    fireEvent.click(cell);
    expect(onPick).toHaveBeenCalledWith(1, 20);
    expect(cell).toHaveAttribute('data-picked', 'true');
  });

  it('draws the slot marks it is handed', () => {
    const slotMarks = new Map<string, SlotMark>([[groupCellKey(1, 20), { dayOfWeek: 1, hour: 20, votes: 2 }]]);
    renderSection(buildData(), { slotMarks });
    expect(screen.getByTestId('group-week-cell-1-20')).toHaveAttribute('data-votes', '2');
  });

  it('omits the members clause for an aggregate without the freshness model (events)', () => {
    renderSection(buildData({
      cells: [{ dayOfWeek: 1, hour: 20, availableCount: 3, totalCount: 9 }],
      freshnessDays: undefined, totalMembers: undefined,
      untemplatedMembers: undefined, viewerGameTimeAgeDays: undefined,
    }));
    expect(screen.getByTestId('group-week-view')).toBeInTheDocument();
    expect(screen.queryByTestId('group-week-members')).toBeNull();
  });

  it('renders the skeleton while loading and nothing without data', () => {
    const { container, unmount } = renderSection(buildData(), { isLoading: true });
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    unmount();
    renderSection(undefined as unknown as AggregateGameTimeResponse);
    expect(screen.queryByTestId('group-week-view')).toBeNull();
  });
});

describe('AvailabilityHeatmapSection stale-viewer hint (ROK-1560)', () => {
  it('nudges a viewer who has never confirmed their game time', () => {
    renderSection(buildData({ viewerGameTimeAgeDays: null }));
    const hint = screen.getByTestId('heatmap-stale-hint');
    expect(hint).toHaveTextContent(/your game time is stale/i);
    expect(within(hint).getByRole('link')).toHaveAttribute('href', '/profile/gaming/game-time');
  });

  it('nudges a viewer whose game time is older than the freshness window', () => {
    renderSection(buildData({ viewerGameTimeAgeDays: 30, freshnessDays: 7 }));
    expect(screen.getByTestId('heatmap-stale-hint')).toBeInTheDocument();
  });

  it('trusts the server verdict over the floored day count (7.5 days old → stale)', () => {
    renderSection(buildData({ viewerGameTimeAgeDays: 7, freshnessDays: 7, viewerGameTimeStale: true }));
    expect(screen.getByTestId('heatmap-stale-hint')).toBeInTheDocument();
  });

  it('stays quiet when the server says fresh even if the day count looks old', () => {
    renderSection(buildData({ viewerGameTimeAgeDays: 30, freshnessDays: 7, viewerGameTimeStale: false }));
    expect(screen.queryByTestId('heatmap-stale-hint')).not.toBeInTheDocument();
  });

  it('stays quiet when the viewer confirmed exactly on the freshness boundary', () => {
    renderSection(buildData({ viewerGameTimeAgeDays: 7, freshnessDays: 7 }));
    expect(screen.queryByTestId('heatmap-stale-hint')).not.toBeInTheDocument();
  });

  it('stays quiet for a fresh viewer', () => {
    renderSection(buildData({ viewerGameTimeAgeDays: 0 }));
    expect(screen.queryByTestId('heatmap-stale-hint')).not.toBeInTheDocument();
  });
});
