/**
 * ROK-1800 — row-level primitives shared by the voice and game-server
 * participant paths: per-source presence fields, the FOR UPDATE re-read, and
 * folding a Steam row into the same person's voice row.
 *
 * Every write that derives fields from a row's state (open/closed, flags)
 * reads that state under `lockRow` first (Codex r3 P2): an unlocked snapshot
 * can predate a concurrent leave and re-open nothing.
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { characterNameOf } from './ad-hoc-steam-display.helpers';

type Db = PostgresJsDatabase<typeof schema>;
const t = schema.adHocParticipants;

type Row = typeof schema.adHocParticipants.$inferSelect;

/** Which presence source a join or leave comes from. */
export type PresenceSource = 'voice' | 'server';

/**
 * Mark `source` present. A closed row starts a new session NOW — its earlier
 * span is already in `totalDurationSeconds`, so `joinedAt` must move (m10).
 */
export function presenceFields(row: Row, source: PresenceSource) {
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
 * Re-read a row FOR UPDATE (Codex r2/r3 P2). Concurrent joins and leaves for
 * one person serialise here, so each sees the other's committed flags.
 */
export async function lockRow(tx: Db, id: string): Promise<Row | null> {
  const rows = await tx.select().from(t).where(eq(t.id, id)).for('update');
  return rows[0] ?? null;
}

/** The user's row on the event that carries no SteamID yet (voice-born). */
export async function findSteamlessUserRow(
  db: Db,
  eventId: number,
  userId: number,
): Promise<Row | null> {
  const rows = await db
    .select()
    .from(t)
    .where(and(eq(t.eventId, eventId), eq(t.userId, userId), isNull(t.steamId)))
    .orderBy(t.joinedAt)
    .limit(1);
  return rows[0] ?? null;
}

/** Seconds the Steam row contributes when it is folded away. */
function carriedSeconds(user: Row, steam: Row | null, now: Date): number {
  if (!steam) return 0;
  const closed = steam.totalDurationSeconds ?? 0;
  // An open server session survives only if the user row is closed (else
  // the user row's own open session already covers that time).
  if (steam.leftAt !== null || user.leftAt === null) return closed;
  return closed + Math.round((now.getTime() - steam.joinedAt.getTime()) / 1000);
}

/** What the Steam side of a merge brings with it. */
export interface SteamMergeInput {
  steamId: string;
  pelicanServerId?: number;
  /** Character name, else the SteamID64 (ROK-1822: kept in `character_name`). */
  displayName?: string;
}

/**
 * Attach `member`'s SteamID to the user's voice row, under row locks. When a
 * separate Steam row already exists (the player was on the server unlinked,
 * then linked — Codex r3 P2), it is folded in and deleted: one row per person.
 *
 * @returns False when the user row is gone or already carries a SteamID.
 */
export async function mergeSteamIntoUserRow(
  db: Db,
  userRowId: string,
  steamRowId: string | null,
  member: SteamMergeInput,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const user = await lockRow(tx, userRowId);
    if (!user || user.steamId !== null) return false;
    const steam = steamRowId ? await lockRow(tx, steamRowId) : null;
    if (steam) await tx.delete(t).where(eq(t.id, steam.id));
    const carried = carriedSeconds(user, steam, new Date());
    await tx
      .update(t)
      .set({
        steamId: member.steamId,
        pelicanServerId: member.pelicanServerId ?? null,
        ...mergedCharacterName(member, steam),
        ...(carried > 0
          ? { totalDurationSeconds: (user.totalDurationSeconds ?? 0) + carried }
          : {}),
        ...presenceFields(user, 'server'),
      })
      .where(eq(t.id, user.id));
    return true;
  });
}

/** ROK-1822: the merging player's character name, else the folded row's. */
function mergedCharacterName(
  member: SteamMergeInput,
  steam: Row | null,
): { characterName?: string } {
  const { steamId, displayName } = member;
  const named =
    displayName === undefined
      ? null
      : characterNameOf({ steamId, displayName });
  const name = named ?? steam?.characterName ?? null;
  return name === null ? {} : { characterName: name };
}
