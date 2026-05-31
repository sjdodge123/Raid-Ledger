/**
 * Non-component config for the StartLineupModal (ROK-1302 / S4).
 *
 * Lives in a plain `.ts` (no JSX exports) so the preset constant and the
 * duration formatter don't trip `react-refresh/only-export-components` in the
 * component files that consume them.
 */

export type PresetKey = 'tonight' | 'thisWeek' | 'series' | 'custom';

/** Canonical settings a preset writes into the form (ROK-1302, operator-spec). */
export interface PresetValues {
  matchThreshold: number;
  votesPerPlayer: number;
  /** Building-phase hours. Sub-hour allowed (Tonight = 0.25h = 15 min). */
  buildingDurationHours: number;
  /** Voting-phase hours. Sub-hour allowed. */
  votingDurationHours: number;
}

/**
 * Operator-specified canonical values (interview 2026-05-31):
 * - Tonight: group together now, one game, ~30 min total, force consensus.
 * - This Week: weekly-event group, high threshold, time to review.
 * - Series: large group planning months ahead, many parallel matches.
 */
export const LINEUP_PRESETS: Record<
  Exclude<PresetKey, 'custom'>,
  PresetValues
> = {
  tonight: {
    matchThreshold: 100,
    votesPerPlayer: 3,
    buildingDurationHours: 0.25,
    votingDurationHours: 0.25,
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
 * shown honestly (ROK-1302) so a preset like "Tonight" (0.25h) reads
 * "15 min" instead of being rounded up to "1 day".
 */
export function formatDurationHours(hours: number): string {
  if (hours < 1) {
    const mins = Math.round(hours * 60);
    return `${mins} min`;
  }
  if (hours < 24) {
    return `${Math.round(hours)} ${Math.round(hours) === 1 ? 'hour' : 'hours'}`;
  }
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}
