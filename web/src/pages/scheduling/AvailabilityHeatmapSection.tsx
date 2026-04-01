/**
 * Availability heatmap wrapper for the scheduling poll page (ROK-965).
 * Uses GameTimeGrid with heatmapOverlay to show group availability
 * in the same weekly day×hour grid as the reschedule feature.
 */
import type { JSX } from 'react';
import type { AggregateGameTimeResponse } from '@raid-ledger/contract';
import { GameTimeGrid } from '../../components/features/game-time';
import type { GameTimePreviewBlock } from '../../components/features/game-time/game-time-grid.types';

interface AvailabilityHeatmapSectionProps {
  data: AggregateGameTimeResponse | undefined;
  isLoading: boolean;
  readOnly?: boolean;
  onCellClick?: (dayOfWeek: number, hour: number) => void;
  previewBlocks?: GameTimePreviewBlock[];
  weekStart: Date;
  onWeekChange: (delta: number) => void;
}

function HeatmapSkeleton(): JSX.Element {
  return (
    <div className="animate-pulse space-y-2">
      <div className="h-4 bg-overlay rounded w-48" />
      <div className="h-32 bg-overlay rounded" />
    </div>
  );
}

function weekLabel(sun: Date): string {
  const sat = new Date(sun);
  sat.setDate(sun.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(sun)} – ${fmt(sat)}`;
}

export function AvailabilityHeatmapSection({
  data, isLoading, readOnly, onCellClick, previewBlocks, weekStart, onWeekChange,
}: AvailabilityHeatmapSectionProps): JSX.Element | null {
  if (isLoading) return <HeatmapSkeleton />;
  if (!data || data.cells.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">
        Group Availability
      </h3>
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => onWeekChange(-1)}
          className="px-2 py-1 text-xs text-muted hover:text-foreground border border-edge rounded transition-colors">
          ← Prev Week
        </button>
        <span className="text-xs text-muted">{weekLabel(weekStart)}</span>
        <button type="button" onClick={() => onWeekChange(1)}
          className="px-2 py-1 text-xs text-muted hover:text-foreground border border-edge rounded transition-colors">
          Next Week →
        </button>
      </div>
      <p className="text-xs text-muted">
        {readOnly ? 'Showing when members are typically online.' : 'Click a time slot to suggest it.'}
      </p>
      <div data-testid="heatmap-grid">
        <GameTimeGrid
          slots={[]}
          readOnly
          heatmapOverlay={data.cells}
          onCellClick={readOnly ? undefined : onCellClick}
          previewBlocks={previewBlocks?.length ? previewBlocks : undefined}
          weekStart={weekStart.toISOString()}
          compact
          noStickyOffset
        />
      </div>
    </div>
  );
}
