import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
  type HubForumActor,
  type HubForumCursor,
} from './hub-forum.helpers';
import {
  toForumReply,
  toForumThread,
  toThreadSummary,
  type HubForumReplyRecord,
  type HubForumThreadRecord,
} from './hub-forum.mappers';
import {
  findReply,
  findThread,
  latestThreads,
  listReplies,
  listThreads,
  type Db,
} from './hub-forum.queries';
import * as writes from './hub-forum.writes';

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
 * author. No notification, no Discord relay, no hub activity (Q7, Q9).
 */
@Injectable()
export class HubForumService {
  /** Clock seam (AC4 edit window) — specs pin it; never `sleep`. */
  now: () => Date = () => new Date();

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly access: GuildAccessService,
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
    return {
      pinned: page.pinned.map(toThreadSummary),
      threads: page.records.map(toThreadSummary),
      nextCursor: encoded(page.next),
    };
  }

  /** The Latest threads widget. */
  async latest(actor: GuildActor, guildId: number): Promise<HubForumLatest> {
    await assertForumMember(this.access, actor, guildId);
    const { records, total } = await latestThreads(
      this.db,
      guildId,
      HUB_FORUM_LATEST_LIMIT,
    );
    return { threads: records.map(toThreadSummary), total };
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
    const who = await resolveForumActor(this.access, actor, guildId);
    return this.view(who, await this.requireThread(guildId, threadId), after);
  }

  /** New thread (Q6 title + markdown body). */
  async createThread(
    actor: GuildActor,
    guildId: number,
    input: unknown,
  ): Promise<HubForumThread> {
    const { title, body } = parseOrThrow(CreateHubForumThreadSchema, input);
    const clean = finalBody(body);
    const who = await resolveForumActor(this.access, actor, guildId);
    const row = await writes.insertThread(this.db, {
      guildId,
      authorId: actor.id,
      title,
      body: clean,
      now: this.now(),
    });
    return this.view(who, await this.requireThread(guildId, row.id), null);
  }

  /** Author-only edit inside 24 h (Q5). */
  async updateThread(
    actor: GuildActor,
    guildId: number,
    threadId: number,
    input: unknown,
  ): Promise<HubForumThread> {
    const parsed = parseOrThrow(UpdateHubForumThreadSchema, input);
    const body = parsed.body === undefined ? undefined : finalBody(parsed.body);
    const who = await resolveForumActor(this.access, actor, guildId);
    const record = await this.requireThread(guildId, threadId);
    const now = this.now();
    assertCanEdit(who, record.thread, now);
    const edit = {
      ...(parsed.title === undefined ? {} : { title: parsed.title }),
      ...(body === undefined ? {} : { body }),
      now,
    };
    const row = await writes.updateThread(this.db, { guildId, threadId }, edit);
    if (!row) throw new NotFoundException('Thread not found');
    return this.view(who, await this.requireThread(guildId, threadId), null);
  }

  /** Soft delete by the author or a moderator; also unpins. */
  async deleteThread(
    actor: GuildActor,
    guildId: number,
    threadId: number,
  ): Promise<void> {
    const who = await resolveForumActor(this.access, actor, guildId);
    const record = await this.requireThread(guildId, threadId);
    const removal = removalFor(who, record.thread, this.now());
    const row = await writes.softDeleteThread(
      this.db,
      { guildId, threadId },
      removal,
    );
    if (!row) throw new NotFoundException('Thread not found');
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
    const row = pinned
      ? await writes.pinThread(
          this.db,
          target,
          { by: actor.id, now: this.now() },
          HUB_FORUM_PAGE_MAX,
        )
      : await writes.setThreadPin(this.db, target, null);
    if (row === 'full') throw new ConflictException(FORUM_PIN_LIMIT);
    if (!row) throw new NotFoundException('Thread not found');
  }

  /** New reply; 409 when the thread was removed (Q8). */
  async createReply(
    actor: GuildActor,
    guildId: number,
    threadId: number,
    input: unknown,
  ): Promise<HubForumReply> {
    const { body } = parseOrThrow(CreateHubForumReplySchema, input);
    const clean = finalBody(body);
    const who = await resolveForumActor(this.access, actor, guildId);
    await this.requireThread(guildId, threadId);
    const row = await writes.insertReply(
      this.db,
      { guildId, threadId },
      { authorId: actor.id, body: clean, now: this.now() },
    );
    if (!row) throw new ConflictException(FORUM_THREAD_CLOSED);
    return this.replyView(
      who,
      await this.requireReply(guildId, threadId, row.id),
    );
  }

  /** Author-only reply edit inside 24 h (Q5). */
  async updateReply(
    actor: GuildActor,
    guildId: number,
    threadId: number,
    replyId: number,
    input: unknown,
  ): Promise<HubForumReply> {
    const body = finalBody(parseOrThrow(UpdateHubForumReplySchema, input).body);
    const who = await resolveForumActor(this.access, actor, guildId);
    const record = await this.requireReply(guildId, threadId, replyId);
    const now = this.now();
    assertCanEdit(who, record.reply, now);
    const row = await writes.updateReply(
      this.db,
      { guildId, threadId, replyId },
      { body, now },
    );
    if (!row) throw new NotFoundException('Reply not found');
    return this.replyView(
      who,
      await this.requireReply(guildId, threadId, replyId),
    );
  }

  /** Soft delete a reply (author or moderator). */
  async deleteReply(
    actor: GuildActor,
    guildId: number,
    threadId: number,
    replyId: number,
  ): Promise<void> {
    const who = await resolveForumActor(this.access, actor, guildId);
    const record = await this.requireReply(guildId, threadId, replyId);
    const removal = removalFor(who, record.reply, this.now());
    const row = await writes.softDeleteReply(
      this.db,
      { guildId, threadId, replyId },
      removal,
    );
    if (!row) throw new NotFoundException('Reply not found');
  }

  private async view(
    who: HubForumActor,
    record: HubForumThreadRecord,
    after: HubForumCursor | null,
  ): Promise<HubForumThread> {
    const page = await listReplies(
      this.db,
      record.thread.id,
      HUB_FORUM_PAGE_MAX,
      after,
    );
    const now = this.now();
    const can = canFor(who, record.thread, { now, pinnable: true });
    const replies = page.records.map((r) => this.replyView(who, r, now));
    return toForumThread(record, can, {
      replies,
      nextReplyCursor: encoded(page.next),
    });
  }

  private replyView(
    who: HubForumActor,
    record: HubForumReplyRecord,
    now: Date = this.now(),
  ): HubForumReply {
    return toForumReply(
      record,
      canFor(who, record.reply, { now, pinnable: false }),
    );
  }

  private async requireThread(
    guildId: number,
    threadId: number,
  ): Promise<HubForumThreadRecord> {
    const record = await findThread(this.db, guildId, threadId);
    if (!record) throw new NotFoundException('Thread not found');
    return record;
  }

  private async requireReply(
    guildId: number,
    threadId: number,
    replyId: number,
  ): Promise<HubForumReplyRecord> {
    const record = await findReply(this.db, { guildId, threadId, replyId });
    if (!record) throw new NotFoundException('Reply not found');
    return record;
  }
}
