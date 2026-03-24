/**
 * Helpers for reading lineup phase duration defaults from settings (ROK-946).
 */
import { SETTING_KEYS } from '../../drizzle/schema/app-settings';
import type { SettingsService } from '../../settings/settings.service';
import { DEFAULT_DURATIONS } from './lineup-phase.constants';

export interface LineupDurationDefaults {
  building: number;
  voting: number;
  decided: number;
}

/** Parse a setting string to an integer, falling back to a default. */
function parseOrDefault(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/** Read lineup phase duration defaults from SettingsService. */
export async function getLineupDurationDefaults(
  settings: SettingsService,
): Promise<LineupDurationDefaults> {
  const [b, v, d] = await Promise.all([
    settings.get(SETTING_KEYS.LINEUP_DEFAULT_BUILDING_HOURS),
    settings.get(SETTING_KEYS.LINEUP_DEFAULT_VOTING_HOURS),
    settings.get(SETTING_KEYS.LINEUP_DEFAULT_DECIDED_HOURS),
  ]);

  return {
    building: parseOrDefault(b, DEFAULT_DURATIONS.building),
    voting: parseOrDefault(v, DEFAULT_DURATIONS.voting),
    decided: parseOrDefault(d, DEFAULT_DURATIONS.decided),
  };
}
