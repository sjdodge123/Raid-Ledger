/**
 * ROK-1868 L2 — pure hub-post helpers: the opaque keyset cursor, the post
 * deep link and the row → `HubPost` mapping. No DB, no Nest services.
 */
import { BadRequestException } from '@nestjs/common';
import type {
  HubPost,
  HubPostPerson,
  HubPostRelay,
} from '@raid-ledger/contract';
import type { HubPostSelect } from '../../drizzle/schema/hub-posts';

/**
 * Keyset position: `(created_at DESC, id DESC)`. `createdAt` is the DB's
 * full-precision UTC ISO text (up to µs) — a JS `Date` would round `now()`
 * rows to ms and make the raw-column comparison skip or repeat rows.
 */
export interface HubPostCursor {
  createdAt: string;
  id: number;
}

/** The `users` columns a post needs for its author / editor. */
export interface HubPostPersonRow {
  userId: number;
  username: string;
  displayName: string | null;
  avatar: string | null;
  customAvatarUrl: string | null;
  discordId: string | null;
}

/** Author + last editor of one post; null once the user is wiped. */
export interface HubPostPeople {
  author: HubPostPersonRow | null;
  editor: HubPostPersonRow | null;
}

const INVALID_CURSOR = 'Invalid cursor';

/** UTC ISO-8601 with 0–6 fractional digits (what `to_char(... .US)` emits). */
const CURSOR_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

/** Opaque base64url of `<createdAtISO>|<id>`. */
export function encodeCursor(pos: HubPostCursor): string {
  return Buffer.from(`${pos.createdAt}|${pos.id}`).toString('base64url');
}

/** Parse a cursor from `encodeCursor`; anything else is a 400. */
export function decodeCursor(cursor: string): HubPostCursor {
  const raw = Buffer.from(cursor, 'base64url').toString('utf8');
  const parts = raw.split('|');
  const [iso, idText] = parts;
  if (parts.length !== 2 || iso === undefined || idText === undefined) {
    throw new BadRequestException(INVALID_CURSOR);
  }
  const validAt =
    CURSOR_ISO.test(iso) && !Number.isNaN(new Date(iso).getTime());
  if (!/^[1-9]\d{0,9}$/.test(idText) || !validAt) {
    throw new BadRequestException(INVALID_CURSOR);
  }
  return { createdAt: iso, id: Number(idText) };
}

/** `${clientUrl}/guilds/<id>?post=<postId>#posts` — the Posts-tab deep link. */
export function postDeepLink(
  clientUrl: string,
  guildId: number,
  postId: number,
): string {
  const base = clientUrl.replace(/\/+$/, '');
  return `${base}/guilds/${guildId}?post=${postId}#posts`;
}

/** Custom upload, else an absolute avatar, else the Discord CDN url. */
export function personAvatarUrl(row: HubPostPersonRow): string | null {
  if (row.customAvatarUrl) return row.customAvatarUrl;
  if (!row.avatar) return null;
  if (/^https?:\/\//i.test(row.avatar)) return row.avatar;
  if (!row.discordId) return null;
  return `https://cdn.discordapp.com/avatars/${row.discordId}/${row.avatar}.png`;
}

function toPerson(row: HubPostPersonRow | null): HubPostPerson {
  if (!row) return { userId: null, displayName: null, avatarUrl: null };
  return {
    userId: row.userId,
    displayName: row.displayName ?? row.username,
    avatarUrl: personAvatarUrl(row),
  };
}

function toRelay(
  post: HubPostSelect,
  discordGuildId: string | null,
): HubPostRelay | null {
  const { relayChannelId: channelId, relayMessageId: messageId } = post;
  if (!channelId || !messageId || !post.relayedAt) return null;
  const messageUrl = discordGuildId
    ? `https://discord.com/channels/${discordGuildId}/${channelId}/${messageId}`
    : null;
  return { channelId, messageUrl, relayedAt: post.relayedAt.toISOString() };
}

/** Map a `hub_posts` row + its people to the contract shape. */
export function toHubPost(
  post: HubPostSelect,
  people: HubPostPeople,
  discordGuildId: string | null,
): HubPost {
  return {
    id: post.id,
    guildId: post.guildId,
    body: post.body,
    author: toPerson(people.author),
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
    editedBy: post.updatedBy === null ? null : toPerson(people.editor),
    relay: toRelay(post, discordGuildId),
  };
}
