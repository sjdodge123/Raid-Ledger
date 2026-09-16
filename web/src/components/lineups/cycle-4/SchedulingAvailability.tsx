/**
 * Group-availability heatmap section for the ROK-1300 Scheduling composite.
 *
 * Owns the `useMatchAvailability` query, week navigation, slot preview blocks,
 * and the cell-click → suggest-form prefill wiring that previously lived in
 * `scheduling-poll-page.tsx::ActivePollSections`. Renders below the hero +
 * game-ref banner per the Sx/Ss wireframe.
 */
import { useState, type JSX } from 'react';
import type {
  AggregateGameTimeResponse,
  SchedulePollPageResponseDto,
} from '@raid-ledger/contract';
import { useMatchAvailability } from '../../../hooks/use-scheduling';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { AvailabilityHeatmapSection } from '../../../pages/scheduling/AvailabilityHeatmapSection';
import type { GameTimePreviewBlock } from '../../features/game-time/game-time-grid.types';
import { PhoneGroupAvailability } from './PhoneGroupAvailability';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
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
  // ROK-1570: the week is declared BEFORE the query because the query is
  // scoped to it — the aggregate subtracts commitments for this exact week.
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()));
  const { data, isLoading } = useMatchAvailability(lineupId, matchId, weekStart);
  const [previewBlock, setPreviewBlock] = useState<
    GameTimePreviewBlock | undefined
  >();
  // ROK-1580: below 768px the seven columns become the one-day group module.
  const isDesktop = useMediaQuery(DESKTOP_MQ);

  const handleWeekChange = (delta: number): void => {
    const next = new Date(weekStart);
    next.setDate(next.getDate() + delta * 7);
    setWeekStart(next);
    // ROK-1580 (review 2c): the suggestion belongs to the week it was tapped
    // in — the form still holds THAT datetime, so a new week starts clean
    // rather than redrawing the block on the same weekday.
    setPreviewBlock(undefined);
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

  const shared = {
    data,
    isLoading,
    readOnly,
    weekStart,
    onWeekChange: handleWeekChange,
  };
  return isDesktop ? (
    <DesktopHeatmap
      {...shared}
      previewBlocks={[
        ...slotsToPreviewBlocks(slots, weekStart),
        ...(previewBlock ? [previewBlock] : []),
      ]}
      onCellClick={handleCellClick}
    />
  ) : (
    <PhoneHeatmap
      {...shared}
      onPickHour={handleCellClick}
      suggested={suggestedCell(previewBlock)}
    />
  );
}

/** What both viewports need from the state this component owns. */
interface SharedHeatmapProps {
  data: AggregateGameTimeResponse | undefined;
  isLoading: boolean;
  readOnly: boolean;
  weekStart: Date;
  onWeekChange: (delta: number) => void;
}

/** The unchanged seven-column grid (>= 768px). */
function DesktopHeatmap(
  props: SharedHeatmapProps & {
    previewBlocks: GameTimePreviewBlock[];
    onCellClick: (day: number, hour: number) => void;
  },
): JSX.Element {
  const { previewBlocks, onCellClick, readOnly, ...rest } = props;
  return (
    // `isolate` contains the heatmap's internal overlay z-indexes (preview
    // blocks z-[21], current-time z-[25], hover tooltip z-30) in their own
    // stacking context so they can't paint above the hero toolbar (pinned
    // on desktop, ROK-1558)
    // (z-20) when the page is scrolled (ROK-1300 review finding).
    <div className="isolate">
      <AvailabilityHeatmapSection
        {...rest}
        readOnly={readOnly}
        previewBlocks={previewBlocks}
        onCellClick={readOnly ? undefined : onCellClick}
      />
    </div>
  );
}

/** The one-day group module (< 768px, ROK-1580). */
function PhoneHeatmap(
  props: SharedHeatmapProps & {
    onPickHour: (day: number, hour: number) => void;
    suggested: { dayOfWeek: number; hour: number } | null;
  },
): JSX.Element {
  return (
    // The sheet gives its body a definite height; this wrapper passes it
    // down so the module's rows stretch instead of scrolling (ROK-1580).
    <div className="isolate flex min-h-0 flex-1 flex-col">
      <PhoneGroupAvailability {...props} />
    </div>
  );
}

/**
 * The phone module's suggestion, read off the SAME preview block the desktop
 * grid draws — one tap must not mean two different things per viewport.
 */
function suggestedCell(
  block: GameTimePreviewBlock | undefined,
): { dayOfWeek: number; hour: number } | null {
  if (!block) return null;
  return { dayOfWeek: block.dayOfWeek, hour: block.startHour };
}
