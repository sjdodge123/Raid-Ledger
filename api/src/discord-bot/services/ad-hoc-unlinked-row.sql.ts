/**
 * ROK-1888 — `isUnlinkedServerRow` as SQL, for counts that run in the DB.
 * Kept beside the TS predicate's rule (`ad-hoc-anonymous-row.helpers.ts`);
 * the two must stay the same three columns.
 */
import { sql } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';

const p = schema.adHocParticipants;

/** A server player tied to no RL user and no Discord account. */
export const UNLINKED_SERVER_ROW_SQL = sql`(${p.discordUserId} IS NULL AND ${p.userId} IS NULL AND ${p.steamId} IS NOT NULL)`;
