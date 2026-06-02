/**
 * Group-availability heatmap section for the ROK-1300 Scheduling composite.
 *
 * Owns the `useMatchAvailability` query, week navigation, slot preview blocks,
 * and the cell-click → suggest-form prefill wiring that previously lived in
 * `scheduling-poll-page.tsx::ActivePollSections`. Renders below the hero +
 * game-ref banner per the Sx/Ss wireframe.
 */
import { useState, type JSX } from 'react';
import type { SchedulePollPageResponseDto } from '@raid-ledger/contract';
import { useMatchAvailability } from '../../../hooks/use-scheduling';
import { AvailabilityHeatmapSection } from '../../../pages/scheduling/AvailabilityHeatmapSection';
import type { GameTimePreviewBlock } from '../../features/game-time/game-time-grid.types';
import {
  getWeekStart,
  slotsToPreviewBlocks,
  toDatetimeLocal,
} from './scheduling-availability';

export interface SchedulingAvailabilityProps {
  lineupId: number;
  matchId: number;
  slots: SchedulePollPageResponseDto['slots'];
  readOnly: boolean;
  /** Fires with a datetime-local string when a cell is clicked. */
  onPrefill: (datetimeLocal: string) => void;
}

/** Heatmap + week state — see file-level docstring. */
export function SchedulingAvailability(
  props: SchedulingAvailabilityProps,
): JSX.Element {
  const { lineupId, matchId, slots, readOnly, onPrefill } = props;
  const { data, isLoading } = useMatchAvailability(lineupId, matchId);
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()));
  const [previewBlock, setPreviewBlock] = useState<
    GameTimePreviewBlock | undefined
  >();

  const handleWeekChange = (delta: number): void => {
    const next = new Date(weekStart);
    next.setDate(next.getDate() + delta * 7);
    setWeekStart(next);
  };

  const handleCellClick = (day: number, hour: number): void => {
    onPrefill(toDatetimeLocal(day, hour, weekStart));
    setPreviewBlock({
      dayOfWeek: day,
      startHour: hour,
      endHour: hour + 2,
      label: 'Suggested Time',
      title: 'Suggested Time',
      variant: 'selected',
    });
  };

  return (
    // `isolate` contains the heatmap's internal overlay z-indexes (preview
    // blocks z-[21], current-time z-[25], hover tooltip z-30) in their own
    // stacking context so they can't paint above the sticky hero toolbar
    // (z-20) when the page is scrolled (ROK-1300 review finding).
    <div className="isolate">
      <AvailabilityHeatmapSection
        data={data}
        isLoading={isLoading}
        readOnly={readOnly}
        weekStart={weekStart}
        onWeekChange={handleWeekChange}
        previewBlocks={[
          ...slotsToPreviewBlocks(slots, weekStart),
          ...(previewBlock ? [previewBlock] : []),
        ]}
        onCellClick={readOnly ? undefined : handleCellClick}
      />
    </div>
  );
}
