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
import {
  EventPlanningPostCreator,
  toPlanningPostRef,
  type EventPlanningPostRef,
} from './event-planning-posts.create';
import { EventPlanningPostsGateway } from './event-planning-posts.discord';
import {
  liveUnlockedEventSubjects,
  planningEventChanged,
  syncEach,
} from './event-planning-posts.reconcile';
import {
  findLivePlanningPost,
  findPlanningEvent,
  markPlanningPostDeleted,
  setPlanningPostClosesAt,
  type PlanningEventSource,
} from './event-planning-posts.queries';
import { eventPostTitle } from './hub-forum-discord-event-outbound';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

export type { EventPlanningPostRef } from './event-planning-posts.create';

const ABSOLUTE = /^https?:\/\//i;

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
    private readonly discord: EventPlanningPostsGateway,
    private readonly creator: EventPlanningPostCreator,
  ) {}

  /** The event's live post, created on first need; null when it gets none. */
  async ensureEventPost(eventId: number): Promise<EventPlanningPostRef | null> {
    const live = await findLivePlanningPost(this.db, 'event', eventId);
    if (live) return toPlanningPostRef(live);
    const ev = await findPlanningEvent(this.db, eventId);
    if (!ev || !planningEventEligible(ev, new Date())) return null;
    const made = await this.creator.create({
      kind: 'event',
      subjectId: eventId,
      title: await this.title(ev),
      body: planningEventBody(await getClientUrl(this.settings), eventId),
      closesAt: planningEventClosesAt(ev),
    });
    // Codex P2-3: re-derive once if the event moved while the create ran.
    if (made?.created) await this.reconcileCreated(eventId, ev);
    return made?.ref ?? null;
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
}
