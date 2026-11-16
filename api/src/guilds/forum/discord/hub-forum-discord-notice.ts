/**
 * ROK-2208 OQ-4 (Q10 ruling Q4) — a post in a SHARED forum that carries no
 * hub tag, or more than one, is not synced; the bot replies once in it to say
 * so. `hub_forum_discord_notices` is the "already told" record: the reply is
 * sent only when the `INSERT … ON CONFLICT DO NOTHING RETURNING` claims the
 * row, so repeat messages, reconcile, restarts and races never double-post.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { HubForumDiscordOutboundGateway } from './hub-forum-discord-outbound.discord';
import {
  pickHub,
  predatesBinding,
  type InboundThread,
  type RouteBinding,
} from './hub-forum-discord-route';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

/** The ruled reply copy. */
export const TAG_NOTICE = 'Add one hub tag to sync this post to Raid Ledger.';

/**
 * True when a not-yet-linked post should get the notice: the forum is shared
 * (≥2 bindings), the post's tags pick no single hub, and the post is not
 * older than every binding (R8 — no tag could ever sync it).
 */
export function needsTagNotice(
  bindings: readonly RouteBinding[],
  thread: Pick<InboundThread, 'id' | 'appliedTags'>,
): boolean {
  if (bindings.length < 2) return false;
  if (pickHub(bindings, thread.appliedTags) !== null) return false;
  return bindings.some((b) => !predatesBinding(thread.id, b.boundAt));
}

/** Sends the OQ-4 notice at most once per Discord post. */
@Injectable()
export class HubForumDiscordNotices {
  private readonly logger = new Logger(HubForumDiscordNotices.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: ForumDiscordDb,
    private readonly discord: HubForumDiscordOutboundGateway,
  ) {}

  /**
   * Claim the post's notice row and, if this call claimed it, reply. A failed
   * send releases the row so a later message retries. Never throws.
   */
  async notify(forumId: number, discordThreadId: string): Promise<boolean> {
    const n = schema.hubForumDiscordNotices;
    const claimed = await this.db
      .insert(n)
      .values({ discordThreadId, forumId })
      .onConflictDoNothing()
      .returning({ id: n.discordThreadId });
    if (claimed.length === 0) return false;
    try {
      await this.discord.postNotice(discordThreadId, TAG_NOTICE);
      return true;
    } catch (err) {
      await this.db.delete(n).where(eq(n.discordThreadId, discordThreadId));
      const why = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Tag notice in post ${discordThreadId} failed: ${why}`);
      return false;
    }
  }
}
