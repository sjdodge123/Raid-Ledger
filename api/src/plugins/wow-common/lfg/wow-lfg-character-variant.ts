/**
 * ROK-2352 §3.3 — whether a character belongs to the variant of the WoW game
 * a hand is on. Forever = `gameVariant` OR a non-null `ruleset`
 * (`isForeverCharacter`, the API's shared rule); a row with neither on the
 * Forever game still counts as Forever (the game slug is the last word,
 * mirroring web `resolveWowVariant`). Pure: no DI, no DB.
 */
import {
  isForeverCharacter,
  WOW_FOREVER_SLUG,
} from '../classic-activity-attribution.helpers';

/** The character fields the variant rule reads. */
export interface WowLfgCharacterVariantSource {
  gameVariant: string | null;
  ruleset: string | null;
}

/**
 * True when the character fits the game: a Forever character only on the
 * Forever game, and the Forever game only takes Forever (or unstamped) rows.
 *
 * @param c - The character's `gameVariant` + `ruleset`.
 * @param gameSlug - The hand's game slug.
 */
export function wowCharacterFitsSlug(
  c: WowLfgCharacterVariantSource,
  gameSlug: string,
): boolean {
  const forever = isForeverCharacter({ gameId: 0, ...c });
  if (gameSlug !== WOW_FOREVER_SLUG) return !forever;
  return forever || c.gameVariant === null;
}
