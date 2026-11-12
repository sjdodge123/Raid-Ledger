import { and, asc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { GgHubsCardSchema } from '@raid-ledger/contract';
import type { z } from 'zod';
import {
  games,
  guilds,
  hubCommunityMembers,
  hubMedia,
  hubPosts,
  users,
} from '../../../../drizzle/schema';
import type { GgCardContext, GgCardWindow } from '../gg-card.registry';
import { GG_HUB_BACKDROPS, hubBackdropsOf } from './hubs.helpers';

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

/**
 * https game art of the user's live hubs (oldest membership first) for the
 * card backdrop. Game art, not the player's uploads: hub media bytes sit
 * behind the JWT guard and the snapshot can be shared publicly.
 */
export async function loadHubBackdrops(ctx: GgCardContext): Promise<string[]> {
  const rows = await ctx.db
    .select({ coverUrl: games.coverUrl, screenshots: games.screenshots })
    .from(hubCommunityMembers)
    .innerJoin(guilds, eq(guilds.id, hubCommunityMembers.guildId))
    .innerJoin(games, eq(games.id, guilds.gameId))
    .where(
      and(
        eq(hubCommunityMembers.userId, ctx.userId),
        isNull(hubCommunityMembers.leftAt),
        isNull(hubCommunityMembers.bannedAt),
      ),
    )
    .orderBy(asc(hubCommunityMembers.joinedAt))
    .limit(GG_HUB_BACKDROPS * 2);
  return hubBackdropsOf(rows);
}

/** Core card `hubs` (metric 10); omitted when every count is zero. */
export async function produceHubsCard(
  ctx: GgCardContext,
): Promise<GgHubsCard | null> {
  const hubs = await loadYearHubs(ctx);
  if (hubs.joined + hubs.posts + hubs.pictures === 0) return null;
  const backdropUrls = await loadHubBackdrops(ctx);
  return backdropUrls.length > 0 ? { ...hubs, backdropUrls } : hubs;
}
