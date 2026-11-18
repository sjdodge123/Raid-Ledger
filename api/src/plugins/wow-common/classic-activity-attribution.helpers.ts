/**
 * ROK-2259 — per-player attribution of "World of Warcraft Classic" play time.
 *
 * Discord reports every Classic-family client (WoW: Forever included) under
 * the single activity name "World of Warcraft Classic", which migration 0091
 * maps globally to TBC Anniversary. Discord gives no way to tell the clients
 * apart, so the operator ruling (2026-11-18) decides per player from their own
 * characters: Forever when they have a Forever character, Anniversary only
 * when their Classic-family characters are Anniversary-only, Forever otherwise.
 */

/** Slug of the WoW: Forever game row. */
export const WOW_FOREVER_SLUG = 'world-of-warcraft-forever';

/** Slug of the TBC Anniversary game row the ambiguous mapping points at. */
export const WOW_ANNIVERSARY_SLUG =
  'world-of-warcraft-burning-crusade-classic-anniversary-edition';

/** The single raw name Discord reports for every Classic-family client. */
export const WOW_CLASSIC_ACTIVITY_NAME = 'World of Warcraft Classic';

/** Exact, case-insensitive match on Discord's ambiguous Classic name. */
export function isAmbiguousClassicName(discordActivityName: string): boolean {
  return (
    discordActivityName.toLowerCase() ===
    WOW_CLASSIC_ACTIVITY_NAME.toLowerCase()
  );
}

/** Character variant the Forever importers stamp. */
const FOREVER_VARIANT = 'wow_forever';

/** The slice of a character row the attribution reads. */
export interface ClassicFamilyCharacter {
  gameId: number;
  gameVariant: string | null;
  ruleset: string | null;
}

/** Resolved ids of the two games Discord cannot tell apart. */
export interface ClassicGameIds {
  foreverId: number;
  anniversaryId: number;
}

/**
 * A Forever character is identified by its variant or its ruleset (ROK-1721),
 * never by the game slug — Forever characters can sit under other WoW games.
 */
export function isForeverCharacter(c: ClassicFamilyCharacter): boolean {
  return c.gameVariant === FOREVER_VARIANT || c.ruleset !== null;
}

/**
 * The game to credit for a session resolved to `gameId`. Only the ambiguous
 * Anniversary target is re-attributed; every other game passes through.
 */
export function attributeClassicPlay(
  gameId: number,
  characters: readonly ClassicFamilyCharacter[],
  ids: ClassicGameIds,
): number {
  if (gameId !== ids.anniversaryId) return gameId;
  if (characters.some(isForeverCharacter)) return ids.foreverId;
  const hasAnniversary = characters.some((c) => c.gameId === ids.anniversaryId);
  return hasAnniversary ? ids.anniversaryId : ids.foreverId;
}
