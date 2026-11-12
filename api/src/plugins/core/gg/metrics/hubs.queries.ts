import { eq, sql, type SQL } from 'drizzle-orm';
import type { GgHubsCardSchema } from '@raid-ledger/contract';
import type { z } from 'zod';
import {
  hubCommunityMembers,
  hubMedia,
  hubPosts,
  users,
} from '../../../../drizzle/schema';
import type { GgCardContext, GgCardWindow } from '../gg-card.registry';

export type GgHubsCard = z.infer<typeof GgHubsCardSchema>;

/** `col` (timestamptz) inside `[window.start, window.end)`. */
function inWindow(col: SQL | typeof hubPosts.createdAt, w: GgCardWindow): SQL {
  const from = w.start.toISOString();
  const to = w.end.toISOString();
  return sql`${col} >= ${from}::timestamptz and ${col} < ${to}::timestamptz`;
}

/** One row anchored on the user: hubs joined, posts written, pictures kept. */
export async function loadYearHubs(ctx: GgCardContext): Promise<GgHubsCard> {
  const { userId, window: w } = ctx;
  const [row] = await ctx.db
    .select({
      joined: sql<number>`(select count(*)::int from ${hubCommunityMembers}
        where ${hubCommunityMembers.userId} = ${userId}
          and ${inWindow(sql`${hubCommunityMembers.joinedAt}`, w)})`,
      posts: sql<number>`(select count(*)::int from ${hubPosts}
        where ${hubPosts.authorId} = ${userId}
          and ${inWindow(hubPosts.createdAt, w)})`,
      pictures: sql<number>`(select count(*)::int from ${hubMedia}
        where ${hubMedia.uploadedBy} = ${userId}
          and ${hubMedia.removedAt} is null
          and ${inWindow(sql`${hubMedia.createdAt}`, w)})`,
    })
    .from(users)
    .where(eq(users.id, userId));
  return {
    joined: row?.joined ?? 0,
    posts: row?.posts ?? 0,
    pictures: row?.pictures ?? 0,
  };
}

/** Core card `hubs` (metric 10); omitted when every count is zero. */
export async function produceHubsCard(
  ctx: GgCardContext,
): Promise<GgHubsCard | null> {
  const hubs = await loadYearHubs(ctx);
  return hubs.joined + hubs.posts + hubs.pictures === 0 ? null : hubs;
}
