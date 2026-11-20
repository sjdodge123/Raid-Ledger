/**
 * ROK-2272 S4a — Discord-only posts for NON-HUB events (`events.guild_id`
 * null, not ad-hoc) in the event-planning forum (§3.1, §3.2). The bot makes
 * the post (§3.9), tags it with the forum's `Event` kind tag only (§3.3) and
 * records it in `event_planning_posts`; nothing syncs back (§3.8). The post
 * closes `WRITE_GRACE_MS` after the event ends, or after it was cancelled
 * (§3.5 R2) — the lock sweep acts on `closes_at`.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import type { EventPlanningPostSelect } from '../../../drizzle/schema/event-planning-posts';
import { getClientUrl } from '../../../settings/settings-bot.helpers';
import { SettingsService } from '../../../settings/settings.service';
import { WRITE_GRACE_MS } from '../event-discussion/event-discussion.sync';
import type { BoundForum } from './event-planning-forum.queries';
import { EventPlanningForumResolver } from './event-planning-forum.resolver';
import { EventPlanningPostsGateway } from './event-planning-posts.discord';
import {
  liveUnlockedEventSubjects,
  planningEventChanged,
  syncEach,
} from './event-planning-posts.reconcile';
import {
  findLivePlanningPost,
  findPlanningEvent,
  hubTagIdsOfForum,
  insertPlanningPost,
  markPlanningPostDeleted,
  setPlanningPostClosesAt,
  type InsertPlanningPostResult,
  type NewPlanningPost,
  type PlanningEventSource,
} from './event-planning-posts.queries';
import {
  EVENT_TAG_NAME,
  findKindTagId,
  planTagCreates,
} from './hub-forum-discord-decor';
import { eventPostTitle } from './hub-forum-discord-event-outbound';
import {
  HubForumDiscordGateway,
  type ForumInfo,
} from './hub-forum-discord.gateway';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

/** A live Discord-only post. */
export interface EventPlanningPostRef {
  postId: number;
  forumId: number;
  discordThreadId: string;
}

const ABSOLUTE = /^https?:\/\//i;

function toRef(row: EventPlanningPostSelect): EventPlanningPostRef {
  return {
    postId: row.id,
    forumId: row.forumId,
    discordThreadId: row.discordThreadId,
  };
}

/** §3.5: end (or cancel, R2) + `WRITE_GRACE_MS`. */
export function planningEventClosesAt(ev: PlanningEventSource): Date {
  const from = ev.cancelledAt ?? ev.end;
  return new Date(from.getTime() + WRITE_GRACE_MS);
}

/** §3.1: a non-hub, scheduled, live event whose post would still be open. */
export function planningEventEligible(
  ev: PlanningEventSource,
  now: Date,
): boolean {
  if (ev.guildId !== null || ev.isAdHoc || ev.cancelledAt !== null) {
    return false;
  }
  return planningEventClosesAt(ev) > now;
}

/**
 * The starter message: a short line + the event page. A Discord-only post
 * has no Raid Ledger thread, so it never links to one.
 */
export function planningEventBody(clientUrl: string, eventId: number): string {
  const line = 'Plan this event here.';
  if (!ABSOLUTE.test(clientUrl)) return line;
  const base = clientUrl.replace(/\/+$/, '');
  return `${line}\nEvent page: ${base}/events/${eventId}`;
}

@Injectable()
export class EventPlanningPostsService {
  private readonly logger = new Logger(EventPlanningPostsService.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: ForumDiscordDb,
    private readonly settings: SettingsService,
    private readonly resolver: EventPlanningForumResolver,
    private readonly forums: HubForumDiscordGateway,
    private readonly discord: EventPlanningPostsGateway,
  ) {}

  /** The event's live post, created on first need; null when it gets none. */
  async ensureEventPost(eventId: number): Promise<EventPlanningPostRef | null> {
    const live = await findLivePlanningPost(this.db, 'event', eventId);
    if (live) return toRef(live);
    const ev = await findPlanningEvent(this.db, eventId);
    if (!ev || !planningEventEligible(ev, new Date())) return null;
    const forum = await this.forum();
    if (!forum) return null;
    const tagIds = await this.eventTagIds(forum);
    if (!tagIds) return null;
    const threadId = await this.discord.createPost(forum.channelId, {
      title: await this.title(ev),
      content: planningEventBody(await getClientUrl(this.settings), eventId),
      tagIds,
    });
    return this.record(eventId, forum.forumId, threadId, ev);
  }

  /** Re-derive an EXISTING post's title and `closes_at` (never creates). */
  async syncEvent(eventId: number): Promise<void> {
    const post = await findLivePlanningPost(this.db, 'event', eventId);
    if (!post) return;
    const ev = await findPlanningEvent(this.db, eventId);
    if (!ev) return this.closeNow(post);
    // Became hub-tagged (the hub's post takes over) or ad-hoc: due now, so
    // the sweep locks + archives this one (review MINOR-4).
    if (ev.guildId !== null || ev.isAdHoc) return this.closeNow(post);
    const closesAt = planningEventClosesAt(ev);
    if (post.closesAt?.getTime() !== closesAt.getTime()) {
      await setPlanningPostClosesAt(this.db, post.id, closesAt);
    }
    if (post.discordLockedAt === null) await this.retitle(post, ev);
  }

  /**
   * Codex P2-2: on (re)connect, replay retitles skipped while offline for
   * every live, unlocked event post after `afterId` (bounded). One failing
   * post is logged and the rest go on; returns how many synced.
   */
  async resyncLiveEventPosts(afterId = 0): Promise<number> {
    const ids = await liveUnlockedEventSubjects(this.db, afterId);
    return syncEach(
      ids,
      (id) => this.syncEvent(id),
      (id, err) => this.warn(`resync of event ${id}`, err),
    );
  }

  /** The event row is gone: due now, so the sweep closes the post. */
  async closeForDeletedEvent(eventId: number): Promise<void> {
    const post = await findLivePlanningPost(this.db, 'event', eventId);
    if (post) await this.closeNow(post);
  }

  private async closeNow(post: EventPlanningPostSelect): Promise<void> {
    const now = new Date();
    if (post.closesAt !== null && post.closesAt <= now) return;
    await setPlanningPostClosesAt(this.db, post.id, now);
  }

  private async retitle(
    post: EventPlanningPostSelect,
    ev: PlanningEventSource,
  ): Promise<void> {
    if (!this.discord.isOnline()) return;
    const name = await this.title(ev);
    const res = await this.discord.renameThread(post.discordThreadId, name);
    if (res === 'gone') {
      await markPlanningPostDeleted(this.db, post.id, new Date());
    }
  }

  private async title(ev: PlanningEventSource): Promise<string> {
    const zone = await this.settings.getDefaultTimezone();
    return eventPostTitle(ev.title, ev.start, zone);
  }

  /** The resolved forum; null when offline or none resolves. */
  private async forum(): Promise<BoundForum | null> {
    const guild = this.forums.guildId();
    if (guild === null || !this.discord.isOnline()) return null;
    return (await this.resolver.resolve(guild)).forum;
  }

  /**
   * [Event tag id] — created on demand like decor does. No usable tag
   * (20-tag cap, or a hub owns the name): untagged, unless the forum
   * requires tags — then null (no post; Discord would refuse it).
   */
  private async eventTagIds(forum: BoundForum): Promise<string[] | null> {
    const info = await this.forums.fetchForum(forum.channelId);
    if (!info) return null;
    const hubTags = await hubTagIdsOfForum(this.db, forum.forumId);
    const id =
      findKindTagId(info.tags, EVENT_TAG_NAME, hubTags) ??
      (await this.createEventTag(info, hubTags));
    if (id !== null) return [id];
    this.logger.warn(`Forum ${info.id} has no usable ${EVENT_TAG_NAME} tag`);
    return info.requireTag ? null : [];
  }

  private async createEventTag(
    info: ForumInfo,
    hubTags: readonly (string | null)[],
  ): Promise<string | null> {
    const plan = planTagCreates(info.tags, [EVENT_TAG_NAME]);
    if (plan.create.length === 0) return null;
    const tags = await this.forums.addTags(info.id, plan.create);
    return findKindTagId(tags, EVENT_TAG_NAME, hubTags);
  }

  /** Record the new post; on a lost race, delete our Discord thread. */
  private async record(
    eventId: number,
    forumId: number,
    discordThreadId: string,
    ev: PlanningEventSource,
  ): Promise<EventPlanningPostRef | null> {
    const res = await this.insertOrDrop({
      subjectKind: 'event',
      subjectId: eventId,
      forumId,
      discordThreadId,
      closesAt: planningEventClosesAt(ev),
    });
    if (res.status === 'ok') {
      await this.reconcileCreated(eventId, ev);
      return toRef(res.row);
    }
    await this.dropThread(discordThreadId);
    if (res.status === 'no-forum') {
      this.resolver.invalidate();
      return null;
    }
    const winner = await findLivePlanningPost(this.db, 'event', eventId);
    return winner ? toRef(winner) : null;
  }

  /**
   * Codex P2-3: the event may have changed (or gone) while the Discord
   * create was in flight, unseen by its lifecycle handler (no row yet).
   * Re-derive once from the CURRENT row; a failure is logged, never thrown
   * (the post exists; the next emit or reconnect pass heals it).
   */
  private async reconcileCreated(
    eventId: number,
    snapshot: PlanningEventSource,
  ): Promise<void> {
    try {
      const current = await findPlanningEvent(this.db, eventId);
      if (planningEventChanged(snapshot, current))
        await this.syncEvent(eventId);
    } catch (err) {
      this.warn(`post-create reconcile of event ${eventId}`, err);
    }
  }

  private warn(what: string, err: unknown): void {
    const why = err instanceof Error ? err.message : String(err);
    this.logger.warn(`Planning post ${what} failed: ${why}`);
  }

  /**
   * Review MINOR-2: an untagged insert failure (connection drop, timeout)
   * after the Discord create would orphan the thread — and every retry
   * would make another. Drop it, then rethrow.
   */
  private async insertOrDrop(
    post: NewPlanningPost,
  ): Promise<InsertPlanningPostResult> {
    try {
      return await insertPlanningPost(this.db, post);
    } catch (err) {
      await this.dropThread(post.discordThreadId);
      throw err;
    }
  }

  /** Best effort: a failed cleanup is logged, never thrown. */
  private async dropThread(discordThreadId: string): Promise<void> {
    try {
      await this.discord.deleteThread(discordThreadId);
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Orphan post ${discordThreadId} not deleted: ${why}`);
    }
  }
}
