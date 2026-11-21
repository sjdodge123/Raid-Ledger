/**
 * ROK-2208 §5.2 — pure mapping from an RL forum row to what the webhook sends:
 * the 2000-char cut with the "read the rest" link (R6), the 100-char post
 * title, the webhook username rules and an absolute avatar URL.
 */
import type { HubForumReplyKind } from '@raid-ledger/contract';
import { DISCORD_THREAD_NAME_MAX } from '../../../discord-bot/lfg-board/lfg-board.constants';

/** Discord's message content limit. */
export const DISCORD_MESSAGE_MAX = 2000;
/** Discord's webhook username limit (UNVERIFIED in §2.3; 80 per the API docs). */
export const WEBHOOK_USERNAME_MAX = 80;
/** Used when the RL name is empty or breaks Discord's webhook name rules. */
export const WEBHOOK_FALLBACK_USERNAME = 'Raid Ledger member';
/** R6 link line prefix. */
export const READ_MORE_PREFIX = '… read the rest on Raid Ledger: ';

const FORBIDDEN_USERNAME = /discord|clyde/i;
const ABSOLUTE = /^https?:\/\//i;

/** The deep link to a thread (optionally a reply) on the hub's Forum tab. */
export function forumThreadUrl(
  clientUrl: string,
  guildId: number,
  ref: { threadId: number; replyId?: number },
): string {
  const base = clientUrl.replace(/\/+$/, '');
  const reply = ref.replyId === undefined ? '' : `&reply=${ref.replyId}`;
  return `${base}/hubs/${guildId}?thread=${ref.threadId}${reply}#forum`;
}

/** Drop a dangling high surrogate a hard cut may leave behind. */
function dropLoneSurrogate(text: string): string {
  const last = text.charCodeAt(text.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? text.slice(0, -1) : text;
}

/** Cut at the last paragraph, else word, boundary in the back half of `max`. */
export function cutAtBoundary(text: string, max: number): string {
  const head = text.slice(0, Math.max(0, max));
  if (text.length <= max) return head;
  const para = head.lastIndexOf('\n\n');
  if (para >= max / 2) return head.slice(0, para).trimEnd();
  const word = Math.max(head.lastIndexOf(' '), head.lastIndexOf('\n'));
  if (word >= max / 2) return head.slice(0, word).trimEnd();
  return dropLoneSurrogate(head);
}

/**
 * R6: a body over 2000 chars is cut so the result, link line included, is at
 * most 2000 chars. Shorter bodies pass through unchanged.
 */
export function truncateForDiscord(body: string, url: string): string {
  if (body.length <= DISCORD_MESSAGE_MAX) return body;
  const tail = `\n\n${READ_MORE_PREFIX}${url}`;
  return `${cutAtBoundary(body, DISCORD_MESSAGE_MAX - tail.length)}${tail}`;
}

/** The forum post title: trimmed, ≤100 chars, never empty. */
export function discordThreadName(title: string): string {
  const name = cutAtBoundary(title.trim(), DISCORD_THREAD_NAME_MAX);
  return name.length > 0 ? name : 'Untitled thread';
}

/** The webhook username: the RL display name if Discord accepts it. */
export function webhookUsername(name: string | null): string {
  const trimmed = (name ?? '').trim().slice(0, WEBHOOK_USERNAME_MAX).trim();
  if (trimmed.length === 0 || FORBIDDEN_USERNAME.test(trimmed)) {
    return WEBHOOK_FALLBACK_USERNAME;
  }
  return trimmed;
}

/** An avatar Discord can fetch: absolute as-is, root-relative on the client URL. */
export function absoluteAvatarUrl(
  url: string | null,
  clientUrl: string,
): string | null {
  if (!url) return null;
  if (ABSOLUTE.test(url)) return url;
  if (!url.startsWith('/') || !ABSOLUTE.test(clientUrl)) return null;
  return `${clientUrl.replace(/\/+$/, '')}${url}`;
}

/**
 * Rows the inbound lane wrote carry a Discord author: never echo them out.
 * ROK-2274 sync loop 1: a signup line (system text) is never mirrored either.
 */
export function notMirrored(row: {
  authorDiscordId: string | null;
  kind?: HubForumReplyKind;
}): boolean {
  return row.authorDiscordId !== null || row.kind === 'signup_line';
}
