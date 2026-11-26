/**
 * ROK-2352 — the custom id an LFG board button carries, v1 and v2.
 *
 * - v1 `<prefix>:<gameId>` — every button posted before ROK-2352 and every
 *   button on a whole-game (`''`) group. Kept indefinitely: an already-posted
 *   button is the one long-lived old client, so v1 always means `''`.
 * - v2 `<prefix>:<gameId>:<groupKey>` — a keyed group (WoW
 *   `dungeon:<id>` / `raid:<id>`). The key may itself contain colons, so
 *   everything after the game id is the key, checked against the contract's
 *   grammar.
 *
 * The id carries WHICH group, never WHO: identity always comes from the
 * interaction.
 */
import {
  LFG_ANY_GROUP_KEY,
  LFG_GROUP_KEY_PATTERN,
} from '@raid-ledger/contract';

/** `games.id` is an int4; anything larger is noise, not a game. */
const PG_INT4_MAX = 2147483647;

/** What a board button press names. */
export interface LfgBoardButtonRef {
  gameId: number;
  /** `''` for a v1 id or the whole-game group. */
  groupKey: string;
}

/**
 * Build a board button's custom id; `''` (or absent) emits the v1 form.
 *
 * @param prefix - An `LFG_BUTTON_IDS` value.
 * @param gameId - The group's game.
 * @param groupKey - The group's key (`''` = whole game).
 */
export function buildLfgBoardCustomId(
  prefix: string,
  gameId: number,
  groupKey: string = LFG_ANY_GROUP_KEY,
): string {
  const base = `${prefix}:${String(gameId)}`;
  return groupKey === LFG_ANY_GROUP_KEY ? base : `${base}:${groupKey}`;
}

/**
 * Parse a v1 or v2 board button id.
 *
 * @param customId - The interaction's custom id.
 * @param prefix - The `LFG_BUTTON_IDS` value this listener owns.
 * @returns The game + group, or null when the id is not this button's.
 */
export function parseLfgBoardCustomId(
  customId: string,
  prefix: string,
): LfgBoardButtonRef | null {
  if (!customId.startsWith(`${prefix}:`)) return null;
  const match = /^(\d+)(?::(.*))?$/.exec(customId.slice(prefix.length + 1));
  const rawId = match?.[1];
  if (rawId === undefined) return null;
  const gameId = Number(rawId);
  if (!Number.isSafeInteger(gameId) || gameId > PG_INT4_MAX) return null;
  const groupKey = match?.[2];
  if (groupKey === undefined) return { gameId, groupKey: LFG_ANY_GROUP_KEY };
  return LFG_GROUP_KEY_PATTERN.test(groupKey) ? { gameId, groupKey } : null;
}
