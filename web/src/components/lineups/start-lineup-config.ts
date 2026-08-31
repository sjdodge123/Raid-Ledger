/**
 * Non-component config for the StartLineupModal (ROK-1302 / S4).
 *
 * Lives in a plain `.ts` (no JSX exports) so the preset constant and the
 * duration formatter don't trip `react-refresh/only-export-components` in the
 * component files that consume them.
 */

export type PresetKey = 'lan' | 'tonight' | 'thisWeek' | 'series' | 'custom';

/** Canonical settings a preset writes into the form (ROK-1302, operator-spec). */
export interface PresetValues {
  matchThreshold: number;
  votesPerPlayer: number;
  /** Building-phase hours. Sub-hour allowed (LAN = 0.25h = 15 min). */
  buildingDurationHours: number;
  /** Voting-phase hours. Sub-hour allowed. */
  votingDurationHours: number;
}

/**
 * Operator-specified canonical values (interview 2026-05-31; revised ROK-1441):
 * - LAN: group together in one room now, one game, ~30 min total, force
 *   consensus. These are the values "Tonight" carried before ROK-1441.
 * - Tonight: posted during the day, playing the same evening — 5h a phase, so
 *   an 11:00 lineup finishes building at 16:00 and decides by 21:00.
 * - This Week: weekly-event group, high threshold, time to review.
 * - Series: large group planning months ahead, many parallel matches.
 */
export const LINEUP_PRESETS: Record<
  Exclude<PresetKey, 'custom'>,
  PresetValues
> = {
  lan: {
    matchThreshold: 100,
    votesPerPlayer: 3,
    buildingDurationHours: 0.25,
    votingDurationHours: 0.25,
  },
  tonight: {
    matchThreshold: 100,
    votesPerPlayer: 3,
    buildingDurationHours: 5,
    votingDurationHours: 5,
  },
  thisWeek: {
    matchThreshold: 50,
    votesPerPlayer: 3,
    buildingDurationHours: 48,
    votingDurationHours: 24,
  },
  series: {
    matchThreshold: 20,
    votesPerPlayer: 5,
    buildingDurationHours: 96,
    votingDurationHours: 72,
  },
};

/**
 * Human-format a duration given in hours, at minute resolution.
 *
 * The readout must never imply a different deadline than the value the form
 * submits (ROK-1441, Codex review). Two ways that could happen, both now
 * closed:
 *
 *  - The slider is hour-granular, so 36h is reachable by drag. Rounding it to
 *    a day count would read "2 days" — 12 hours late.
 *  - The numeric field takes `step="any"`, so 1.5h is reachable by typing.
 *    Rounding to whole hours would read "2 hours" — 30 minutes late.
 *
 * Whole values keep their natural wording ("15 min", "5 hours", "2 days");
 * anything with a remainder renders compound ("1h 30m", "1d 12h").
 */
export function formatDurationHours(hours: number): string {
  const totalMinutes = Math.round(hours * 60);
  if (totalMinutes < 60) return `${totalMinutes} min`;

  const days = Math.floor(totalMinutes / 1440);
  const restMinutes = totalMinutes % 1440;
  const hrs = Math.floor(restMinutes / 60);
  const mins = restMinutes % 60;

  // Exact-unit cases keep the original, more readable wording.
  if (days === 0 && mins === 0) {
    return `${hrs} ${hrs === 1 ? 'hour' : 'hours'}`;
  }
  if (days > 0 && hrs === 0 && mins === 0) {
    return `${days} ${days === 1 ? 'day' : 'days'}`;
  }

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hrs > 0) parts.push(`${hrs}h`);
  if (mins > 0) parts.push(`${mins}m`);
  return parts.join(' ');
}
