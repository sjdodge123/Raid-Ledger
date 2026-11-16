/**
 * Discord "Playing" activities that are game launchers / mod managers, not
 * games (ROK-2204). Presence detection skips them: they are never matched
 * against the games registry and never logged as an unknown game.
 *
 * Lower-cased; matched against the trimmed, lower-cased activity name with
 * full-string equality only, so a real game that merely contains one of these
 * words is unaffected.
 */
const LAUNCHER_ACTIVITY_NAMES: ReadonlySet<string> = new Set([
  'curseforge',
  'overwolf',
  'battle.net',
  'epic games launcher',
  'ea app',
  'ubisoft connect',
  'gog galaxy',
  'rockstar games launcher',
]);

/**
 * True when a Discord activity name is a known launcher rather than a game.
 * @param activityName - the raw Discord activity name
 */
export function isLauncherActivity(activityName: string): boolean {
  return LAUNCHER_ACTIVITY_NAMES.has(activityName.trim().toLowerCase());
}
