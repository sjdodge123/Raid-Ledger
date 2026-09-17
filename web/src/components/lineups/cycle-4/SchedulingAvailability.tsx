/**
 * Group-availability section for the ROK-1300 Scheduling composite.
 *
 * Owns the `useMatchAvailability` query, week navigation, the poll's
 * already-suggested slot marks, and the cell pick → suggest-form prefill.
 * Desktop mounts the week-columns view (ROK-1588); below 1024px the one-day
 * group module (ROK-1580). Both read the SAME `slotMarks` and `picked` state,
 * so one tap never means two different things per viewport.
 */
import { useMemo, useState, type JSX } from 'react';
import type { SchedulePollPageResponseDto } from '@raid-ledger/contract';
import { useMatchAvailability } from '../../../hooks/use-scheduling';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { AvailabilityHeatmapSection } from '../../../pages/scheduling/AvailabilityHeatmapSection';
import type { WeekCellRef } from '../../features/game-time/week/GroupWeekView';
import { slotMarksForWeek } from '../../features/game-time/slot-marks.utils';
import { PhoneGroupAvailability } from './PhoneGroupAvailability';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { getWeekStart, toDatetimeLocal } from './scheduling-availability';

export interface SchedulingAvailabilityProps {
  lineupId: number;
  matchId: number;
  slots: SchedulePollPageResponseDto['slots'];
  readOnly: boolean;
  /** Fires with a datetime-local string when a cell is picked. */
  onPrefill: (datetimeLocal: string) => void;
}

/** Group availability + week state — see file-level docstring. */
export function SchedulingAvailability(
  props: SchedulingAvailabilityProps,
): JSX.Element {
  const { lineupId, matchId, slots, readOnly, onPrefill } = props;
  // ROK-1570: the week is declared BEFORE the query because the query is
  // scoped to it — the aggregate subtracts commitments for this exact week.
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()));
  const { data, isLoading } = useMatchAvailability(lineupId, matchId, weekStart);
  const [picked, setPicked] = useState<WeekCellRef | null>(null);
  const slotMarks = useMemo(() => slotMarksForWeek(slots, weekStart), [slots, weekStart]);
  const isDesktop = useMediaQuery(DESKTOP_MQ);

  const handleWeekChange = (delta: number): void => {
    const next = new Date(weekStart);
    next.setDate(next.getDate() + delta * 7);
    setWeekStart(next);
    // ROK-1580 (review 2c): the pick belongs to the week it was made in — the
    // form still holds THAT datetime, so a new week starts clean.
    setPicked(null);
  };

  const handlePick = (dayOfWeek: number, hour: number): void => {
    onPrefill(toDatetimeLocal(dayOfWeek, hour, weekStart));
    setPicked({ dayOfWeek, hour });
  };

  const shared = { data, isLoading, readOnly, weekStart, onWeekChange: handleWeekChange, slotMarks };
  if (isDesktop) {
    return <AvailabilityHeatmapSection {...shared} picked={picked} onPick={handlePick} />;
  }
  return (
    // The sheet gives its body a definite height; this wrapper passes it
    // down so the module's rows stretch instead of scrolling (ROK-1580).
    <div className="isolate flex min-h-0 flex-1 flex-col">
      <PhoneGroupAvailability {...shared} onPickHour={handlePick} suggested={picked} />
    </div>
  );
}
