/**
 * Availability heatmap wrapper for the scheduling poll page (ROK-965).
 * Uses GameTimeGrid with heatmapOverlay to show group availability
 * in the same weekly day×hour grid as the reschedule feature.
 */
import type { JSX } from 'react';
import type { AggregateGameTimeResponse } from '@raid-ledger/contract';
import { GameTimeGrid } from '../../components/features/game-time';

interface AvailabilityHeatmapSectionProps {
  data: AggregateGameTimeResponse | undefined;
  isLoading: boolean;
  readOnly?: boolean;
  onCellClick?: (dayOfWeek: number, hour: number) => void;
}

/** Loading placeholder for the heatmap section. */
function HeatmapSkeleton(): JSX.Element {
  return (
    <div className="animate-pulse space-y-2">
      <div className="h-4 bg-overlay rounded w-48" />
      <div className="h-32 bg-overlay rounded" />
    </div>
  );
}

/**
 * Section rendering the weekly availability grid for match members.
 * Uses GameTimeGrid's heatmapOverlay prop for color-intensity cells.
 */
export function AvailabilityHeatmapSection({
  data,
  isLoading,
  readOnly,
  onCellClick,
}: AvailabilityHeatmapSectionProps): JSX.Element | null {
  if (isLoading) return <HeatmapSkeleton />;
  if (!data || data.cells.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">
        Group Availability
      </h3>
      <p className="text-xs text-muted">
        {readOnly ? 'Showing when members are typically online.' : 'Click a time slot to suggest it.'}
      </p>
      <div data-testid="heatmap-grid">
        <GameTimeGrid
          slots={[]}
          readOnly
          heatmapOverlay={data.cells}
          onCellClick={readOnly ? undefined : onCellClick}
          compact
          noStickyOffset
        />
      </div>
    </div>
  );
}
