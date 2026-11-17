import { Inject, Injectable, Logger } from '@nestjs/common';
import { ThreadRenameBudget } from '../../../discord-bot/lfg-board/lfg-board-thread.helpers';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import { getClientUrl } from '../../../settings/settings-bot.helpers';
import { SettingsService } from '../../../settings/settings.service';
import { toPerson, type HubPostPersonRow } from '../../posts/hub-posts.helpers';
import type { ForumOp, HubForumChange } from '../hub-forum.emit';
import { findReply, findThread } from '../hub-forum.queries';
import {
  absoluteAvatarUrl,
  discordThreadName,
  forumThreadUrl,
  truncateForDiscord,
  webhookUsername,
} from './hub-forum-discord-content';
import { EventPostOutbound } from './hub-forum-discord-event-outbound.service';
import { syncBornAt } from './hub-forum-discord-event-outbound.queries';
import * as links from './hub-forum-discord-links.queries';
import {
  HubForumDiscordOutboundGateway,
  type DiscordWriteResult,
  type OutboundAuthor,
  type OutboundTarget,
} from './hub-forum-discord-outbound.discord';
import {
  findBinding,
  type BindingWithForum,
  type ForumDiscordDb,
} from './hub-forum-discord.queries';

/** One change, resolved against the hub's live binding. */
interface Job {
  change: HubForumChange;
  bound: BindingWithForum;
  target: OutboundTarget;
  /** S6 retry: the already-claimed link to re-drive (no new claim). */
  link?: links.ForumLink;
}

/** What one `retry` did: sent something, or why it could not. */
export type RetryOutcome = 'dispatched' | 'unbound' | 'stale';

/** Rows the inbound lane wrote carry a Discord author: never echo them out. */
const fromDiscord = (row: { authorDiscordId: string | null }): boolean =>
  row.authorDiscordId !== null;

const describe = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/**
 * ROK-2208 §5.2 — applies one `hub-forum.changed` to the bound Discord forum.
 * No binding (or no webhook yet) ⇒ nothing. Creates claim their link row
 * first, so every failure leaves a retryable `failed` row (D3).
 */
@Injectable()
export class HubForumDiscordOutboundService {
  private readonly logger = new Logger(HubForumDiscordOutboundService.name);
  private readonly renames = new ThreadRenameBudget();
  /** Clock seam for specs. */
  now: () => Date = () => new Date();
  /** §5.7 event threads: lazy post + retitle. */
  private readonly events: EventPostOutbound;

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: ForumDiscordDb,
    private readonly gateway: HubForumDiscordOutboundGateway,
    private readonly settings: SettingsService,
  ) {
    this.events = new EventPostOutbound({
      db,
      gateway,
      now: () => this.now(),
      attempt: (link, run) => this.attempt(link, run),
      redrive: (link) => this.retry(link, 'thread.updated'),
      clientUrl: () => getClientUrl(settings),
      timeZone: () => settings.getDefaultTimezone(),
    });
  }

  /** §5.7 item 2: an event changed — re-drive its posts (binding-checked). */
  retitleEvent(eventId: number): Promise<void> {
    return this.events.retitle(eventId);
  }

  /** Route one change; pins are the S5 lane's (§5.5). */
  async apply(change: HubForumChange): Promise<void> {
    const job = await this.jobFor(change);
    if (typeof job === 'object') await this.dispatch(job);
  }

  /**
   * §5.6 retry: re-drive one pending/failed RL-origin link with the op the
   * sweep chose (`retryOp`). A placeholder link is re-sent, never edited.
   * `stale`/`unbound` = nothing was attempted (the sweep decides, MAJOR-3).
   */
  async retry(link: links.ForumLink, op: ForumOp): Promise<RetryOutcome> {
    const { guildId, threadId, replyId } = link;
    const change: HubForumChange = { guildId, op, threadId, actorId: 0 };
    if (replyId !== null) change.replyId = replyId;
    const job = await this.jobFor(change);
    if (typeof job !== 'object') return job;
    await this.dispatch({ ...job, link });
    return 'dispatched';
  }

  /**
   * `unbound`: no binding (or no webhook yet). `stale` (review MAJOR-2): the
   * RL thread predates the CURRENT binding, so its post (if any) lives in a
   * forum the hub no longer binds — never drive it.
   */
  private async jobFor(
    change: HubForumChange,
  ): Promise<Job | 'unbound' | 'stale'> {
    const bound = await findBinding(this.db, change.guildId);
    const webhookId = bound?.forum.webhookId;
    if (!bound || !webhookId) return 'unbound';
    const born = await syncBornAt(this.db, change.threadId, this.now());
    if (!born || born < bound.binding.boundAt) return 'stale';
    return {
      change,
      bound,
      target: { channelId: bound.forum.channelId, webhookId },
    };
  }

  private async dispatch(job: Job): Promise<void> {
    const { op } = job.change;
    if (op === 'thread.created') return this.createThread(job);
    if (op === 'reply.created') return this.createReply(job);
    if (op === 'thread.updated') return this.editThread(job);
    if (op === 'reply.updated') return this.editReply(job);
    if (op === 'thread.deleted') return this.deleteThread(job);
    if (op === 'reply.deleted') return this.deleteReply(job);
  }

  private async createThread(job: Job): Promise<void> {
    const { guildId, threadId } = job.change;
    const record = await findThread(this.db, guildId, threadId);
    if (!record || fromDiscord(record.thread)) return;
    const tagId = job.bound.binding.tagId;
    if (record.thread.eventId !== null) {
      // §5.7 item 1: never posted on creation; S6 re-sends a claimed post.
      if (job.link)
        await this.events.resend({ target: job.target, tagId }, job.link);
      return;
    }
    if (record.thread.createdAt < job.bound.binding.boundAt) return; // R8
    const link =
      job.link ?? (await links.claimThreadLink(this.db, guildId, threadId));
    if (!link) return;
    const { title, body } = record.thread;
    const [author, url] = await this.voice(record.author, {
      guildId,
      threadId,
    });
    await this.attempt(link, async () => {
      const post = {
        title: discordThreadName(title),
        content: truncateForDiscord(body, url),
        tagIds: tagId ? [tagId] : [],
      };
      const sent = await this.gateway.createPost(job.target, post, author);
      await links.markSent(this.db, link.id, sent, this.now());
      await links.rehomeReplies(this.db, threadId, sent.threadId);
    });
  }

  private async createReply(job: Job): Promise<void> {
    const { guildId, threadId, replyId } = job.change;
    if (replyId === undefined) return;
    const record = await findReply(this.db, { guildId, threadId, replyId });
    if (!record || fromDiscord(record.reply)) return;
    const parent =
      (await links.findThreadLink(this.db, threadId)) ??
      (await this.events.ensurePost(
        { target: job.target, tagId: job.bound.binding.tagId },
        { guildId, threadId },
      ));
    if (!parent || parent.discordDeletedAt) return; // OQ-5: unlinked thread
    const link =
      job.link ??
      (await links.claimReplyLink(this.db, {
        guildId,
        threadId,
        replyId,
        discordThreadId: parent.discordThreadId,
      }));
    if (!link || links.isUnsent(parent)) return; // S6 sends it after the post
    const ref = { guildId, threadId, replyId };
    const [author, url] = await this.voice(record.author, ref);
    await this.sendReply(job.target, link, parent.discordThreadId, {
      body: record.reply.body,
      url,
      author,
    });
  }

  /** Post a claimed reply link into its Discord thread; failures mark it. */
  private async sendReply(
    target: OutboundTarget,
    link: links.ForumLink,
    discordThreadId: string,
    msg: { body: string; url: string; author: OutboundAuthor },
  ): Promise<void> {
    await this.attempt(link, async () => {
      const content = truncateForDiscord(msg.body, msg.url);
      const messageId = await this.gateway.createReply(
        target,
        discordThreadId,
        content,
        msg.author,
      );
      await links.markSent(
        this.db,
        link.id,
        { threadId: discordThreadId, messageId },
        this.now(),
      );
    });
  }

  private async editThread(job: Job): Promise<void> {
    const { guildId, threadId } = job.change;
    const link = await links.findThreadLink(this.db, threadId);
    // A locked (archived) event post rejects edits (50083); reopen re-drives.
    if (!link || !this.editable(link) || link.discordLockedAt) return;
    const record = await findThread(this.db, guildId, threadId);
    if (!record) return;
    const url = await this.url({ guildId, threadId });
    const ref = {
      threadId: link.discordThreadId,
      messageId: link.discordMessageId,
    };
    const { name, content } = await this.events.postView(record.thread, url);
    await this.attempt(link, async () => {
      const edited = await this.gateway.editMessage(job.target, ref, content);
      if (edited === 'ok') {
        await this.gateway.renameThread(ref.threadId, name, () =>
          this.renames.trySpend(ref.threadId),
        );
      }
      await links.markSynced(this.db, link.id, this.now());
    });
  }

  private async editReply(job: Job): Promise<void> {
    const { guildId, threadId, replyId } = job.change;
    if (replyId === undefined) return;
    const link = await links.findReplyLink(this.db, replyId);
    if (!link || !this.editable(link)) return;
    const record = await findReply(this.db, { guildId, threadId, replyId });
    if (!record) return;
    const url = await this.url({ guildId, threadId, replyId });
    const ref = {
      threadId: link.discordThreadId,
      messageId: link.discordMessageId,
    };
    await this.attempt(link, async () => {
      await this.gateway.editMessage(
        job.target,
        ref,
        truncateForDiscord(record.reply.body, url),
      );
      await links.markSynced(this.db, link.id, this.now());
    });
  }

  /** R4: the whole post goes (bot), whichever side wrote it. */
  private async deleteThread(job: Job): Promise<void> {
    const link = await links.findThreadLink(this.db, job.change.threadId);
    if (!link || link.discordDeletedAt) return;
    await this.remove(link, () =>
      this.gateway.deleteThread(link.discordThreadId),
    );
  }

  /** §5.3: RL moderators may remove Discord-origin replies too (bot delete). */
  private async deleteReply(job: Job): Promise<void> {
    const { replyId } = job.change;
    const link =
      replyId === undefined
        ? null
        : await links.findReplyLink(this.db, replyId);
    if (!link || link.discordDeletedAt) return;
    const ref = {
      threadId: link.discordThreadId,
      messageId: link.discordMessageId,
    };
    await this.remove(link, () => this.gateway.deleteMessage(ref));
  }

  private async remove(
    link: links.ForumLink,
    run: () => Promise<DiscordWriteResult>,
  ): Promise<void> {
    await this.attempt(link, async () => {
      if (!links.isUnsent(link)) await run();
      await links.markDeleted(this.db, link.id, this.now());
    });
  }

  /** R3: only RL-origin, sent, still-present rows are pushed on edit. */
  private editable(link: links.ForumLink): boolean {
    return (
      link.origin === 'raidledger' &&
      !link.discordDeletedAt &&
      !links.isUnsent(link)
    );
  }

  private async attempt(
    link: links.ForumLink,
    run: () => Promise<void>,
  ): Promise<void> {
    try {
      await run();
    } catch (err) {
      await links.markFailed(this.db, link.id, describe(err));
      this.logger.warn(
        `Discord forum sync failed for link ${link.id}: ${describe(err)}`,
      );
    }
  }

  private async voice(
    row: HubPostPersonRow | null,
    ref: { guildId: number; threadId: number; replyId?: number },
  ): Promise<[OutboundAuthor, string]> {
    const clientUrl = await getClientUrl(this.settings);
    const person = toPerson(row);
    const author = {
      username: webhookUsername(person.displayName),
      avatarURL: absoluteAvatarUrl(person.avatarUrl, clientUrl),
    };
    return [author, forumThreadUrl(clientUrl, ref.guildId, ref)];
  }

  private async url(ref: {
    guildId: number;
    threadId: number;
    replyId?: number;
  }): Promise<string> {
    return forumThreadUrl(await getClientUrl(this.settings), ref.guildId, ref);
  }
}
