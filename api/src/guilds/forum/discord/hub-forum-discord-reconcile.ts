/**
 * ROK-2208 §5.6 — catch up after downtime. On CONNECTED: (1) per bound forum,
 * walk the ACTIVE posts and replay each post's messages after its newest
 * linked snowflake (≤ MAX_BACKFILL_MESSAGES) through the inbound ingest, so
 * unknown posts created after `bound_at` import and old ones stay out (R8);
 * (2) run the outbound retry sweep. The 5-minute Core cron
 * (`HubForumDiscordSync_retrySweep`) runs (2) on its own.
 *
 * Accepted gaps (spec §5.6): archived posts are not walked, and a message or
 * post DELETED on Discord while the bot was offline is never detected — the
 * gateway only replays what still exists.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { eq } from 'drizzle-orm';
import { DISCORD_BOT_EVENTS } from '../../../discord-bot/discord-bot.constants';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import {
  HubForumDiscordInboundIngest,
  type InboundResult,
} from './hub-forum-discord-inbound.ingest';
import * as links from './hub-forum-discord-links.queries';
import { HubForumDiscordOutboundService } from './hub-forum-discord-outbound.service';
import { HubForumDiscordReconcileGateway } from './hub-forum-discord-reconcile.discord';
import { snowflakeTime, type InboundThread } from './hub-forum-discord-route';
import {
  MAX_BACKFILL_MESSAGES,
  RETRY_MAX_ATTEMPTS,
  isRetryDue,
  replayAfter,
  retryOp,
} from './hub-forum-discord-sync-rules';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

/** What one post's replay did (the spec reads it). */
export type ReplayCounts = Record<InboundResult, number>;

const describe = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/** Every Discord forum channel at least one hub binds. */
async function boundChannelIds(db: ForumDiscordDb): Promise<string[]> {
  const f = schema.hubForumDiscordForums;
  const b = schema.hubForumDiscordBindings;
  const rows = await db
    .selectDistinct({ channelId: f.channelId })
    .from(f)
    .innerJoin(b, eq(b.forumId, f.id));
  return rows.map((r) => r.channelId);
}

/** Reconnect reconcile + outbound retry sweep (Core, §10). */
@Injectable()
export class HubForumDiscordReconcileService {
  private readonly logger = new Logger(HubForumDiscordReconcileService.name);
  private sweeping = false;
  /** Clock seam for specs. */
  now: () => Date = () => new Date();

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: ForumDiscordDb,
    private readonly gateway: HubForumDiscordReconcileGateway,
    private readonly ingest: HubForumDiscordInboundIngest,
    private readonly outbound: HubForumDiscordOutboundService,
  ) {}

  /** §5.6: on every (re)connect, catch up inbound, then retry outbound. */
  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED, { async: true })
  async onConnected(): Promise<void> {
    try {
      await this.reconcileAll();
      await this.retrySweep();
    } catch (err) {
      this.logger.error(`Forum reconcile failed: ${describe(err)}`);
    }
  }

  /** Replay every active post of every bound forum. */
  async reconcileAll(): Promise<void> {
    for (const channelId of await boundChannelIds(this.db)) {
      for (const thread of await this.gateway.activeThreads(channelId)) {
        await this.replayThread(thread);
      }
    }
  }

  /**
   * One post: messages after the newest linked snowflake, oldest first. An
   * unlinked post whose first message does not import (pre-`bound_at`,
   * untagged, an echo) is abandoned rather than walked message by message.
   */
  async replayThread(thread: InboundThread): Promise<ReplayCounts> {
    const counts: ReplayCounts = {
      imported: 0,
      updated: 0,
      deleted: 0,
      skipped: 0,
    };
    const linked = await links.linkedMessageIds(this.db, thread.id);
    const after = replayAfter(thread.id, linked);
    const messages = await this.gateway.messagesAfter(
      thread.id,
      after,
      MAX_BACKFILL_MESSAGES,
    );
    const ctx = { botUserId: this.gateway.botUserId() };
    for (const m of messages) {
      const at = snowflakeTime(m.id);
      const result = await this.ingest.onCreate(m, thread, ctx, at);
      counts[result] += 1;
      if (linked.length === 0 && counts.imported === 0) break;
    }
    return counts;
  }

  /**
   * §5.6 outbound retry: RL-origin links still pending/failed under the
   * attempts cap, once their backoff is due. Returns how many it re-drove.
   */
  async retrySweep(): Promise<number> {
    if (this.sweeping) return 0;
    this.sweeping = true;
    try {
      const now = this.now();
      const queue = await links.retryableLinks(this.db, RETRY_MAX_ATTEMPTS);
      const due = queue.filter((link) => isRetryDue(link, now));
      for (const link of due) await this.retryOne(link);
      return due.length;
    } finally {
      this.sweeping = false;
    }
  }

  /** Placeholder ids are re-sent (never edited); errors never stop the sweep. */
  private async retryOne(link: links.ForumLink): Promise<void> {
    try {
      const op = retryOp(link, await links.rlRowDeleted(this.db, link));
      if (op === null) {
        await links.markSynced(this.db, link.id, this.now());
        return;
      }
      await this.outbound.retry(link, op);
    } catch (err) {
      this.logger.warn(`Forum retry link ${link.id}: ${describe(err)}`);
    }
  }
}
