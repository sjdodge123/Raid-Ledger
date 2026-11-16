/**
 * ROK-2226 §6.1 — the event-scoped discussion routes. The card summary runs
 * the lazy reconciler first (D2), then reports header + count to anyone
 * signed in and the newest replies to readers (ruling 16). The thread and
 * reply routes resolve the event's LIVE thread and delegate to
 * `HubForumService`, whose thread context applies the §6 matrix — so a
 * signed-up non-member reads and writes that thread without the hub guards.
 */
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  EVENT_DISCUSSION_LATEST_MAX,
  type EventDiscussion,
  type HubForumLock,
  type HubForumReply,
  type HubForumThread,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import {
  GuildAccessService,
  type GuildActor,
} from '../../guild-access.service';
import { findGuildKind } from '../../guild-core.queries';
import { assertNotHidden, isHiddenFrom } from '../../hub-hidden.helpers';
import { HubKindRegistry } from '../../hub-kind.registry';
import { canFor } from '../hub-forum.helpers';
import { toForumReply, type HubForumThreadRecord } from '../hub-forum.mappers';
import { findThread, type Db } from '../hub-forum.queries';
import { HubForumService } from '../hub-forum.service';
import type { EventThreadActor } from './event-discussion.access';
import {
  findEventForSync,
  findLiveEventThread,
  newestLiveReplies,
  type LiveEventThread,
} from './event-discussion.queries';
import { syncEventDiscussion } from './event-discussion.sync';
import { resolveEventThread } from './forum-thread.context';

export const EVENT_NOT_FOUND = 'Event not found';
export const DISCUSSION_NOT_FOUND = 'This event has no discussion';

@Injectable()
export class EventDiscussionService {
  /** Clock seam — specs pin it; never `sleep`. */
  now: () => Date = () => new Date();

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly access: GuildAccessService,
    private readonly forum: HubForumService,
    private readonly hubKinds: HubKindRegistry,
  ) {}

  /** `GET events/:id/discussion` — the event-page card. */
  async summary(actor: GuildActor, eventId: number): Promise<EventDiscussion> {
    if (!(await findEventForSync(this.db, eventId))) {
      throw new NotFoundException(EVENT_NOT_FOUND);
    }
    const now = this.now();
    await syncEventDiscussion(this.db, eventId, now);
    const live = await findLiveEventThread(this.db, eventId);
    const record = live && (await findThread(this.db, live.guildId, live.id));
    if (!live || !record) return { state: 'none' };
    if (!(await this.hubOpenTo(actor, live.guildId))) return { state: 'none' };
    const deps = { db: this.db, access: this.access, now };
    const { who, lock, isMember } = await resolveEventThread(
      deps,
      actor,
      record,
    );
    const open = record.thread.deletedAt === null && lock === null;
    return {
      state: 'ready',
      guildId: live.guildId,
      threadId: live.id,
      replyCount: record.thread.replyCount,
      latestReplies: who.canRead ? await this.latest(who, record, lock) : [],
      lock,
      can: { read: who.canRead, reply: open && who.canReply },
      member: isMember,
    };
  }

  /** `GET events/:id/discussion/thread` — the full thread view. */
  async thread(
    actor: GuildActor,
    eventId: number,
    query: unknown,
  ): Promise<HubForumThread> {
    const live = await this.requireLive(actor, eventId);
    return this.forum.forEventScope().get(actor, live.guildId, live.id, query);
  }

  /** `POST events/:id/discussion/replies`. */
  async createReply(
    actor: GuildActor,
    eventId: number,
    input: unknown,
  ): Promise<HubForumReply> {
    const live = await this.requireLive(actor, eventId);
    return this.forum
      .forEventScope()
      .createReply(actor, live.guildId, live.id, input);
  }

  /** `PATCH events/:id/discussion/replies/:replyId`. */
  async updateReply(
    actor: GuildActor,
    eventId: number,
    replyId: number,
    input: unknown,
  ): Promise<HubForumReply> {
    const live = await this.requireLive(actor, eventId);
    const { guildId, id } = live;
    return this.forum
      .forEventScope()
      .updateReply(actor, guildId, id, replyId, input);
  }

  /** `DELETE events/:id/discussion/replies/:replyId`. */
  async deleteReply(
    actor: GuildActor,
    eventId: number,
    replyId: number,
  ): Promise<void> {
    const live = await this.requireLive(actor, eventId);
    await this.forum
      .forEventScope()
      .deleteReply(actor, live.guildId, live.id, replyId);
  }

  private async latest(
    who: EventThreadActor,
    record: HubForumThreadRecord,
    lock: HubForumLock | null,
  ): Promise<HubForumReply[]> {
    const id = record.thread.id;
    const rows = await newestLiveReplies(
      this.db,
      id,
      EVENT_DISCUSSION_LATEST_MAX,
    );
    const readOnly = lock !== null || !who.canReply;
    const opts = { now: this.now(), pinnable: false, readOnly };
    return rows.map((r) => toForumReply(r, canFor(who, r.reply, opts)));
  }

  /**
   * The card's quiet version of {@link requireHub}: false (no card) while the
   * owning plugin is inactive (CLAUDE.md) or the hub is hidden/archived to a
   * non-staff viewer (ROK-1831 L-5, `isHiddenFrom` behind `assertNotHidden`).
   */
  private async hubOpenTo(
    actor: GuildActor,
    guildId: number,
  ): Promise<boolean> {
    if (!(await this.hubKinds.forGuild(guildId))) return false;
    return !(await isHiddenFrom(this.db, actor, guildId));
  }

  /** The event's live thread: 404 (no thread / hidden hub), 403 (plugin off). */
  private async requireLive(
    actor: GuildActor,
    eventId: number,
  ): Promise<LiveEventThread> {
    const live = await findLiveEventThread(this.db, eventId);
    if (!live) throw new NotFoundException(DISCUSSION_NOT_FOUND);
    await this.requireHub(actor, live.guildId);
    return live;
  }

  /**
   * The hub guards `HubForumController` runs, in its order: HubKindActiveGuard
   * (403 while the owning plugin is inactive), then HubVisibleGuard's
   * `assertNotHidden` (404 to non-staff while hidden or archived).
   */
  private async requireHub(actor: GuildActor, guildId: number): Promise<void> {
    const kind = await findGuildKind(this.db, guildId);
    if (kind !== null) this.hubKinds.require(kind);
    await assertNotHidden(this.db, actor, guildId);
  }
}
