import { ActivityType } from 'discord.js';

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

/** The slice of a discord.js activity the presence helpers read. */
export interface PresenceActivityLike {
  readonly type: ActivityType;
  readonly name: string;
}

/**
 * Names of the "Playing" activities that are games, in presence order —
 * launchers (CurseForge, Battle.net, ...) are dropped (ROK-2204). The one
 * shared filter for the detector, the activity listener and the voice-monitor
 * presence recheck.
 * @param activities - a presence's activities (missing presence → none)
 */
export function playingGameNames(
  activities: readonly PresenceActivityLike[] | null | undefined,
): string[] {
  return (activities ?? [])
    .filter((a) => a.type === ActivityType.Playing)
    .filter((a) => !isLauncherActivity(a.name))
    .map((a) => a.name);
}

/**
 * First "Playing" game of a presence, skipping launchers, or null (ROK-2204).
 * @param activities - a presence's activities (missing presence → null)
 */
export function firstPlayingGameName(
  activities: readonly PresenceActivityLike[] | null | undefined,
): string | null {
  return playingGameNames(activities)[0] ?? null;
}
