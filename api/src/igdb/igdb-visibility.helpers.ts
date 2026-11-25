/**
 * Shared visibility filter for game queries.
 * Excludes hidden and banned games from results.
 */
import { and, eq } from 'drizzle-orm';
import * as schema from '../drizzle/schema';

/** Visibility filter for game queries (excludes hidden/banned). */
export const VISIBILITY_FILTER = () =>
  and(eq(schema.games.hidden, false), eq(schema.games.banned, false));

/**
 * The same rule as {@link VISIBILITY_FILTER}, for a games row already in hand:
 * true unless an admin hid or banned the game.
 */
export const isVisibleGame = (game: {
  hidden: boolean;
  banned: boolean;
}): boolean => !game.hidden && !game.banned;
