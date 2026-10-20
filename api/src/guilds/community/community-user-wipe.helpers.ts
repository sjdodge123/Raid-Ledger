import { and, eq } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import {
  refreshMemberCount,
  type DbOrTx,
} from './community-membership.queries';

/**
 * ROK-1870 review — the community-hub part of a user wipe (ban+wipe and hard
 * delete). Deletes the user's still-`proposed` hubs (else `proposed_by` goes
 * NULL and the row reserves its name, invisible in the queue), deletes their
 * membership rows and recounts `member_count` on every hub they were in.
 */
export async function wipeCommunityHubData(
  tx: DbOrTx,
  userId: number,
): Promise<void> {
  const g = schema.guilds;
  const m = schema.hubCommunityMembers;
  await tx
    .delete(g)
    .where(
      and(
        eq(g.kind, 'game_community'),
        eq(g.status, 'proposed'),
        eq(g.proposedBy, userId),
      ),
    );
  const left = await tx
    .delete(m)
    .where(eq(m.userId, userId))
    .returning({ guildId: m.guildId });
  for (const guildId of new Set(left.map((r) => r.guildId))) {
    await refreshMemberCount(tx, guildId);
  }
}
