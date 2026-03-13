/**
 * Shared visibility filter for game queries.
 * Excludes hidden and banned games from results.
 */
import { and, eq } from 'drizzle-orm';
import * as schema from '../drizzle/schema';

/** Visibility filter for game queries (excludes hidden/banned). */
export const VISIBILITY_FILTER = () =>
  and(eq(schema.games.hidden, false), eq(schema.games.banned, false));
