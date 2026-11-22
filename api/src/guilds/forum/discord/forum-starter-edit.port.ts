/**
 * ROK-2292 D4 — the forum side of the event embed edit seam. The bot's
 * `EventEmbedMessageEditor` hands every forum-starter row here (token
 * `FORUM_STARTER_EDIT_PORT`, bound in `HubForumDiscordModule`), and the
 * outbound gateway edits the starter as whoever authored it: the hub webhook
 * for a hub event post, the bot for an event-planning post.
 *
 * - The author and the hub binding guard come from our records
 *   (`findStarterPost`): an unlinked/rebound hub's old post is `'gone'`.
 * - Review MAJOR — archived ≠ gone: forum posts auto-archive when idle, and
 *   an event post exists from announce. A 50083 on a post our records say is
 *   NOT locked unarchives it and retries once; a locked post's 50083 is
 *   rethrown, and the editor drops its row (D7).
 */
import { Inject, Injectable } from '@nestjs/common';
import type {
  ForumStarterCard,
  ForumStarterEditPort,
} from '../../../discord-bot/services/event-embed-message.editor';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import { findStarterPost, type StarterPost } from './forum-starter-edit.target';
import {
  HubForumDiscordOutboundGateway,
  isArchivedError,
} from './hub-forum-discord-outbound.discord';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

@Injectable()
export class ForumStarterEditor implements ForumStarterEditPort {
  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: ForumDiscordDb,
    private readonly gateway: HubForumDiscordOutboundGateway,
  ) {}

  async editStarter(
    threadId: string,
    card: ForumStarterCard,
  ): Promise<'edited' | 'gone'> {
    const post = await findStarterPost(this.db, threadId);
    if (post === 'gone') return 'gone';
    try {
      return await this.editOnce(threadId, card, post);
    } catch (err) {
      if (!isArchivedError(err) || post.locked) throw err;
      if (!(await this.gateway.unarchiveThread(threadId))) throw err;
    }
    return this.editOnce(threadId, card, post);
  }

  private async editOnce(
    threadId: string,
    card: ForumStarterCard,
    post: StarterPost,
  ): Promise<'edited' | 'gone'> {
    const res = await this.gateway.editStarterCard(threadId, card, post.author);
    return res === 'ok' ? 'edited' : 'gone';
  }
}
