/**
 * ROK-2292 — what our records say about the forum post behind a starter row,
 * before the port edits it:
 *
 * - an event-planning (registry) post → the bot authored the starter;
 * - a hub post link → the bound hub's webhook authored it, but ONLY while the
 *   link belongs to the hub's CURRENT binding (Codex P2). That is the same
 *   rule `HubForumDiscordOutboundService.jobFor` enforces — a binding with a
 *   webhook (`findBinding`) and a post no older than `bound_at`
 *   (`isCurrentBindingLink`) — so unlinking or rebinding a hub stops the card
 *   sync on its old posts too.
 *
 * `locked` is true once we locked or lost the post: an archived post is only
 * unarchived and retried when it is NOT locked (review MAJOR).
 */
import { and, eq } from 'drizzle-orm';
import * as schema from '../../../drizzle/schema';
import { isCurrentBindingLink } from './hub-forum-discord-links.queries';
import type { StarterAuthor } from './hub-forum-discord-outbound.discord';
import { findBinding, type ForumDiscordDb } from './hub-forum-discord.queries';

/** A post the starter card may be edited on. */
export interface StarterPost {
  author: StarterAuthor;
  locked: boolean;
}

const posts = schema.eventPlanningPosts;
const links = schema.hubForumDiscordLinks;

type Stamps = { discordLockedAt: Date | null; discordDeletedAt: Date | null };

const isClosed = (row: Stamps): boolean =>
  row.discordLockedAt !== null || row.discordDeletedAt !== null;

async function registryPost(
  db: ForumDiscordDb,
  discordThreadId: string,
): Promise<StarterPost | null> {
  const [row] = await db
    .select({
      discordLockedAt: posts.discordLockedAt,
      discordDeletedAt: posts.discordDeletedAt,
    })
    .from(posts)
    .where(eq(posts.discordThreadId, discordThreadId))
    .limit(1);
  return row ? { author: { kind: 'bot' }, locked: isClosed(row) } : null;
}

async function hubPost(
  db: ForumDiscordDb,
  discordThreadId: string,
): Promise<StarterPost | 'gone'> {
  const [link] = await db
    .select()
    .from(links)
    .where(
      and(eq(links.discordThreadId, discordThreadId), eq(links.kind, 'thread')),
    )
    .limit(1);
  // A Discord-authored post's starter is a member's message: never ours.
  if (!link || link.origin !== 'raidledger') return 'gone';
  const bound = await findBinding(db, link.guildId);
  const webhookId = bound?.forum.webhookId;
  if (!bound || !webhookId) return 'gone';
  if (!(await isCurrentBindingLink(db, link))) return 'gone';
  const target = { channelId: bound.forum.channelId, webhookId };
  return { author: { kind: 'webhook', target }, locked: isClosed(link) };
}

/** The post behind `discordThreadId`, or `'gone'` when we may not edit it. */
export async function findStarterPost(
  db: ForumDiscordDb,
  discordThreadId: string,
): Promise<StarterPost | 'gone'> {
  const registry = await registryPost(db, discordThreadId);
  return registry ?? hubPost(db, discordThreadId);
}
