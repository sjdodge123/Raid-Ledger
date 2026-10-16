/**
 * ROK-1802 — a LINKED game-server player gets the same `event_signups` row
 * and roster slot a voice member gets (`autoSignupParticipant`), so the Quick
 * Play counts toward their attendance and history. An unlinked player (no
 * Raid Ledger user) gets none: a signup belongs to a user.
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { autoSignupParticipant } from './ad-hoc-event.signup-helpers';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Sign `userId` up to `eventId` (idempotent). No-op for an unlinked player,
 * a deactivated user, or one without a Discord id (the signup's key).
 */
export async function signupLinkedServerPlayer(
  db: Db,
  eventId: number,
  userId: number | null,
): Promise<void> {
  if (userId === null) return;
  const u = schema.users;
  const [user] = await db
    .select({ discordId: u.discordId, username: u.username, avatar: u.avatar })
    .from(u)
    .where(and(eq(u.id, userId), isNull(u.deactivatedAt)))
    .limit(1);
  if (!user?.discordId) return;
  await autoSignupParticipant(db, eventId, {
    discordUserId: user.discordId,
    discordUsername: user.username,
    discordAvatarHash: user.avatar,
    userId,
  });
}
