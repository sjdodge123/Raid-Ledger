/**
 * Tests for the poll availability heatmap section (ROK-1560).
 * Covers the two-channel legend, the stale-viewer refresh hint and the
 * `N free · M stale · K unknown` cell label.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { AggregateGameTimeResponse } from '@raid-ledger/contract';
import { renderWithProviders } from '../../test/render-helpers';
import { stubGridLayout } from '../../test/stub-grid-layout';
import { AvailabilityHeatmapSection } from './AvailabilityHeatmapSection';

const WEEK_START = new Date('2026-05-10T00:00:00.000Z');

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

function renderSection(data: AggregateGameTimeResponse) {
  return renderWithProviders(
    <AvailabilityHeatmapSection
      data={data} isLoading={false} readOnly weekStart={WEEK_START} onWeekChange={() => {}}
    />,
  );
}

describe('AvailabilityHeatmapSection legend (ROK-1560)', () => {
  beforeAll(() => { stubGridLayout(); });

  it('names all three channels, using the response freshnessDays in the copy', () => {
    renderSection(buildData({ freshnessDays: 7 }));
    const legend = screen.getByTestId('heatmap-legend');
    expect(within(legend).getByText(/free \(confirmed in the last 7 days\)/i)).toBeInTheDocument();
    expect(within(legend).getByText(/stale \(older than 7 days\)/i)).toBeInTheDocument();
    expect(within(legend).getByText(/unknown \(no game time set\)/i)).toBeInTheDocument();
  });

  it('echoes a non-default freshness window', () => {
    renderSection(buildData({ freshnessDays: 14 }));
    expect(screen.getByTestId('heatmap-legend')).toHaveTextContent(/last 14 days/i);
  });

  it('is omitted for an aggregate without the freshness model (events heatmap)', () => {
    renderSection(buildData({
      cells: [{ dayOfWeek: 1, hour: 20, availableCount: 3, totalCount: 9 }],
      freshnessDays: undefined, totalMembers: undefined,
      untemplatedMembers: undefined, viewerGameTimeAgeDays: undefined,
    }));
    expect(screen.queryByTestId('heatmap-legend')).not.toBeInTheDocument();
  });
});

describe('AvailabilityHeatmapSection stale-viewer hint (ROK-1560)', () => {
  beforeAll(() => { stubGridLayout(); });

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

describe('AvailabilityHeatmapSection cell label (ROK-1560)', () => {
  beforeAll(() => { stubGridLayout(); });

  it('reads "3 free · 2 stale · 4 unknown" on a cell carrying the freshness counts', () => {
    renderSection(buildData());
    expect(screen.getByTestId('cell-1-20')).toHaveAttribute('title', '3 free · 2 stale · 4 unknown');
  });

  it('keeps the legacy copy when the counts are absent', () => {
    renderSection(buildData({
      cells: [{ dayOfWeek: 1, hour: 20, availableCount: 3, totalCount: 9 }],
      freshnessDays: undefined,
    }));
    expect(screen.getByTestId('cell-1-20')).toHaveAttribute('title', '3 of 9 players available');
  });
});
