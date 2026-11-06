/**
 * Realmless WoW: Forever character slug (ROK-2102, step 3).
 *
 * Forever characters are addressed by name alone:
 * `/profile/wow/character/{first}-{second}` under `profile-{prefix}-{region}`.
 * Pure on purpose: no Nest imports and no `blizzard.constants.ts` import.
 */

/**
 * The stored-name rule, mirrored from the contract's `WowForeverNameSchema`
 * (outer whitespace trimmed, exactly one space, 2–24 letters per part).
 * Hyphens, apostrophes and digits are rejected there, so no escaping rule
 * exists for them here; revisit if Blizzard ever allows them.
 */
const FOREVER_NAME_PATTERN = /^(\p{L}{2,24}) (\p{L}{2,24})$/u;

/**
 * Build the realmless character path segment for a stored Forever name.
 * Lowercases with `String.prototype.toLowerCase()` (not locale-aware, same as
 * the realm route) and percent-encodes the result with `encodeURIComponent`
 * so user input can never steer the app-credentialed request (tech-debt 2904).
 * Non-ASCII letters become UTF-8 percent-encoded bytes (retail's convention).
 * @param fullName - The stored "First Second" name.
 * @returns The encoded slug, e.g. `ana-forever`.
 * @throws Error('Not a two-part Forever name') when the name breaks the rule.
 */
export function buildForeverCharacterSlug(fullName: string): string {
  const match = FOREVER_NAME_PATTERN.exec(fullName.trim());
  const first = match?.[1];
  const second = match?.[2];
  if (first === undefined || second === undefined) {
    throw new Error('Not a two-part Forever name');
  }
  return encodeURIComponent(`${first}-${second}`.toLowerCase());
}
