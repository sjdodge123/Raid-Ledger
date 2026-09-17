/**
 * Availability/week helpers for the ROK-1300 Scheduling composite heatmap.
 *
 * Lifted verbatim from the legacy `scheduling-poll-page.tsx` so the heatmap
 * (and its cell-click → suggest-form prefill) can live inside the composite.
 */
import { cellTimeLabel } from '../../features/game-time/slot-marks.utils';

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

/** "Suggest Wed 9 PM" for a valid datetime-local value, else "Suggest". */
export function suggestButtonLabel(value: string): string {
  const at = value ? new Date(value) : null;
  if (!at || Number.isNaN(at.getTime())) return 'Suggest';
  return `Suggest ${cellTimeLabel(getWeekStart(at), at.getDay(), at.getHours())}`;
}
