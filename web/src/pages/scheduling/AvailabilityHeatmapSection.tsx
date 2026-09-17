/**
 * Group availability for the poll's desktop "Find a better time" modal.
 *
 * ROK-1588 retired the painted heatmap (`GameTimeGrid` + `heatmapOverlay`):
 * this section now mounts `GroupWeekView` — seven day columns × hour rows with
 * the counts, busy edge, your game time, already-suggested slots and the pick
 * as per-cell marks. The export name is kept so callers did not churn; the
 * footer CTA ("Suggest Wed 9 PM") lives in the sheet's suggest form (Q8).
 */
import { useMemo, type JSX } from 'react';
import type { AggregateGameTimeResponse } from '@raid-ledger/contract';
import { useGameTime } from '../../hooks/use-game-time';
import { GroupWeekView, type WeekCellRef } from '../../components/features/game-time/week/GroupWeekView';
import { toGroupCellMap } from '../../components/features/game-time/phone/group-day.utils';
import { toTemplateSlots } from '../../components/features/game-time/phone/phone-week-check.helpers';
import type { SlotMark } from '../../components/features/game-time/slot-marks.utils';
import { ViewerStaleHint } from './AvailabilityHeatmapLegend';
import { fillUnknownCells, isViewerStale, memberCountsFrom } from './availability-freshness';

export interface AvailabilityHeatmapSectionProps {
  data: AggregateGameTimeResponse | undefined;
  isLoading: boolean;
  /** A closed poll still shows the group, but no cell is a button. */
  readOnly?: boolean;
  weekStart: Date;
  onWeekChange: (delta: number) => void;
  /** Poll slots starting in the displayed week (`slotMarksForWeek`). */
  slotMarks?: Map<string, SlotMark>;
  picked?: WeekCellRef | null;
  onPick?: (dayOfWeek: number, hour: number) => void;
}

/**
 * The availability loading shape. Exported for the phone module (ROK-1580),
 * which is a different grid but must not invent a second loading treatment.
 */
export function HeatmapSkeleton(): JSX.Element {
  return (
    <div className="animate-pulse space-y-2">
      <div className="h-4 bg-overlay rounded w-48" />
      <div className="h-32 bg-overlay rounded" />
    </div>
  );
}

/** Whether the viewer's own game time is too old to count (ROK-1560). */
function viewerIsStale(data: AggregateGameTimeResponse): boolean {
  if (data.freshnessDays === undefined) return false;
  return isViewerStale(data.viewerGameTimeAgeDays, data.freshnessDays, data.viewerGameTimeStale);
}

/** Desktop group week — see file-level docstring. */
export function AvailabilityHeatmapSection(props: AvailabilityHeatmapSectionProps): JSX.Element | null {
  const { data, isLoading, readOnly, weekStart, onWeekChange, slotMarks, picked, onPick } = props;
  const cells = useMemo(() => toGroupCellMap(data ? fillUnknownCells(data) : []), [data]);
  const gameTime = useGameTime();
  const viewerSlots = useMemo(() => toTemplateSlots(gameTime.data?.slots ?? []), [gameTime.data]);

  if (isLoading) return <HeatmapSkeleton />;
  if (!data || cells.size === 0) return null;

  return (
    <div className="space-y-3">
      <GroupWeekView
        weekStart={weekStart} cells={cells} viewerSlots={viewerSlots}
        slotMarks={slotMarks} picked={picked}
        onPick={readOnly ? undefined : onPick}
        onWeekChange={onWeekChange}
        legend={{ memberCounts: memberCountsFrom(data) }}
      />
      {viewerIsStale(data) && <ViewerStaleHint />}
    </div>
  );
}
