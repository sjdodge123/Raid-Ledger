import type { Guild } from 'discord.js';
import { checkBotPermissions } from '../discord-bot-client.helpers';

/**
 * ROK-1471 D5: the subset of `REQUIRED_PERMISSIONS` the LFG board actually
 * needs. Labels, not flags, so this stays the single place the board's
 * requirement list is written and the preflight can name what is missing.
 *
 * Forum tag management rides on Manage Channels, which is already here.
 *
 * ROK-1493 D9 adds `Manage Roles` — writing the board forum's `@everyone`
 * deny overwrite needs it. It is already in `REQUIRED_PERMISSIONS`, so the
 * invite URL is unchanged and no operator has to re-invite the bot. It is
 * listed FIRST, not appended, because `preflightLfgBoard` filters
 * `checkBotPermissions()` and therefore reports in `REQUIRED_PERMISSIONS`
 * order — where `Manage Roles` is entry one. Keeping the two lists in the
 * same relative order is what lets the "not in a guild" case assert
 * `missing === [...LFG_BOARD_REQUIRED_LABELS]` verbatim.
 */
export const LFG_BOARD_REQUIRED_LABELS: readonly string[] = [
  'Manage Roles',
  'Manage Channels',
  'View Channels',
  'Send Messages',
  'Embed Links',
  'Manage Threads',
  'Create Public Threads',
  'Send Messages in Threads',
];

/** Result of an LFG-board permission preflight. */
export interface LfgBoardPreflightResult {
  ok: boolean;
  missing: string[];
}

/**
 * Check whether the bot can run the LFG forum board in this guild.
 *
 * Advisory, never fatal: the caller persists the toggle either way and shows
 * `missing` as a warning so the operator can fix the install afterwards.
 *
 * @param guild - The guild to check; `null` (bot not connected) fails every check.
 * @returns `ok` plus the labels of the board permissions that are not granted.
 */
export function preflightLfgBoard(
  guild: Guild | null,
): LfgBoardPreflightResult {
  const missing = checkBotPermissions(guild)
    .filter((p) => LFG_BOARD_REQUIRED_LABELS.includes(p.name) && !p.granted)
    .map((p) => p.name);
  return { ok: missing.length === 0, missing };
}
