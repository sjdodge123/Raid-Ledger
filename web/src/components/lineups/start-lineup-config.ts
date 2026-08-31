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
 * Human-format a duration given in hours. Sub-hour and sub-day values are
 * shown honestly (ROK-1302) so a preset like "LAN" (0.25h) reads
 * "15 min" instead of being rounded up to "1 day".
 *
 * ROK-1441: values above 24h that are not whole days render as `1d 12h`
 * rather than rounding to a day count. The slider became hour-granular, so
 * 36h is now reachable by drag; rounding it to "2 days" would show a deadline
 * 12 hours later than the one actually submitted.
 */
export function formatDurationHours(hours: number): string {
  if (hours < 1) {
    const mins = Math.round(hours * 60);
    return `${mins} min`;
  }
  if (hours < 24) {
    return `${Math.round(hours)} ${Math.round(hours) === 1 ? 'hour' : 'hours'}`;
  }
  const whole = Math.round(hours);
  const days = Math.floor(whole / 24);
  const remainder = whole % 24;
  if (remainder === 0) {
    return `${days} ${days === 1 ? 'day' : 'days'}`;
  }
  return `${days}d ${remainder}h`;
}
