/**
 * Availability/week helpers for the ROK-1300 Scheduling composite heatmap.
 *
 * Lifted verbatim from the legacy `scheduling-poll-page.tsx` so the heatmap
 * (and its cell-click → suggest-form prefill) can live inside the composite.
 */
import type { SchedulePollPageResponseDto } from '@raid-ledger/contract';
import type { GameTimePreviewBlock } from '../../features/game-time/game-time-grid.types';

/** Convert a dayOfWeek (0=Sun) + hour to a datetime-local in the given week. */
export function toDatetimeLocal(
  dayOfWeek: number,
  hour: number,
  weekStart: Date,
): string {
  const target = new Date(weekStart);
  target.setDate(target.getDate() + dayOfWeek);
  target.setHours(hour, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(
    target.getDate(),
  )}T${pad(hour)}:00`;
}

/** Get the Sunday that starts the week containing the given date. */
export function getWeekStart(date: Date): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Serialise a rendered week for the `?weekStart=` availability query (ROK-1570).
 *
 * The grid's `weekStart` is LOCAL Sunday 00:00. The server normalises whatever
 * instant it receives to Sunday 00:00 **UTC** of that instant's UTC week, so
 * sending `weekStart.toISOString()` from any zone east of UTC (local Sunday
 * 00:00 = Saturday evening Z) would ask for the PREVIOUS week while the grid
 * paints this one. Send the calendar date at 00:00Z instead.
 */
export function weekStartQueryValue(weekStart: Date): string {
  return new Date(
    Date.UTC(
      weekStart.getFullYear(),
      weekStart.getMonth(),
      weekStart.getDate(),
    ),
  ).toISOString();
}

/** Convert suggested slots into preview blocks for the grid, filtered to week. */
export function slotsToPreviewBlocks(
  slots: SchedulePollPageResponseDto['slots'],
  weekStart: Date,
): GameTimePreviewBlock[] {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  return slots
    .filter((slot) => {
      const d = new Date(slot.proposedTime);
      return d >= weekStart && d < weekEnd;
    })
    .map((slot) => {
      const d = new Date(slot.proposedTime);
      const voteLabel =
        slot.votes.length === 1 ? '1 vote' : `${slot.votes.length} votes`;
      return {
        dayOfWeek: d.getDay(),
        startHour: d.getHours(),
        endHour: d.getHours() + 2,
        title: voteLabel,
        label: voteLabel,
        variant: 'current' as const,
      };
    });
}
