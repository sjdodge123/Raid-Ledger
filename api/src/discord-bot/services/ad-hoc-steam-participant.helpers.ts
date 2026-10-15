/**
 * ROK-1800 — game-server (Steam) participants on an ad-hoc event.
 *
 * Identity rules (operator ruling, ROK-1798 Q4):
 * - A Steam row is keyed on `(event_id, steam_id)` (partial unique index).
 * - A server player resolved to an RL user who already has a row on the event
 *   (e.g. they are in voice) is ONE participant: `steam_id` is set on that row
 *   instead of inserting a second one. The dedupe key is `user_id` when known.
 * - The reverse (server first, voice second) is {@link attachDiscordToUserRow}.
 *
 * Functions take the db handle so the service stays a thin emitter.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;
const t = schema.adHocParticipants;

export type AdHocParticipantRow = typeof schema.adHocParticipants.$inferSelect;

/** A player seen on a game server (ROK-1800). */
export interface ServerPresenceMemberInfo {
  /** SteamID64. */
  steamId: string;
  /** In-game character name when known, else the SteamID64. */
  displayName: string;
  /** RL user resolved from the SteamID (linked account), else null. */
  userId: number | null;
}

/** Discord identity of a voice member, as the voice path supplies it. */
export interface DiscordIdentity {
  discordUserId: string;
  discordUsername: string;
  discordAvatarHash: string | null;
  userId: number | null;
}

/**
 * - `inserted`: a new Steam-only row (a genuinely new participation).
 * - `rejoined`: the Steam row already existed and was re-opened/refreshed.
 * - `merged`: `steam_id` was attached to the user's existing row.
 */
export type SteamUpsertOutcome = 'inserted' | 'rejoined' | 'merged';

/** The user's existing row on the event, if any (oldest first). */
export async function findParticipantForUser(
  db: Db,
  eventId: number,
  userId: number,
): Promise<AdHocParticipantRow | null> {
  const rows = await db
    .select()
    .from(t)
    .where(and(eq(t.eventId, eventId), eq(t.userId, userId)))
    .orderBy(t.joinedAt)
    .limit(1);
  return rows[0] ?? null;
}

/** The row already carrying this SteamID on the event, if any. */
export async function findParticipantBySteamId(
  db: Db,
  eventId: number,
  steamId: string,
): Promise<AdHocParticipantRow | null> {
  const rows = await db
    .select()
    .from(t)
    .where(and(eq(t.eventId, eventId), eq(t.steamId, steamId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Re-open a closed row (a new session), or leave an open one as is. */
function reopenFields(row: AdHocParticipantRow) {
  return row.leftAt === null
    ? {}
    : { leftAt: null, sessionCount: row.sessionCount + 1 };
}

/**
 * Record a game-server player on an ad-hoc event.
 *
 * Order matters: a row already carrying the SteamID wins (no second row can
 * violate the partial unique), then the linked user's row is merged into,
 * and only then is a Steam-only row inserted.
 */
export async function upsertSteamParticipant(
  db: Db,
  eventId: number,
  member: ServerPresenceMemberInfo,
): Promise<SteamUpsertOutcome> {
  const bySteam = await findParticipantBySteamId(db, eventId, member.steamId);
  if (!bySteam && member.userId !== null) {
    const userRow = await findParticipantForUser(db, eventId, member.userId);
    if (userRow && userRow.steamId === null) {
      await db
        .update(t)
        .set({ steamId: member.steamId, ...reopenFields(userRow) })
        .where(eq(t.id, userRow.id));
      return 'merged';
    }
  }
  return insertOrRejoinSteamRow(db, eventId, member);
}

/** Insert the Steam row, or refresh it on `(event_id, steam_id)` conflict. */
async function insertOrRejoinSteamRow(
  db: Db,
  eventId: number,
  member: ServerPresenceMemberInfo,
): Promise<SteamUpsertOutcome> {
  const [row] = await db
    .insert(t)
    .values({
      eventId,
      userId: member.userId,
      discordUserId: null,
      steamId: member.steamId,
      source: 'steam',
      discordUsername: member.displayName,
      discordAvatarHash: null,
      joinedAt: new Date(),
      sessionCount: 1,
    })
    .onConflictDoUpdate({
      target: [t.eventId, t.steamId],
      targetWhere: sql`${t.steamId} IS NOT NULL`,
      set: {
        leftAt: null,
        // A merged row keeps its Discord name; a Steam-only row takes the
        // latest character name.
        discordUsername: sql`CASE WHEN ${t.discordUserId} IS NULL THEN excluded.discord_username ELSE ${t.discordUsername} END`,
        userId: sql`COALESCE(excluded.user_id, ${t.userId})`,
        sessionCount: sql`${t.sessionCount} + 1`,
      },
    })
    .returning({ sessionCount: t.sessionCount });
  return row?.sessionCount === 1 ? 'inserted' : 'rejoined';
}

/**
 * Voice join for a linked user whose only row so far came from the server:
 * attach the Discord identity to that row instead of inserting a second one.
 *
 * Indexed reads (`rows[0]`) rather than destructuring on purpose — it keeps the
 * drizzle chain mock in the voice-path unit spec inert (no row → no merge).
 *
 * @returns True when a Steam row absorbed the Discord identity.
 */
export async function attachDiscordToUserRow(
  db: Db,
  eventId: number,
  member: DiscordIdentity & { userId: number },
): Promise<boolean> {
  const steamRows = await db
    .select()
    .from(t)
    .where(
      and(
        eq(t.eventId, eventId),
        eq(t.userId, member.userId),
        isNull(t.discordUserId),
      ),
    )
    .limit(1);
  const row = steamRows[0];
  if (!row) return false;
  const taken = await db
    .select({ id: t.id })
    .from(t)
    .where(
      and(eq(t.eventId, eventId), eq(t.discordUserId, member.discordUserId)),
    )
    .limit(1);
  if (taken[0]) return false;
  await db
    .update(t)
    .set({
      discordUserId: member.discordUserId,
      discordUsername: member.discordUsername,
      discordAvatarHash: member.discordAvatarHash,
      ...reopenFields(row),
    })
    .where(eq(t.id, row.id));
  return true;
}

/**
 * Close a Steam-only row when the player leaves the server.
 *
 * A merged row (also in voice) is NOT closed here — voice leave owns it, so a
 * player who drops off the server but stays in voice keeps one open row.
 *
 * @returns True when a row was closed.
 */
export async function markSteamLeave(
  db: Db,
  eventId: number,
  steamId: string,
): Promise<boolean> {
  const row = await findParticipantBySteamId(db, eventId, steamId);
  if (!row || row.leftAt !== null || row.discordUserId !== null) return false;
  const now = new Date();
  const session = Math.round((now.getTime() - row.joinedAt.getTime()) / 1000);
  await db
    .update(t)
    .set({
      leftAt: now,
      totalDurationSeconds: (row.totalDurationSeconds ?? 0) + session,
    })
    .where(eq(t.id, row.id));
  return true;
}
