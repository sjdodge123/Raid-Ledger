/**
 * ROK-1888 — `isUnlinkedServerRow` as SQL, for counts that run in the DB.
 * Kept beside the TS predicate's rule (`ad-hoc-anonymous-row.helpers.ts`);
 * the two must stay the same three columns.
 */
import { sql } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';

const p = schema.adHocParticipants;

/** A server player (any id kind, ROK-2232) tied to no RL user / Discord. */
export const UNLINKED_SERVER_ROW_SQL = sql`(${p.discordUserId} IS NULL AND ${p.userId} IS NULL AND ${p.playerId} IS NOT NULL)`;
