/**
 * ROK-1471 D9/D10 — the LFG forum SURFACE ADAPTER.
 *
 * This service subscribes to NO lifecycle event. `LfmEmbedService` remains the
 * single consumer of `LFM_REACHED` / `GROUP_CHANGED` and dispatches in here by
 * `lfg_group_messages.post_kind`. Two independent subscribers writing the same
 * row is precisely the double-post hazard D9 warns about, and the reason→view
 * logic (D6) must stay single-sourced, so the surface split is structural
 * rather than a race we hope to win.
 *
 * The two entry points have DELIBERATELY OPPOSITE error contracts:
 *
 *  - **`postThread` never throws.** Its caller runs inside `POST /lfg`'s
 *    emitter; a missing `Manage Threads` grant must degrade to the 1454 text
 *    board (E2), not 500 a successful signup. It returns null and the caller
 *    falls through to text.
 *  - **`editThread` throws on purpose.** `LfmEmbedService.editRow` reads
 *    `isUnknownMessageError` to decide "the post is gone, repost it" (E3), and
 *    it closes the row anyway on a refused TERMINAL render. Swallowing here
 *    would kill both behaviours silently.
 */
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ChannelType } from 'discord.js';
import type {
  ActionRowBuilder,
  ButtonBuilder,
  EmbedBuilder,
  ForumChannel,
  Guild,
  ThreadChannel,
} from 'discord.js';
import { DiscordBotClientService } from '../discord-bot-client.service';
import type { EmbedContext } from '../services/discord-embed.factory';
import { timedDiscordCall } from '../services/scheduled-event.helpers';
import {
  buildLfmEmbed,
  lfmStateTag,
  type LfmGroupView,
} from '../lfm/lfm-embed.helpers';
import type { LfmMessageRow } from '../lfm/lfm-embed.db-helpers';
import { LfgBoardChannelService } from './lfg-board-channel.service';
import { buildLfgPostComponents } from './lfg-board-components.helpers';
import {
  LfgBoardDebouncer,
  threadNameFor,
  type ThreadMeta,
} from './lfg-board-thread.helpers';
import {
  LFG_BOARD_EDIT_DEBOUNCE_MS,
  LFG_BOARD_EVENTS,
  LFG_BOARD_TAGS,
} from './lfg-board.constants';

/** Best-effort message for a caught `unknown`, never a bare cast. */
function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** What a fresh forum post is tracked by. */
export interface LfgBoardPost {
  /** The forum post. Stored as BOTH `thread_id` and `channel_id` (D9). */
  threadId: string;
  /** The post's first message — the one every later edit rewrites. */
  starterMessageId: string;
}

/**
 * A gone thread, phrased so `isUnknownMessageError` matches it.
 *
 * `isUnknownMessageError` (`services/embed-poster.helpers.ts:139`) is the ONE
 * predicate `LfmEmbedService` uses to decide "repost it". A deleted forum post
 * is the same condition as a deleted text message, but Discord reports it as
 * Unknown Channel (10003), which that predicate does not match. Translating it
 * here keeps E3 working for forum rows without widening a ROK-1454 predicate
 * that three other surfaces depend on.
 */
function threadGoneError(threadId: string): Error {
  return new Error(`Unknown Message: LFG board thread ${threadId} is gone`);
}

@Injectable()
export class LfgBoardService {
  private readonly logger = new Logger(LfgBoardService.name);

  /**
   * Renames and tag edits are coalesced; content edits never come through here
   * (D10). `applyThreadMeta` owns its errors because the timer path swallows
   * rejections — an unhandled rejection out of a `setTimeout` kills the process.
   */
  private readonly debouncer = new LfgBoardDebouncer(
    LFG_BOARD_EDIT_DEBOUNCE_MS,
    (threadId, desired) => this.applyThreadMeta(threadId, desired),
  );

  constructor(
    private readonly clientService: DiscordBotClientService,
    private readonly channelService: LfgBoardChannelService,
  ) {}

  /**
   * The board forum, for `resolveLfgBoardSurface`.
   *
   * @param guild - The connected guild.
   * @returns The forum, or null when the text fallback should be used.
   */
  resolveForum(guild: Guild): Promise<ForumChannel | null> {
    return this.channelService.resolveForum(guild);
  }

  /**
   * Create the group's forum post.
   *
   * @param forumChannelId - The board forum resolved at post time.
   * @param view - The group as the caller read it.
   * @param context - Community branding + client URL for the chrome.
   * @returns The ids to track, or null when the post could not be made — the
   *   caller then falls back to the 1454 text board (E2). NEVER throws.
   */
  async postThread(
    forumChannelId: string,
    view: LfmGroupView,
    context: EmbedContext,
  ): Promise<LfgBoardPost | null> {
    const guild = this.clientService.getGuild();
    if (!guild) return null; // E17 — reconcile picks it up on CONNECTED.
    let created: ThreadChannel | null = null;
    try {
      const forum = await guild.channels.fetch(forumChannelId);
      if (forum?.type !== ChannelType.GuildForum) return null;
      const thread = await this.createThread(forum, view, context);
      created = thread;
      const starter = await thread.fetchStarterMessage();
      if (!starter) throw threadGoneError(thread.id);
      return { threadId: thread.id, starterMessageId: starter.id };
    } catch (err) {
      // The thread EXISTS the moment `threads.create` resolves. Returning null
      // now sends the caller to the text fallback, so leaving it behind would
      // give one group two board surfaces — an untracked forum post nothing
      // ever edits, retags or archives (D2/AC3).
      if (created) await this.discardOrphan(created);
      this.logger.warn(
        `Could not post game ${String(view.gameId)} to the LFG forum: ` +
          `${describeError(err)}. Grant the bot Create Posts / Send Messages ` +
          'in that forum. Falling back to the text board.',
      );
      return null;
    }
  }

  /** Delete a thread that was created but never tracked. Never rejects. */
  private async discardOrphan(thread: ThreadChannel): Promise<void> {
    await thread
      .delete('Raid Ledger LFG board — post failed after create')
      .catch((err: unknown) => {
        this.logger.warn(
          `Left an untracked LFG forum thread ${thread.id} behind: ` +
            `${describeError(err)}. Delete it by hand.`,
        );
      });
  }

  /** The `threads.create` call itself, kept off `postThread`'s error path. */
  private createThread(
    forum: ForumChannel,
    view: LfmGroupView,
    context: EmbedContext,
  ): Promise<ThreadChannel> {
    const { embed, components } = this.render(view, context);
    const tagId = this.channelService.tagIdFor(forum, lfmStateTag(view));
    return timedDiscordCall('lfgBoard.post', () =>
      forum.threads.create({
        name: threadNameFor(view),
        message: { embeds: [embed], components },
        appliedTags: tagId ? [tagId] : [],
        reason: 'Raid Ledger LFG board',
      }),
    );
  }

  /**
   * Rewrite a tracked forum post, and archive it once the group has ended.
   *
   * @param row - The tracked `forum` row.
   * @param view - The render the caller decided on (D6).
   * @param context - Community branding + client URL for the chrome.
   * @throws Whatever Discord says. `Unknown Message` reaches the heal path.
   */
  async editThread(
    row: LfmMessageRow,
    view: LfmGroupView,
    context: EmbedContext,
  ): Promise<void> {
    const thread = await this.fetchThread(row.threadId ?? row.channelId);
    if (thread.archived) await this.unarchive(thread);

    const { embed, components } = this.render(view, context);
    const starter = await thread.fetchStarterMessage();
    if (!starter) throw threadGoneError(thread.id);
    await starter.edit({ embeds: [embed], components });

    const desired = this.metaFor(thread, view);
    this.debouncer.schedule(thread.id, desired);
    if (view.state !== 'open') await this.close(thread);
  }

  /** Drain every pending rename/tag window now (D10 flush endpoint). */
  async flushAll(): Promise<void> {
    await this.debouncer.flush();
  }

  /**
   * The DEMO_MODE flush endpoint's handler — `emitAsync` awaits this, so a
   * smoke test can assert a thread's name without sleeping out the window.
   */
  @OnEvent(LFG_BOARD_EVENTS.FLUSH)
  async onFlushRequested(): Promise<void> {
    await this.flushAll();
  }

  /** The embed + row for a render. `'button'` and `[]` agree at every state. */
  private render(
    view: LfmGroupView,
    context: EmbedContext,
  ): {
    embed: EmbedBuilder;
    components: ActionRowBuilder<ButtonBuilder>[];
  } {
    // `buildLfmEmbed` ignores `'button'` at terminal states and
    // `buildLfgPostComponents` returns `[]` there, so the pair is always
    // consistent: a live `+1` never outlives the group, and a post is never
    // left with neither a masked link nor a Link button.
    const { embed } = buildLfmEmbed(view, context, Date.now(), {
      linkStyle: 'button',
    });
    const components = buildLfgPostComponents({
      gameId: view.gameId,
      gameSlug: view.gameSlug,
      // `EmbedContext.clientUrl` is nullable; the row builder drops the Link
      // button on a falsy value rather than sending Discord an empty URL.
      clientUrl: context.clientUrl ?? undefined,
      state: view.state,
    });
    return { embed, components };
  }

  /** The name + tag the thread should be carrying after this render. */
  private metaFor(thread: ThreadChannel, view: LfmGroupView): ThreadMeta {
    const parent = thread.parent;
    const tagId =
      parent?.type === ChannelType.GuildForum
        ? this.channelService.tagIdFor(parent, lfmStateTag(view))
        : undefined;
    return { name: threadNameFor(view), tagId };
  }

  /** Fetch a tracked thread, or report it gone in the heal path's terms. */
  private async fetchThread(threadId: string): Promise<ThreadChannel> {
    const guild = this.clientService.getGuild();
    if (!guild) throw new Error('Discord guild unavailable');
    const channel = await guild.channels
      .fetch(threadId)
      .catch((err: unknown) => {
        throw threadGoneError(`${threadId} (${describeError(err)})`);
      });
    if (!channel?.isThread()) throw threadGoneError(threadId);
    return channel;
  }

  /** E7 — a thread Discord auto-archived must reopen before it can be edited. */
  private async unarchive(thread: ThreadChannel): Promise<void> {
    await timedDiscordCall('lfgBoard.unarchive', () =>
      thread.setArchived(false),
    );
  }

  /**
   * Terminal: land the final name/tag, then archive.
   *
   * Flushed BEFORE archiving so the post does not settle under a stale
   * head-count, and warned rather than thrown so a refused archive still lets
   * `LfmEmbedService` close the row — an unclosable row holds the game hostage
   * to the partial unique index (AC7/AC9's wedge class).
   */
  private async close(thread: ThreadChannel): Promise<void> {
    await this.debouncer.flush(thread.id);
    try {
      await timedDiscordCall('lfgBoard.archive', () =>
        thread.setArchived(true),
      );
    } catch (err) {
      this.logger.warn(
        `Could not archive the LFG board thread ${thread.id}: ` +
          `${describeError(err)}. The group is closed regardless.`,
      );
    }
  }

  /**
   * D10 — write the debounced metadata, skipping no-ops.
   *
   * The comparison is against what Discord CURRENTLY holds, not an in-memory
   * cache, so it stays correct across a restart. Renames are rate-limited and
   * precious; a no-op rename spends the bucket for nothing.
   *
   * Never rejects: the debouncer's timer path swallows rejections by design,
   * so a throwing apply would fail invisibly.
   */
  private async applyThreadMeta(
    threadId: string,
    desired: ThreadMeta,
  ): Promise<void> {
    let thread: ThreadChannel;
    try {
      thread = await this.fetchThread(threadId);
    } catch (err) {
      this.logger.warn(
        `Could not reach LFG board thread ${threadId} to rename it: ${describeError(err)}.`,
      );
      return;
    }
    if (thread.name !== desired.name) {
      await this.tryMeta(threadId, 'rename', () =>
        thread.setName(desired.name),
      );
    }
    await this.applyTag(threadId, thread, desired);
  }

  /** The tag half of `applyThreadMeta`, including the clear-it case. */
  private async applyTag(
    threadId: string,
    thread: ThreadChannel,
    desired: ThreadMeta,
  ): Promise<void> {
    const tags = thread.appliedTags;
    const tagId = desired.tagId;
    if (tagId) {
      const tagged = tags.length === 1 && tags[0] === tagId;
      if (!tagged) {
        await this.tryMeta(threadId, 'retag', () =>
          thread.setAppliedTags([tagId]),
        );
      }
      return;
    }
    // No tag resolved (E16: the top-up was skipped at Discord's tag cap). A
    // board tag left in place would keep advertising a dead group in the
    // forum's tag filter, so it is cleared rather than kept.
    if (this.carriesBoardTag(thread)) {
      await this.tryMeta(threadId, 'untag', () => thread.setAppliedTags([]));
    }
  }

  /** Whether the thread carries a tag the board itself owns. */
  private carriesBoardTag(thread: ThreadChannel): boolean {
    const parent = thread.parent;
    if (parent?.type !== ChannelType.GuildForum) return false;
    const names: readonly string[] = LFG_BOARD_TAGS;
    const owned = new Set(
      parent.availableTags
        .filter((tag) => names.includes(tag.name))
        .map((tag) => tag.id),
    );
    return thread.appliedTags.some((id) => owned.has(id));
  }

  /** One metadata write, warned rather than thrown. */
  private async tryMeta(
    threadId: string,
    what: string,
    fn: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await timedDiscordCall(`lfgBoard.${what}`, fn);
    } catch (err) {
      this.logger.warn(
        `Could not ${what} LFG board thread ${threadId}: ${describeError(err)}.`,
      );
    }
  }
}
