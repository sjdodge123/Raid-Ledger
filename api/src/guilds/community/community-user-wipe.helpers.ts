import { and, eq, isNull } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import {
  lockHubRows,
  refreshMemberCount,
  type DbOrTx,
} from './community-membership.queries';
import { revokeUserInvites } from './invites/hub-invites.queries';

/** Every hub the wipe will touch: proposed by, invited to, or member of. */
async function hubsTouchedBy(tx: DbOrTx, userId: number): Promise<number[]> {
  const g = schema.guilds;
  const i = schema.hubInvites;
  const m = schema.hubCommunityMembers;
  const proposed = await tx
    .select({ id: g.id })
    .from(g)
    .where(
      and(
        eq(g.kind, 'game_community'),
        eq(g.status, 'proposed'),
        eq(g.proposedBy, userId),
      ),
    );
  const invited = await tx
    .select({ id: i.guildId })
    .from(i)
    .where(and(eq(i.createdBy, userId), isNull(i.revokedAt)));
  const member = await tx
    .select({ id: m.guildId })
    .from(m)
    .where(eq(m.userId, userId));
  return [...proposed, ...invited, ...member].map((r) => r.id);
}

/**
 * ROK-1870 review — the community-hub part of a user wipe (ban+wipe and hard
 * delete). Revokes every invite link they made (ROK-1893 — a SET NULL maker
 * would otherwise leave the link open), deletes the user's still-`proposed` hubs (else `proposed_by` goes
 * NULL and the row reserves its name, invisible in the queue), deletes their
 * membership rows and recounts `member_count` on every hub they were in.
 *
 * Lock order (see `lockHubRows`): every hub row the wipe touches is locked
 * first, by id, BEFORE the invite revoke — the same hub → invite order as
 * redeem / ban / leave / remove, so a wipe cannot deadlock against them.
 */
export async function wipeCommunityHubData(
  tx: DbOrTx,
  userId: number,
): Promise<void> {
  const g = schema.guilds;
  const m = schema.hubCommunityMembers;
  await lockHubRows(tx, await hubsTouchedBy(tx, userId));
  await tx
    .delete(g)
    .where(
      and(
        eq(g.kind, 'game_community'),
        eq(g.status, 'proposed'),
        eq(g.proposedBy, userId),
      ),
    );
  await revokeUserInvites(tx, userId);
  const left = await tx
    .delete(m)
    .where(eq(m.userId, userId))
    .returning({ guildId: m.guildId });
  for (const guildId of new Set(left.map((r) => r.guildId))) {
    await refreshMemberCount(tx, guildId);
  }
}
