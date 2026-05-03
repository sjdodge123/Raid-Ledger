/**
 * Lineup reminder target resolution (ROK-1126).
 *
 * Computes the recipient set for the nominate / vote / schedule reminder
 * crons. Branches on lineup visibility:
 *   - private → invitees ∪ {createdBy} minus users who already participated
 *   - public  → action-specific candidate set minus already-participated
 *
 * For `schedule` action, `matchId` is required and gates the
 * already-participated query against `community_lineup_schedule_votes`.
 */
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

export type ReminderAction = 'nominate' | 'vote' | 'schedule';

interface LineupRow {
  id: number;
  visibility: 'public' | 'private';
  createdBy: number;
}

interface UserRow {
  userId: number;
}

/**
 * Resolve user IDs eligible to receive a reminder for `action` on `lineupId`.
 * Returns dedup'd numeric IDs. Returns `[]` if the lineup row is missing.
 */
export async function resolveLineupReminderTargets(
  db: Db,
  lineupId: number,
  action: ReminderAction,
  matchId?: number,
): Promise<number[]> {
  const [lineup] = (await db.execute(sql`
    SELECT id, visibility, created_by AS "createdBy"
      FROM community_lineups
     WHERE id = ${lineupId}
     LIMIT 1
  `)) as unknown as LineupRow[];
  if (!lineup) return [];

  if (lineup.visibility === 'private') {
    return resolvePrivateTargets(db, lineup, action, matchId);
  }
  return resolvePublicTargets(db, lineup.id, action, matchId);
}

async function resolvePrivateTargets(
  db: Db,
  lineup: LineupRow,
  action: ReminderAction,
  matchId?: number,
): Promise<number[]> {
  const candidates = (await db.execute(sql`
    SELECT u.id AS "userId"
      FROM community_lineup_invitees i
      JOIN users u ON u.id = i.user_id
     WHERE i.lineup_id = ${lineup.id}
       AND u.discord_id IS NOT NULL
  `)) as unknown as UserRow[];
  const participated = await loadParticipatedUserIds(
    db,
    lineup.id,
    action,
    matchId,
  );
  const pool = new Set<number>([
    lineup.createdBy,
    ...candidates.map((r) => r.userId),
  ]);
  for (const id of participated) pool.delete(id);
  return Array.from(pool);
}

async function resolvePublicTargets(
  db: Db,
  lineupId: number,
  action: ReminderAction,
  matchId?: number,
): Promise<number[]> {
  const candidates = await loadPublicCandidates(db, lineupId, action, matchId);
  const participated = await loadParticipatedUserIds(
    db,
    lineupId,
    action,
    matchId,
  );
  const skip = new Set(participated);
  return candidates.filter((id) => !skip.has(id));
}

async function loadPublicCandidates(
  db: Db,
  lineupId: number,
  action: ReminderAction,
  matchId?: number,
): Promise<number[]> {
  if (action === 'nominate') {
    const rows = (await db.execute(sql`
      SELECT id AS "userId"
        FROM users
       WHERE discord_id IS NOT NULL
    `)) as unknown as UserRow[];
    return Array.from(new Set(rows.map((r) => r.userId)));
  }
  if (action === 'vote') {
    const rows = (await db.execute(sql`
      SELECT DISTINCT u.id AS "userId"
        FROM users u
       WHERE u.discord_id IS NOT NULL
         AND (
           u.id IN (
             SELECT nominated_by
               FROM community_lineup_entries
              WHERE lineup_id = ${lineupId}
           )
           OR u.id IN (
             SELECT user_id
               FROM community_lineup_votes
              WHERE lineup_id = ${lineupId}
           )
         )
    `)) as unknown as UserRow[];
    return Array.from(new Set(rows.map((r) => r.userId)));
  }
  // schedule
  const rows = (await db.execute(sql`
    SELECT DISTINCT u.id AS "userId"
      FROM community_lineup_match_members lmm
      JOIN users u ON u.id = lmm.user_id
     WHERE lmm.match_id = ${matchId ?? -1}
       AND u.discord_id IS NOT NULL
  `)) as unknown as UserRow[];
  return Array.from(new Set(rows.map((r) => r.userId)));
}

async function loadParticipatedUserIds(
  db: Db,
  lineupId: number,
  action: ReminderAction,
  matchId?: number,
): Promise<number[]> {
  if (action === 'nominate') {
    const rows = (await db.execute(sql`
      SELECT DISTINCT nominated_by AS "userId"
        FROM community_lineup_entries
       WHERE lineup_id = ${lineupId}
    `)) as unknown as UserRow[];
    return rows.map((r) => r.userId);
  }
  if (action === 'vote') {
    const rows = (await db.execute(sql`
      SELECT DISTINCT user_id AS "userId"
        FROM community_lineup_votes
       WHERE lineup_id = ${lineupId}
    `)) as unknown as UserRow[];
    return rows.map((r) => r.userId);
  }
  // schedule
  const rows = (await db.execute(sql`
    SELECT DISTINCT csv.user_id AS "userId"
      FROM community_lineup_schedule_votes csv
      JOIN community_lineup_schedule_slots css ON css.id = csv.slot_id
     WHERE css.match_id = ${matchId ?? -1}
  `)) as unknown as UserRow[];
  return rows.map((r) => r.userId);
}
