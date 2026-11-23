import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  CreateHubForumReplySchema,
  CreateHubForumThreadSchema,
  HUB_FORUM_LATEST_LIMIT,
  HUB_FORUM_PAGE_MAX,
  HubForumListQuerySchema,
  HubForumThreadQuerySchema,
  UpdateHubForumReplySchema,
  UpdateHubForumThreadSchema,
  type HubForumLatest,
  type HubForumReply,
  type HubForumThread,
  type HubForumThreadList,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { GuildAccessService, type GuildActor } from '../guild-access.service';
import { finalBody, parseOrThrow } from '../posts/hub-posts.service.helpers';
import {
  assertCanEdit,
  assertForumMember,
  removalFor,
  resolveForumActor,
} from './hub-forum.access';
import {
  canFor,
  decodeForumCursor,
  encodeForumCursor,
  type HubForumCursor,
} from './hub-forum.helpers';
import {
  toForumReply,
  toForumThread,
  toThreadSummary,
  type HubForumReplyRecord,
} from './hub-forum.mappers';
import {
  assertCanReply,
  assertEventEditable,
  assertNotEventThread,
  isSubjectThread,
} from './event-discussion/event-discussion.access';
import {
  forumThreadContext,
  type ForumThreadContext as Ctx,
} from './event-discussion/forum-thread.context';
import { countEventSignups } from './event-discussion/event-discussion.queries';
import { withLatestReplies } from './hub-forum-latest-reply';
import {
  findReply,
  latestThreads,
  listReplies,
  listThreads,
  type Db,
} from './hub-forum.queries';
import * as writes from './hub-forum.writes';
import { emitForumChange, type ForumOp, type ForumRef } from './hub-forum.emit';

/** Q8: replying to a removed (or vanished) thread. */
export const FORUM_THREAD_CLOSED = 'This thread was removed';
/** The pinned group is one un-paged list, so pins are capped at write time. */
export const FORUM_PIN_LIMIT = `A hub can pin at most ${HUB_FORUM_PAGE_MAX} threads. Unpin a thread first.`;

function cursorOf(raw: string | undefined): HubForumCursor | null {
  return raw === undefined ? null : decodeForumCursor(raw);
}

function encoded(next: HubForumCursor | null): string | null {
  return next ? encodeForumCursor(next) : null;
}

/**
 * ROK-1175 — the hub forum at `guilds/:id/forum`, every hub kind (Core).
 * Reads and writes need `canView` (403 before 404); edits and deletes run
 * `canFor` here because the L2 writes check neither the window nor the
 * author. No notification, no hub activity (Q7, Q9). Every write emits
 * `hub-forum.changed` (ROK-2208 D2) for the Discord forum sync.
 */
@Injectable()
export class HubForumService {
  /** Clock seam (AC4 edit window) — specs pin it; never `sleep`. */
  now: () => Date = () => new Date();

  /** Set only on the {@link forEventScope} view. */
  private eventScoped = false;

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly access: GuildAccessService,
    private readonly events: EventEmitter2,
  ) {}

  /** Pinned (page 1 only) + one page of the activity feed. */
  async list(
    actor: GuildActor,
    guildId: number,
    query: unknown,
  ): Promise<HubForumThreadList> {
    const { limit, cursor } = parseOrThrow(HubForumListQuerySchema, query);
    const after = cursorOf(cursor);
    await assertForumMember(this.access, actor, guildId);
    const page = await listThreads(this.db, guildId, limit, after);
    const now = this.now();
    const [pinned = [], threads = []] = await withLatestReplies(this.db, [
      page.pinned.map((r) => toThreadSummary(r, now)),
      page.records.map((r) => toThreadSummary(r, now)),
    ]);
    return { pinned, threads, nextCursor: encoded(page.next) };
  }

  /** The Latest threads widget. */
  async latest(actor: GuildActor, guildId: number): Promise<HubForumLatest> {
    await assertForumMember(this.access, actor, guildId);
    const { records, total } = await latestThreads(
      this.db,
      guildId,
      HUB_FORUM_LATEST_LIMIT,
    );
    const now = this.now();
    return { threads: records.map((r) => toThreadSummary(r, now)), total };
  }

  /** One thread + a page of its replies, oldest first. */
  async get(
    actor: GuildActor,
    guildId: number,
    threadId: number,
    query: unknown,
  ): Promise<HubForumThread> {
    const { replyCursor } = parseOrThrow(HubForumThreadQuerySchema, query);
    const after = cursorOf(replyCursor);
    return this.view(await this.thread(actor, guildId, threadId), after);
  }

  /** New thread (Q6 title + markdown body). */
  async createThread(
    actor: GuildActor,
    guildId: number,
    input: unknown,
  ): Promise<HubForumThread> {
    const { title, body } = parseOrThrow(CreateHubForumThreadSchema, input);
    const clean = finalBody(body);
    await resolveForumActor(this.access, actor, guildId);
    const row = await writes.insertThread(this.db, {
      guildId,
      authorId: actor.id,
      title,
      body: clean,
      now: this.now(),
    });
    this.emit('thread.created', actor, { guildId, threadId: row.id });
    return this.view(await this.thread(actor, guildId, row.id), null);
  }

  /** Author-only edit inside 24 h (Q5); never an event thread (§5.5). */
  async updateThread(
    actor: GuildActor,
    guildId: number,
    threadId: number,
    input: unknown,
  ): Promise<HubForumThread> {
    const parsed = parseOrThrow(UpdateHubForumThreadSchema, input);
    const body = parsed.body === undefined ? undefined : finalBody(parsed.body);
    const { who, record } = await this.thread(actor, guildId, threadId);
    assertNotEventThread(record.thread);
    const now = this.now();
    assertCanEdit(who, record.thread, now);
    const edit = {
      ...(parsed.title === undefined ? {} : { title: parsed.title }),
      ...(body === undefined ? {} : { body }),
      now,
    };
    const row = await writes.updateThread(this.db, { guildId, threadId }, edit);
    if (!row) throw new NotFoundException('Thread not found');
    this.emit('thread.updated', actor, { guildId, threadId });
    return this.view(await this.thread(actor, guildId, threadId), null);
  }

  /** Soft delete by the author or a moderator; also unpins. Not event threads. */
  async deleteThread(
    actor: GuildActor,
    guildId: number,
    threadId: number,
  ): Promise<void> {
    const { who, record } = await this.thread(actor, guildId, threadId);
    assertNotEventThread(record.thread);
    const removal = removalFor(who, record.thread, this.now());
    const target = { guildId, threadId };
    const row = await writes.softDeleteThread(this.db, target, removal);
    if (!row) throw new NotFoundException('Thread not found');
    this.emit('thread.deleted', actor, { guildId, threadId });
  }

  /**
   * Pin / unpin (moderators — `GuildEditorGuard` on the route). Idempotent;
   * a pin past the cap is 409 (the list never pages the pinned group).
   */
  async setPin(
    actor: GuildActor,
    guildId: number,
    threadId: number,
    pinned: boolean,
  ): Promise<void> {
    await assertForumMember(this.access, actor, guildId);
    const target = { guildId, threadId };
    const pin = { by: actor.id, now: this.now() };
    const row = pinned
      ? await writes.pinThread(this.db, target, pin, HUB_FORUM_PAGE_MAX)
      : await writes.setThreadPin(this.db, target, null);
    if (row === 'full') throw new ConflictException(FORUM_PIN_LIMIT);
    if (!row) throw new NotFoundException('Thread not found');
    this.emit(pinned ? 'thread.pinned' : 'thread.unpinned', actor, target);
  }

  /** New reply; 409 when removed (Q8) or read-only, 403 when not signed up. */
  async createReply(
    actor: GuildActor,
    guildId: number,
    threadId: number,
    input: unknown,
  ): Promise<HubForumReply> {
    const { body } = parseOrThrow(CreateHubForumReplySchema, input);
    const clean = finalBody(body);
    const ctx = await this.thread(actor, guildId, threadId);
    assertCanReply(ctx.canReply, ctx.lock, ctx.record.thread);
    const row = await writes.insertReply(
      this.db,
      { guildId, threadId },
      { authorId: actor.id, body: clean, now: this.now() },
    );
    if (!row) throw new ConflictException(FORUM_THREAD_CLOSED);
    const target = { guildId, threadId, replyId: row.id };
    this.emit('reply.created', actor, target);
    return this.replyView(ctx, await this.requireReply(target));
  }

  /** Author-only reply edit inside 24 h (Q5), while writable. */
  async updateReply(
    actor: GuildActor,
    guildId: number,
    threadId: number,
    replyId: number,
    input: unknown,
  ): Promise<HubForumReply> {
    const body = finalBody(parseOrThrow(UpdateHubForumReplySchema, input).body);
    const ctx = await this.thread(actor, guildId, threadId);
    const target = { guildId, threadId, replyId };
    const { reply } = await this.requireReply(target);
    const now = this.now();
    const replier = { ...ctx.who, canReply: ctx.canReply };
    assertEventEditable(replier, reply, ctx.lock, ctx.record.thread);
    assertCanEdit(ctx.who, reply, now);
    const row = await writes.updateReply(this.db, target, { body, now });
    if (!row) throw new NotFoundException('Reply not found');
    this.emit('reply.updated', actor, target);
    return this.replyView(ctx, await this.requireReply(target));
  }

  /** Soft delete a reply (author or moderator; read-only does not block). */
  async deleteReply(
    actor: GuildActor,
    guildId: number,
    threadId: number,
    replyId: number,
  ): Promise<void> {
    const { who } = await this.thread(actor, guildId, threadId, replyId);
    const target = { guildId, threadId, replyId };
    const { reply } = await this.requireReply(target);
    const removal = removalFor(who, reply, this.now());
    const row = await writes.softDeleteReply(this.db, target, removal);
    if (!row) throw new NotFoundException('Reply not found');
    this.emit('reply.deleted', actor, { guildId, threadId, replyId });
  }

  /** ROK-2208 D2: after the write landed; listeners never throw back here. */
  private emit(op: ForumOp, actor: GuildActor, at: ForumRef): void {
    emitForumChange(this.events, op, actor.id, at);
  }

  /** Thread + viewer rights (§6 for event threads; `deleteReplyId` = delete own). */
  private thread(
    actor: GuildActor,
    guildId: number,
    threadId: number,
    deleteReplyId?: number,
  ): Promise<Ctx> {
    const deps = { db: this.db, access: this.access, now: this.now() };
    const target = { guildId, threadId, eventScoped: this.eventScoped };
    const del = deleteReplyId === undefined ? {} : { deleteReplyId };
    return forumThreadContext(deps, actor, { ...target, ...del });
  }

  /**
   * ROK-2226 §6.1 — this service as seen from `events/:id/discussion`: the
   * same routes minus the hub-member gate (the §6 matrix decides).
   */
  forEventScope(): HubForumService {
    return Object.assign(Object.create(this) as HubForumService, {
      eventScoped: true,
    });
  }

  private async view(
    ctx: Ctx,
    after: HubForumCursor | null,
  ): Promise<HubForumThread> {
    const { record } = ctx;
    const id = record.thread.id;
    const page = await listReplies(this.db, id, HUB_FORUM_PAGE_MAX, after);
    const now = this.now();
    const managed = isSubjectThread(record.thread);
    const base = canFor(ctx.who, record.thread, { now, pinnable: true });
    // D6/§5.5: a subject's lifecycle owns its thread root — nobody edits/removes it.
    const can = managed ? { ...base, edit: false, delete: false } : base;
    const replies = page.records.map((r) => this.replyView(ctx, r, now));
    const live = record.thread.deletedAt === null;
    const ev = record.event ?? null;
    const signups =
      live && ev ? await countEventSignups(this.db, ev.id) : undefined;
    return toForumThread(record, can, {
      replies,
      nextReplyCursor: encoded(page.next),
      now,
      canReply: live && ctx.canReply && ctx.lock === null,
      ...(signups === undefined ? {} : { signupCount: signups }),
    });
  }

  private replyView(
    ctx: Ctx,
    record: HubForumReplyRecord,
    now: Date = this.now(),
  ): HubForumReply {
    const readOnly = ctx.lock !== null || !ctx.canReply;
    const opts = { now, pinnable: false, readOnly };
    return toForumReply(record, canFor(ctx.who, record.reply, opts));
  }

  private async requireReply(
    target: Required<ForumRef>,
  ): Promise<HubForumReplyRecord> {
    const record = await findReply(this.db, target);
    if (!record) throw new NotFoundException('Reply not found');
    return record;
  }
}
