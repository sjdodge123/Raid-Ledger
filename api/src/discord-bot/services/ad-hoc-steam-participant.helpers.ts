/**
 * ROK-1800 — game-server (Steam) participants on an ad-hoc event.
 *
 * Identity rules (operator ruling, ROK-1798 Q4):
 * - A Steam row is keyed on `(event_id, steam_id)` (partial unique index).
 * - A server player resolved to an RL user who already has a row on the event
 *   (e.g. they are in voice) is ONE participant: `steam_id` is set on that row
 *   instead of inserting a second one. The dedupe key is `user_id` when known.
 * - The reverse (server first, voice second) is {@link attachDiscordToUserRow}.
 * - Presence is tracked PER SOURCE (`in_voice` / `on_server`): a shared row
 *   closes only once the player has left BOTH voice and the server.
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
  /** ROK-1800: the Pelican server the player is on (scopes cleanup). */
  pelicanServerId?: number;
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

/** Which presence source a join or leave comes from. */
export type PresenceSource = 'voice' | 'server';

/**
 * Mark `source` present. A closed row starts a new session NOW — its earlier
 * span is already in `totalDurationSeconds`, so `joinedAt` must move (m10).
 */
function presenceFields(row: AdHocParticipantRow, source: PresenceSource) {
  const flag = source === 'voice' ? { inVoice: true } : { onServer: true };
  if (row.leftAt === null) return flag;
  return {
    leftAt: null,
    joinedAt: new Date(),
    sessionCount: row.sessionCount + 1,
    inVoice: false,
    onServer: false,
    ...flag,
  };
}

/**
 * ON CONFLICT `joined_at`: keep it while the row is open, restart it when a
 * closed row is re-opened (else the next leave re-adds the earlier span).
 */
export function rejoinJoinedAt(now: Date) {
  return sql`CASE WHEN ${t.leftAt} IS NULL THEN ${t.joinedAt} ELSE ${sql.param(now, t.joinedAt)} END`;
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
        .set({
          steamId: member.steamId,
          pelicanServerId: member.pelicanServerId ?? null,
          ...presenceFields(userRow, 'server'),
        })
        .where(eq(t.id, userRow.id));
      return 'merged';
    }
  }
  return insertOrRejoinSteamRow(db, eventId, member);
}

/** On a SteamID conflict: re-open, refresh the name (Steam-only rows), keep the user. */
const steamConflictSet = (now: Date) => ({
  leftAt: null,
  joinedAt: rejoinJoinedAt(now),
  onServer: true,
  pelicanServerId: sql`COALESCE(excluded.pelican_server_id, ${t.pelicanServerId})`,
  // A closed row re-opens from the server alone.
  inVoice: sql`${t.leftAt} IS NULL AND ${t.inVoice}`,
  // A merged row keeps its Discord name; a Steam-only row takes the
  // latest character name.
  discordUsername: sql`CASE WHEN ${t.discordUserId} IS NULL THEN excluded.discord_username ELSE ${t.discordUsername} END`,
  userId: sql`COALESCE(excluded.user_id, ${t.userId})`,
  sessionCount: sql`${t.sessionCount} + 1`,
});

/** Insert the Steam row, or refresh it on `(event_id, steam_id)` conflict. */
async function insertOrRejoinSteamRow(
  db: Db,
  eventId: number,
  member: ServerPresenceMemberInfo,
): Promise<SteamUpsertOutcome> {
  const now = new Date();
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
      joinedAt: now,
      sessionCount: 1,
      inVoice: false,
      onServer: true,
      pelicanServerId: member.pelicanServerId ?? null,
    })
    .onConflictDoUpdate({
      target: [t.eventId, t.steamId],
      targetWhere: sql`${t.steamId} IS NOT NULL`,
      set: steamConflictSet(now),
    })
    .returning({ sessionCount: t.sessionCount });
  return row?.sessionCount === 1 ? 'inserted' : 'rejoined';
}

/** The user's row that has no Discord identity yet (server-born). */
async function findSteamOnlyRowForUser(
  db: Db,
  eventId: number,
  userId: number,
): Promise<AdHocParticipantRow | undefined> {
  const rows = await db
    .select()
    .from(t)
    .where(
      and(
        eq(t.eventId, eventId),
        eq(t.userId, userId),
        isNull(t.discordUserId),
      ),
    )
    .limit(1);
  return rows[0];
}

/** Whether another row on the event already holds this Discord id. */
async function discordIdTaken(
  db: Db,
  eventId: number,
  discordUserId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: t.id })
    .from(t)
    .where(and(eq(t.eventId, eventId), eq(t.discordUserId, discordUserId)))
    .limit(1);
  return rows[0] !== undefined;
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
  const row = await findSteamOnlyRowForUser(db, eventId, member.userId);
  if (!row) return false;
  if (await discordIdTaken(db, eventId, member.discordUserId)) return false;
  await db
    .update(t)
    .set({
      discordUserId: member.discordUserId,
      discordUsername: member.discordUsername,
      discordAvatarHash: member.discordAvatarHash,
      ...presenceFields(row, 'voice'),
    })
    .where(eq(t.id, row.id));
  return true;
}

/** Close a row: accumulate this session and clear both presence flags. */
async function closeRow(
  db: Db,
  row: AdHocParticipantRow,
): Promise<{ session: number; total: number }> {
  const now = new Date();
  const session = Math.round((now.getTime() - row.joinedAt.getTime()) / 1000);
  const total = (row.totalDurationSeconds ?? 0) + session;
  await db
    .update(t)
    .set({
      leftAt: now,
      totalDurationSeconds: total,
      inVoice: false,
      onServer: false,
    })
    .where(eq(t.id, row.id));
  return { session, total };
}

/**
 * One source left. The row closes only when the OTHER source is gone too;
 * otherwise just this source's flag is cleared and the session carries on.
 *
 * @returns The closed session's durations, or null when nothing closed.
 */
async function leaveSource(
  db: Db,
  row: AdHocParticipantRow | null,
  source: PresenceSource,
): Promise<{ session: number; total: number } | null> {
  if (!row || row.leftAt !== null) return null;
  const stillThere = source === 'voice' ? row.onServer : row.inVoice;
  if (!stillThere) return closeRow(db, row);
  const flag = source === 'voice' ? { inVoice: false } : { onServer: false };
  await db.update(t).set(flag).where(eq(t.id, row.id));
  return null;
}

/** The row holding this Discord id on the event, if any. */
async function findParticipantByDiscordId(
  db: Db,
  eventId: number,
  discordUserId: string,
): Promise<AdHocParticipantRow | null> {
  const rows = await db
    .select()
    .from(t)
    .where(and(eq(t.eventId, eventId), eq(t.discordUserId, discordUserId)))
    .limit(1);
  return rows[0] ?? null;
}

/** A voice leave: closes the row unless the player is still on the server. */
export async function markVoiceLeave(
  db: Db,
  eventId: number,
  discordUserId: string,
): Promise<{ session: number; total: number } | null> {
  const row = await findParticipantByDiscordId(db, eventId, discordUserId);
  return leaveSource(db, row, 'voice');
}

/**
 * A server leave: closes the row unless the player is still in voice.
 *
 * @returns True when a row was closed.
 */
export async function markSteamLeave(
  db: Db,
  eventId: number,
  steamId: string,
): Promise<boolean> {
  const row = await findParticipantBySteamId(db, eventId, steamId);
  if (row && !row.onServer) return false;
  return (await leaveSource(db, row, 'server')) !== null;
}
