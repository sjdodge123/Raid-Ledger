/**
 * ROK-2208 §5.7 items 1, 2, 5 — the outbound half of event threads. Owned by
 * `HubForumDiscordOutboundService` (shares its gateway, rename budget and
 * failure bookkeeping), so it is a plain class, not a Nest provider.
 *
 * 1. Lazy post: an event thread gets its Discord post only when its first
 *    live RL reply goes out — titled "<event> — <short date>", body = the
 *    2226 root text. Nothing is posted at schedule time.
 * 2. Retitle: an event update re-drives each live post as `thread.updated`
 *    through the owner (binding + stale checks, rename budget, D9 / MAJOR-1).
 * 5. A read-only (closed or detached) event thread never posts.
 */
import {
  discordThreadName,
  forumThreadUrl,
  truncateForDiscord,
} from './hub-forum-discord-content';
import {
  eventPostBody,
  eventPostTitle,
  eventThreadReadOnly,
} from './hub-forum-discord-event-outbound';
import {
  findEventHeading,
  findEventPostSource,
  liveEventPostLinks,
  type EventPostSource,
} from './hub-forum-discord-event-outbound.queries';
import * as links from './hub-forum-discord-links.queries';
import type {
  HubForumDiscordOutboundGateway,
  OutboundAuthor,
  OutboundTarget,
} from './hub-forum-discord-outbound.discord';
import { FORUM_WEBHOOK_NAME } from './hub-forum-discord.helpers';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

/** What the owning outbound service lends. */
export interface EventPostDeps {
  db: ForumDiscordDb;
  gateway: Pick<HubForumDiscordOutboundGateway, 'createPost'>;
  /** The trusted client URL (`getClientUrl`). */
  clientUrl: () => Promise<string>;
  /** The community default timezone (`DEFAULT_TIMEZONE`), null when unset. */
  timeZone: () => Promise<string | null>;
  now: () => Date;
  /** Run a Discord write; a throw marks the link failed (S6 retries it). */
  attempt: (link: links.ForumLink, run: () => Promise<void>) => Promise<void>;
  /**
   * Re-drive one post as `thread.updated` through the owner's binding-checked
   * job path (unbound / stale ⇒ nothing; locked ⇒ skipped until reopened).
   */
  redrive: (link: links.ForumLink) => Promise<unknown>;
}

/** Where a post goes: the bound forum and the hub's shared tag, if any. */
export interface EventPostTarget {
  target: OutboundTarget;
  tagId: string | null;
}

/** The root is a system post: the webhook speaks as Raid Ledger. */
const ROOT_AUTHOR: OutboundAuthor = {
  username: FORUM_WEBHOOK_NAME,
  avatarURL: null,
};

/** A thread row as far as its Discord post title/body go. */
interface ThreadText {
  eventId: number | null;
  title: string;
  body: string;
}

export class EventPostOutbound {
  constructor(private readonly deps: EventPostDeps) {}

  /** The dated post title for `eventId`; null once the event is gone. */
  async title(eventId: number): Promise<string | null> {
    const heading = await findEventHeading(this.deps.db, eventId);
    if (!heading) return null;
    const zone = await this.deps.timeZone();
    return eventPostTitle(heading.title, heading.start, zone);
  }

  /** The post name + starter content of any thread (plain or event). */
  async postView(
    thread: ThreadText,
    url: string,
  ): Promise<{ name: string; content: string }> {
    const dated =
      thread.eventId === null ? null : await this.title(thread.eventId);
    if (dated === null) {
      return {
        name: discordThreadName(thread.title),
        content: truncateForDiscord(thread.body, url),
      };
    }
    const clientUrl = await this.deps.clientUrl();
    const content = truncateForDiscord(
      eventPostBody(thread.body, clientUrl),
      url,
    );
    return { name: dated, content };
  }

  /**
   * Item 1 — the post link a reply on `threadId` goes into. Null for a plain
   * (unlinked, OQ-5) thread and for a read-only event thread (item 5);
   * otherwise claims the post and sends it (a race loser reuses the winner's).
   * ROK-2260: `create: false` only reads the existing post (a signup removal).
   */
  async ensurePost(
    to: EventPostTarget,
    ref: { guildId: number; threadId: number; create?: boolean },
  ): Promise<links.ForumLink | null> {
    const { db } = this.deps;
    if (ref.create === false) return links.findThreadLink(db, ref.threadId);
    const src = await findEventPostSource(db, ref.threadId);
    if (!src || eventThreadReadOnly(src, this.deps.now())) return null;
    const claimed = await links.claimThreadLink(db, ref.guildId, ref.threadId);
    if (claimed) await this.send(to, claimed, src);
    return links.findThreadLink(db, ref.threadId);
  }

  /** S6: re-send a claimed, still-unsent event post (never while read-only). */
  async resend(to: EventPostTarget, link: links.ForumLink): Promise<void> {
    const src = await findEventPostSource(this.deps.db, link.threadId);
    if (!src || eventThreadReadOnly(src, this.deps.now())) return;
    await this.send(to, link, src);
  }

  /**
   * Item 2 — re-drive the event's live posts so each picks up the current
   * dated title and starter text. Never renames directly: an unbound or
   * re-bound hub's old post is left alone (D9, review MAJOR-1).
   */
  async retitle(eventId: number): Promise<void> {
    const posts = await liveEventPostLinks(this.deps.db, eventId);
    for (const link of posts) await this.deps.redrive(link);
  }

  private async send(
    to: EventPostTarget,
    link: links.ForumLink,
    src: EventPostSource,
  ): Promise<void> {
    const { db, gateway } = this.deps;
    const zone = await this.deps.timeZone();
    const clientUrl = await this.deps.clientUrl();
    const url = forumThreadUrl(clientUrl, link.guildId, {
      threadId: link.threadId,
    });
    const post = {
      title: eventPostTitle(src.eventTitle, src.start, zone),
      content: truncateForDiscord(eventPostBody(src.body, clientUrl), url),
      tagIds: to.tagId ? [to.tagId] : [],
      event: true, // ROK-2258: the gateway adds the forum's Event tag
    };
    await this.deps.attempt(link, async () => {
      const sent = await gateway.createPost(to.target, post, ROOT_AUTHOR);
      await links.markSent(db, link.id, sent, this.deps.now());
      await links.rehomeReplies(db, link.threadId, sent.threadId);
    });
  }
}
