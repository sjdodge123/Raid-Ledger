/**
 * ROK-2292 §3 (ruling 3) — the starter-card backfill. Posts created before
 * ROK-2292 open with a text starter and have no `discord_event_messages`
 * starter row, so the embed sync never touches them. On every (re)connect
 * this pass turns each open post of an upcoming event into the signup card:
 * it edits the starter through the D4 edit seam (`FORUM_STARTER_EDIT_PORT`,
 * the same path the sync uses) and then records the starter row.
 *
 * Qualifying: a live event post — a registry post (`subject_kind='event'`,
 * not locked/deleted, `closes_at` in the future) or a hub event post link
 * (ours, synced, not locked/deleted, thread still attached) — whose event is
 * not cancelled, not ad-hoc and has not started, and which has NO starter
 * row yet. Idempotent: the "no starter row" filter (plus the row's unique
 * key) makes a second run a no-op; a crash mid-run re-does at most one edit.
 * Paced like `resyncLiveEventPosts`: strictly sequential (discord.js queues
 * per-route rate limits), capped per run. A failure skips that post and the
 * rest go on; never throws. A post that can NEVER be edited — the port says
 * `'gone'` (deleted, or its hub is no longer bound) or a permanent error
 * (`isStarterGoneError`: another author, locked, no access) — is remembered
 * for the process's life and not retried on every reconnect (review NIT; an
 * unlocked archived post is unarchived by the port, not skipped).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CORE_PLUGIN_ID } from '@raid-ledger/contract';
import { and, asc, eq, gt, isNull, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { DISCORD_BOT_EVENTS } from '../../../discord-bot/discord-bot.constants';
import {
  FORUM_STARTER_EDIT_PORT,
  isStarterGoneError,
  type ForumStarterEditPort,
} from '../../../discord-bot/services/event-embed-message.editor';
import { EventForumStarterCards } from '../../../discord-bot/services/event-forum-starter.cards';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

/** Posts edited at most per connect. */
export const STARTER_BACKFILL_CAP = 200;

/** One post whose starter the backfill turns into the card. */
export interface StarterBackfillTarget {
  eventId: number;
  discordThreadId: string;
}

const events = schema.events;
const posts = schema.eventPlanningPosts;
const links = schema.hubForumDiscordLinks;
const threads = schema.hubForumThreads;
const starters = schema.discordEventMessages;

/** No forum starter row (`channel_id = message_id = thread`) for `thread`. */
function noStarterRow(thread: AnyPgColumn): SQL {
  return sql`NOT EXISTS (SELECT 1 FROM ${starters} WHERE ${starters.channelId} = ${thread} AND ${starters.messageId} = ${thread})`;
}

/** The event is still to come, with a card: not cancelled, not ad-hoc. */
function upcomingEvent(afterId: number): SQL | undefined {
  return and(
    gt(events.id, afterId),
    isNull(events.cancelledAt),
    eq(events.isAdHoc, false),
    sql`lower(${events.duration}) > now()`,
  );
}

/** Open registry event posts of upcoming events with no starter row. */
async function registryTargets(
  db: ForumDiscordDb,
  afterId: number,
  limit: number,
): Promise<StarterBackfillTarget[]> {
  return db
    .select({ eventId: events.id, discordThreadId: posts.discordThreadId })
    .from(posts)
    .innerJoin(events, eq(events.id, posts.subjectId))
    .where(
      and(
        eq(posts.subjectKind, 'event'),
        isNull(posts.discordLockedAt),
        isNull(posts.discordDeletedAt),
        sql`${posts.closesAt} > now()`,
        upcomingEvent(afterId),
        noStarterRow(posts.discordThreadId),
      ),
    )
    .orderBy(asc(events.id))
    .limit(limit);
}

/** Open hub event post links (ours, synced) with no starter row. */
async function hubTargets(
  db: ForumDiscordDb,
  afterId: number,
  limit: number,
): Promise<StarterBackfillTarget[]> {
  return db
    .select({ eventId: events.id, discordThreadId: links.discordThreadId })
    .from(links)
    .innerJoin(threads, eq(threads.id, links.threadId))
    .innerJoin(events, eq(events.id, threads.eventId))
    .where(
      and(
        eq(links.kind, 'thread'),
        eq(links.origin, 'raidledger'),
        eq(links.syncState, 'synced'),
        isNull(links.discordLockedAt),
        isNull(links.discordDeletedAt),
        isNull(threads.eventDetachedAt),
        upcomingEvent(afterId),
        noStarterRow(links.discordThreadId),
      ),
    )
    .orderBy(asc(events.id))
    .limit(limit);
}

/** Both kinds, by event id, events after `afterId`, at most `limit`. */
export async function starterBackfillTargets(
  db: ForumDiscordDb,
  afterId = 0,
  limit = STARTER_BACKFILL_CAP,
): Promise<StarterBackfillTarget[]> {
  const [registry, hub] = await Promise.all([
    registryTargets(db, afterId, limit),
    hubTargets(db, afterId, limit),
  ]);
  return [...registry, ...hub]
    .sort((a, b) => a.eventId - b.eventId)
    .slice(0, limit);
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

@Injectable()
export class ForumStarterBackfill {
  /** Hub behaviour — read by the ownership guard's listener scan. */
  readonly hubBehaviour = 'hub-forum.discord-sync';
  readonly hubBehaviourKind = 'ingest-source';
  readonly ownerPluginId = CORE_PLUGIN_ID;
  private readonly logger = new Logger(ForumStarterBackfill.name);
  /** Posts that can never take the card (never persisted: no schema). */
  private readonly unfixable = new Set<string>();

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: ForumDiscordDb,
    private readonly cards: EventForumStarterCards,
    @Inject(FORUM_STARTER_EDIT_PORT)
    private readonly editor: ForumStarterEditPort,
  ) {}

  /** Every (re)connect: one bounded pass. Never throws into the emitter. */
  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED, { async: true })
  async onConnected(): Promise<void> {
    try {
      const edited = await this.run();
      if (edited > 0) this.logger.log(`Starter cards backfilled: ${edited}`);
    } catch (err) {
      this.logger.warn(`Starter card backfill failed: ${describe(err)}`);
    }
  }

  /**
   * Turn each qualifying post after event `afterId` into the card, one at
   * a time; returns how many were edited and recorded.
   */
  async run(afterId = 0): Promise<number> {
    const targets = await starterBackfillTargets(this.db, afterId);
    let edited = 0;
    for (const target of targets) {
      if (this.unfixable.has(target.discordThreadId)) continue;
      if (await this.backfillOne(target)) edited += 1;
    }
    return edited;
  }

  /** Edit one starter to the card, then track it; false when skipped. */
  private async backfillOne(target: StarterBackfillTarget): Promise<boolean> {
    const { eventId, discordThreadId } = target;
    try {
      const card = await this.cards.build(eventId);
      if (!card) return false;
      const { state, ...body } = card;
      const res = await this.editor.editStarter(discordThreadId, body);
      if (res === 'gone') return this.giveUp(discordThreadId);
      await this.cards.record(eventId, discordThreadId, state);
      return true;
    } catch (err) {
      if (isStarterGoneError(err)) this.unfixable.add(discordThreadId);
      this.logger.warn(
        `Starter card backfill skipped post ${discordThreadId} (event ${eventId}): ${describe(err)}`,
      );
      return false;
    }
  }

  private giveUp(discordThreadId: string): false {
    this.unfixable.add(discordThreadId);
    return false;
  }
}
