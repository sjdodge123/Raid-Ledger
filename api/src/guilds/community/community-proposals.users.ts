import { eq, sql } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import type { DbOrTx } from './community-membership.queries';
import type { DiscordGuildMemberFields } from './discord-guild-member.helpers';

/** ROK-1870 L2b — user reads behind the proposal rules (A2, P9, fan-out). */

const u = schema.users;

/** The fields the proposal rules read off a user. */
export interface ProposalUser extends DiscordGuildMemberFields {
  id: number;
  username: string;
}

/** One user's gate fields, or null when the id is unknown. */
export async function findProposalUser(
  db: DbOrTx,
  userId: number,
): Promise<ProposalUser | null> {
  const [row] = await db
    .select({
      id: u.id,
      username: u.username,
      discordId: u.discordId,
      guildMemberSeenAt: u.guildMemberSeenAt,
      deactivatedAt: u.deactivatedAt,
    })
    .from(u)
    .where(eq(u.id, userId));
  return row ?? null;
}

/** Staff user ids (admin + operator), active accounts only. */
export async function staffUserIds(db: DbOrTx): Promise<number[]> {
  const rows = await db
    .select({ id: u.id })
    .from(u)
    .where(
      sql`${u.role} IN ('admin', 'operator') AND ${u.deactivatedAt} IS NULL`,
    );
  return rows.map((r) => r.id);
}
