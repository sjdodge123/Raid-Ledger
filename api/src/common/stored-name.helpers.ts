/** Length of the varchar columns a game-server player's names are written to. */
export const STORED_NAME_MAX_LENGTH = 255;

/**
 * Clamp an in-game name to the varchar(255) name columns. Counts code
 * points, as Postgres does, so an astral character is never split. Pure, so
 * the presence tracker and the row writers share one form: a name read back
 * from the roster must equal the live log name it came from.
 */
export function clampStoredName(name: string): string {
  const chars = Array.from(name);
  return chars.length <= STORED_NAME_MAX_LENGTH
    ? name
    : chars.slice(0, STORED_NAME_MAX_LENGTH).join('');
}
