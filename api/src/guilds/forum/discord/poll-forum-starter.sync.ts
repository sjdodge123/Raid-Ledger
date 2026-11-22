/**
 * ROK-2295 lane B — keeps a scheduling poll's forum post opening with the
 * live poll embed. `SchedulingPollEmbedService.syncEmbed` resolves this
 * through `POLL_FORUM_STARTER_PORT` on every coalesced card re-render (so a
 * vote burst is one starter edit), and hands the card it just rendered.
 *
 * The post is found from rows we already keep (a forum post's starter id IS
 * its thread id): the hub post link of the poll's live RL thread, else the
 * poll's live event-planning registry post. The edit goes through ROK-2292's
 * `ForumStarterEditor`, which picks the author (hub webhook / bot), unarchives
 * an idle unlocked post, and reports `'gone'`. A locked post's 50083 is
 * swallowed here: the post is closed, so there is nothing left to keep live.
 *
 * ROK-2295 lane C: the same job then re-words the post's voted lines
 * (`PollVoterLines`) — even when the starter edit throws.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ForumStarterCard } from '../../../discord-bot/services/event-embed-message.editor';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import type { PollForumStarterPort } from '../../../lineups/scheduling/poll-forum-starter.port';
import { findLivePollThread } from '../subject-discussion/poll-discussion.queries';
import { findLivePlanningPost } from './event-planning-posts.queries';
import { ForumStarterEditor } from './forum-starter-edit.port';
import { findThreadLink, isUnsent } from './hub-forum-discord-links.queries';
import { isArchivedError } from './hub-forum-discord-outbound.discord';
import type { ForumDiscordDb } from './hub-forum-discord.queries';
import { PollVoterLines } from './poll-voter-lines.refresh';

/**
 * The Discord thread id of the poll's live forum post, or null: the hub
 * post (sent, not deleted) of its live RL thread first, else its live
 * event-planning post. Lane C's voter-line refresh reads the same post.
 */
export async function findPollPostThreadId(
  db: ForumDiscordDb,
  matchId: number,
): Promise<string | null> {
  const thread = await findLivePollThread(db, matchId);
  if (thread) {
    const link = await findThreadLink(db, thread.id);
    if (!link || isUnsent(link) || link.discordDeletedAt) return null;
    return link.discordThreadId;
  }
  const post = await findLivePlanningPost(db, 'poll', matchId);
  if (!post || post.discordDeletedAt) return null;
  return post.discordThreadId;
}

@Injectable()
export class PollForumStarterSync implements PollForumStarterPort {
  private readonly logger = new Logger(PollForumStarterSync.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: ForumDiscordDb,
    private readonly editor: ForumStarterEditor,
    private readonly voterLines: PollVoterLines,
  ) {}

  async syncStarter(matchId: number, card: ForumStarterCard): Promise<void> {
    const threadId = await findPollPostThreadId(this.db, matchId);
    if (threadId === null) return;
    let gone = false;
    try {
      gone = (await this.editStarter(matchId, threadId, card)) === 'gone';
    } finally {
      // Codex P2: a 'gone' post (stale or unbound hub, deleted post) is no
      // longer ours to drive — its voted lines are left alone too.
      if (!gone) await this.voterLines.refreshVoterLines(matchId, threadId);
    }
  }

  /** One starter edit; a locked (archived) post is logged, never thrown. */
  private async editStarter(
    matchId: number,
    threadId: string,
    card: ForumStarterCard,
  ): Promise<'edited' | 'gone' | 'locked'> {
    try {
      return await this.editor.editStarter(threadId, card);
    } catch (err) {
      if (!isArchivedError(err)) throw err;
      this.logger.log(
        `Poll ${matchId} post ${threadId} is locked; starter left as is`,
      );
      return 'locked';
    }
  }
}
