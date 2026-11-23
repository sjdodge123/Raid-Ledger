/**
 * ROK-2295 lane B — the scheduling side of the poll forum-starter seam.
 * `SchedulingPollEmbedService.syncEmbed` hands every re-rendered poll card
 * here, so a poll's forum post (hub or event-planning) keeps opening with
 * the live poll embed. Bound by `HubForumDiscordModule` and resolved lazily
 * (`moduleRef.get(token, { strict: false })`), like ROK-2292's
 * `FORUM_STARTER_EDIT_PORT`: no module import cycle.
 */
import type { ForumStarterCard } from '../../discord-bot/services/event-embed-message.editor';

/** Edits a poll's forum-post starter to the current poll card. */
export interface PollForumStarterPort {
  /**
   * Edit the starter of the poll's live forum post to `card` (content `''`).
   * No post ⇒ nothing. Best effort: the caller catches and logs a throw.
   */
  syncStarter(matchId: number, card: ForumStarterCard): Promise<void>;
}

/** DI token of the {@link PollForumStarterPort} implementation. */
export const POLL_FORUM_STARTER_PORT = 'POLL_FORUM_STARTER_PORT';
