/**
 * ROK-1483 D1 — the read-only Discord thread mirror.
 *
 * Two halves that never meet:
 *
 *  - the WRITE half (`ensureBackfilled`, `reconcile`, `onMessage*`) talks to
 *    Discord and writes rows;
 *  - the READ half (`getMessages`) touches Postgres and nothing else. The only
 *    client call it is allowed is `getGuildId()`, and only as the fallback for
 *    a thread with no mirrored rows to carry the guild — AC10 pins this, and a
 *    proxy here would put Discord's rate limit on a page load.
 *
 * Nothing on the write half may throw into its emitter: `BOUND` is emitted
 * inside `POST /lfg`'s call stack, so a throw would surface to a player as a
 * 500 on a successful signup. Every entry point catches and logs.
 */
import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type {
  ThreadMessagesQueryDto,
  ThreadMessagesResponseDto,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { DISCORD_BOT_EVENTS } from '../discord-bot.constants';
import { isUnknownMessageError } from '../services/embed-poster.helpers';
import {
  collectBackfillMessages,
  type BackfillThread,
} from './thread-mirror.backfill';
import {
  THREAD_MIRROR_EVENTS,
  type ThreadBoundPayload,
} from './thread-mirror.constants';
import {
  hasAnyMirrored,
  insertMirroredMessages,
  isMirroredMessage,
  listMirroredMessages,
  softDeleteMirroredMessage,
  updateMirroredReactions,
  upsertMirroredMessage,
  type ThreadMirrorDb,
} from './thread-mirror.db-helpers';
import {
  buildThreadUrl,
  isOwnBotMessage,
  toMirrorRow,
  toReactionSnapshot,
  toThreadMessageDto,
  type MirrorSourceMessage,
  type MirrorSourceReactions,
} from './thread-mirror.helpers';
import { ThreadSurfaceRegistry } from './thread-surface.registry';

/**
 * A `messageUpdate` payload: discord.js hands either the whole message or a
 * partial that can fetch one (D6).
 */
export type MirrorUpdatedMessage =
  | MirrorSourceMessage
  | { id: string; partial: true; fetch(): Promise<MirrorSourceMessage> };

/** A `messageDelete` payload — a partial always carries at least its id. */
export interface MirrorDeletedMessage {
  id: string;
}

/**
 * The message a reaction event points at (ROK-1506) — `reaction.message`, or
 * the message itself on `messageReactionRemoveAll`. Both a `Message` and a
 * `PartialMessage` satisfy this: `partial` is the discriminator and `fetch`
 * resolves the full one. `reactions` is optional only so a fixture literal
 * compiles; a real object always carries it.
 */
export interface MirrorReactedMessage {
  id: string;
  partial: boolean;
  reactions?: MirrorSourceReactions;
  fetch(): Promise<MirrorReactedMessage>;
}

/** Whether an update arrived as an uncached partial. */
function isPartial(message: MirrorUpdatedMessage): message is {
  id: string;
  partial: true;
  fetch(): Promise<MirrorSourceMessage>;
} {
  return (message as { partial?: boolean }).partial === true;
}

/** Mirrors app-owned Discord threads into `discord_thread_messages`. */
@Injectable()
export class ThreadMirrorService {
  private readonly logger = new Logger(ThreadMirrorService.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: ThreadMirrorDb,
    private readonly clientService: DiscordBotClientService,
    private readonly registry: ThreadSurfaceRegistry,
  ) {}

  /**
   * D4 — a thread was just bound to a surface; walk its history once.
   *
   * @param payload - The thread, its guild and the surface that owns it.
   */
  @OnEvent(THREAD_MIRROR_EVENTS.BOUND)
  async ensureBackfilled(payload: ThreadBoundPayload): Promise<void> {
    await this.backfill(payload.threadId, payload.guildId);
  }

  /**
   * D14 — walk every live thread the mirror has never seen, on reconnect.
   *
   * A thread bound while the process was down never got its bind-time
   * backfill, and the gateway will never re-deliver those messages, so
   * without this the mirror silently misses whole conversations.
   *
   * Bounded by `hasAnyMirrored`: a thread that already has rows was
   * backfilled once and the gateway has fed it ever since, so re-walking it
   * costs up to three Discord REST calls (`channels.fetch` plus two
   * `messages.fetch`) to re-skip the same rows through conflict-do-nothing.
   * Reconnects are routine — every deploy is one — so the unconditional walk
   * was `3N` REST calls per reconnect for N live groups, sequentially, inside
   * the gateway handler.
   *
   * The cost of the bound: messages posted in an ALREADY-mirrored thread
   * during the downtime window are not recovered. Recovering those needs a
   * windowed check (walk only back to the newest mirrored `sort_key`) rather
   * than a full re-walk — the follow-up, not a reason to drop the bound.
   */
  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED)
  async reconcile(): Promise<void> {
    const threads = await this.registry.listActiveThreads().catch(() => []);
    for (const thread of threads) {
      if (await hasAnyMirrored(this.db, thread.threadId)) continue;
      await this.backfill(thread.threadId, thread.guildId);
    }
  }

  /**
   * Mirror a live message. The listener has already applied every guard.
   *
   * @param message - The message as the gateway delivered it.
   * @param threadId - The thread it was posted in.
   * @param guildId - The guild, stored so the read path needs no client.
   */
  async onMessageCreate(
    message: MirrorSourceMessage,
    threadId: string,
    guildId: string,
  ): Promise<void> {
    await this.guarded('messageCreate', () =>
      upsertMirroredMessage(this.db, threadId, toMirrorRow(message, guildId)),
    );
  }

  /**
   * Reflect an edit, fetching the message first when it arrived as a partial.
   *
   * A fetch that comes back Unknown Message means the edit raced a delete, so
   * the correct end state is the soft delete, not a retry.
   *
   * The own-bot guard (D9) is re-asserted HERE, on the fetched message, not
   * only in the listener: an uncached `messageUpdate` arrives with
   * `author === null`, so the listener cannot answer the question at all and
   * deliberately passes the partial through. The board edits its own starter
   * post on every roster change and that post is uncached after any restart,
   * so without this re-check the app's own embed lands in the mirror — which
   * is the one thing D9 exists to prevent.
   *
   * @param message - The updated message, possibly partial.
   * @param threadId - The thread it lives in.
   * @param guildId - Its guild.
   */
  async onMessageUpdate(
    message: MirrorUpdatedMessage,
    threadId: string,
    guildId: string,
  ): Promise<void> {
    await this.guarded('messageUpdate', async () => {
      let full: MirrorSourceMessage;
      if (isPartial(message)) {
        try {
          full = await message.fetch();
        } catch (err) {
          if (!isUnknownMessageError(err)) throw err;
          await softDeleteMirroredMessage(this.db, message.id);
          return;
        }
      } else {
        full = message;
      }
      const ownId = this.clientService.getClient()?.user?.id ?? null;
      if (isOwnBotMessage(full, ownId)) return;
      await upsertMirroredMessage(
        this.db,
        threadId,
        toMirrorRow(full, guildId),
      );
    });
  }

  /**
   * Soft-delete by id alone (D10) — the message is gone, so it is NEVER
   * fetched. A partial `messageDelete` carries nothing else, and a hard delete
   * would let a later backfill resurrect the row.
   *
   * @param message - The deleted message, possibly partial.
   */
  async onMessageDelete(message: MirrorDeletedMessage): Promise<void> {
    await this.guarded('messageDelete', () =>
      softDeleteMirroredMessage(this.db, message.id),
    );
  }

  /**
   * ROK-1506 — a reaction changed on some message; snapshot its whole set.
   *
   * The gate is a by-`message_id` probe HERE, not a channel lookup in the
   * listener (D4): the listener holds no db handle, and the mirrored set is
   * exactly the writable set. Then D8 — fetch only when the payload is a
   * partial, and never on `cleared` (the answer is `[]` without asking). An
   * Unknown-Message fetch returns silently: the delete path owns that row.
   *
   * @param message - The reacted-to message, possibly partial.
   * @param options - `cleared` is `messageReactionRemoveAll`.
   */
  async onReactionChange(
    message: MirrorReactedMessage,
    options: { cleared: boolean },
  ): Promise<void> {
    await this.guarded('reactionChange', async () => {
      if (!(await isMirroredMessage(this.db, message.id))) return;
      if (options.cleared) {
        await updateMirroredReactions(this.db, message.id, []);
        return;
      }
      let full = message;
      if (message.partial) {
        try {
          full = await message.fetch();
        } catch (err) {
          if (!isUnknownMessageError(err)) throw err;
          return;
        }
      }
      await updateMirroredReactions(
        this.db,
        message.id,
        toReactionSnapshot(full.reactions?.cache),
      );
    });
  }

  /**
   * One page of a thread's conversation (D3, D11).
   *
   * Authorization runs in exactly this order: the thread must be app-owned,
   * the caller's CLAIMED surface must match the one the server resolved, and
   * only then may the surface decide whether this user can view it. The claim
   * is never the authority — it exists so a mismatch is a detectable 403.
   * Every failure is a 403, never a 404: a 404 would confirm to an attacker
   * that a given thread id is unknown to us.
   *
   * @param userId - The authenticated caller.
   * @param threadId - The thread being read.
   * @param query - Validated `surfaceKind` / `surfaceId` / `before` / `limit`.
   * @returns The page, ascending by snowflake — render order.
   */
  async getMessages(
    userId: number,
    threadId: string,
    query: ThreadMessagesQueryDto,
  ): Promise<ThreadMessagesResponseDto> {
    const surface = await this.registry.resolveSurface(threadId);
    if (!surface) throw new ForbiddenException('Thread is not readable');
    if (surface.kind !== query.surfaceKind || surface.id !== query.surfaceId) {
      throw new ForbiddenException('Thread is not readable');
    }
    if (!(await this.registry.canView(surface.kind, surface.id, userId))) {
      throw new ForbiddenException('Thread is not readable');
    }

    const rows = await listMirroredMessages(this.db, threadId, {
      before: query.before,
      limit: query.limit,
    });
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit).reverse();
    // The row carries the guild so the common case makes no client call at
    // all; `getGuildId()` is the fallback for a thread with nothing mirrored
    // yet, and is the ONLY client call AC10 allows on this path.
    const guildId = page[0]?.guildId ?? this.clientService.getGuildId();

    return {
      threadId,
      surface,
      messages: page.map(toThreadMessageDto),
      hasMore,
      threadUrl: guildId ? buildThreadUrl(guildId, threadId) : null,
      // D12: archive is not an end state for the mirror — an archived thread
      // renders exactly like a live one. Nothing on the row records archival
      // and asking Discord would be a call on the read path (D1), so this is
      // reported as false until a surface can answer it from Postgres.
      archived: false,
    };
  }

  /** Walk a thread and insert whatever is not mirrored yet (D13). */
  private async backfill(threadId: string, guildId: string): Promise<void> {
    await this.guarded(`backfill ${threadId}`, async () => {
      const thread = await this.fetchThread(threadId);
      if (!thread) return;
      const { messages, truncated } = await collectBackfillMessages(thread);
      const ownId = this.clientService.getClient()?.user?.id ?? null;
      const rows = messages
        .filter((message) => !isOwnBotMessage(message, ownId))
        .map((message) => toMirrorRow(message, guildId));
      // Bulk + conflict-do-nothing, never the upsert: AC2 requires a second
      // backfill to move no row's `mirror_updated_at` and to un-delete
      // nothing.
      await insertMirroredMessages(this.db, threadId, rows);
      if (truncated) {
        this.logger.log(
          `thread ${threadId}: backfill hit the cap — older history stays in Discord`,
        );
      }
    });
  }

  /** The thread as something that can page its messages, or null. */
  private async fetchThread(threadId: string): Promise<BackfillThread | null> {
    const client = this.clientService.getClient();
    if (!client) return null;
    const channel = await client.channels.fetch(threadId).catch(() => null);
    return channel?.isThread() ? channel : null;
  }

  /** Run a write path, logging rather than throwing into the emitter. */
  private async guarded(
    label: string,
    run: () => Promise<void>,
  ): Promise<void> {
    try {
      await run();
    } catch (err) {
      this.logger.warn(
        `thread mirror ${label} failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
