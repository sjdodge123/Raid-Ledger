/**
 * ROK-2260 — the pure half of "an event's signups are @mentioned into its
 * Discord post": who is eligible, who is new since the last flush, and how
 * one roll-up mention is cut to Discord's message limits.
 *
 * Operator rulings 2026-11-18: signed_up + tentative are pinged (bench rows
 * are `signed_up`, so they are too); linked AND anonymous Discord signups;
 * a cancel drops the user from the pinged set so a re-signup pings again.
 */
import { linkedDiscordIds } from '../../../discord-bot/lfg-board/lfg-board-thread-members.helpers';

/** Debounce window: the flush runs this long after the event's LAST change. */
export const SIGNUP_PING_DEBOUNCE_MS = 2 * 60 * 1000;

/** The opening words of a roll-up mention. */
export const MENTION_PREFIX = 'Signed up:';

/** Discord's message content cap. */
const CONTENT_MAX = 2000;
/** Discord's `allowedMentions.users` cap. */
const MENTIONS_MAX = 100;

const ELIGIBLE = new Set(['signed_up', 'tentative']);

/** A signup row as far as pinging goes. */
export interface SignupPingRow {
  status: string;
  /** `users.discord_id` of a linked signup (may be `local:` / `unlinked:`). */
  userDiscordId: string | null;
  /** `event_signups.discord_user_id` of an anonymous Discord signup. */
  discordUserId: string | null;
}

/** What one flush does: who gets @mentioned, who leaves the thread. */
export interface SignupPingPlan {
  ping: string[];
  remove: string[];
}

/** One roll-up bot message and the users it may ping. */
export interface MentionMessage {
  content: string;
  userIds: string[];
}

/** Rulings 4: signed_up and tentative are pinged; every other status is not. */
export function isPingEligible(status: string): boolean {
  return ELIGIBLE.has(status);
}

/** The distinct real Discord ids of the eligible signups, first-seen order. */
export function signupPingDiscordIds(rows: readonly SignupPingRow[]): string[] {
  const discordIds = rows
    .filter((row) => isPingEligible(row.status))
    .map((row) => ({ discordId: row.userDiscordId ?? row.discordUserId }));
  return linkedDiscordIds(discordIds);
}

/** New = eligible but not yet pinged; gone = pinged but no longer eligible. */
export function diffPings(
  eligible: readonly string[],
  pinged: readonly string[],
): SignupPingPlan {
  const was = new Set(pinged);
  const now = new Set(eligible);
  return {
    ping: eligible.filter((id) => !was.has(id)),
    remove: pinged.filter((id) => !now.has(id)),
  };
}

/**
 * The roll-up mention(s) for `userIds`: one message when they fit, split
 * only where 2000 chars or 100 mentions force it. Nobody is dropped.
 */
export function mentionMessages(userIds: readonly string[]): MentionMessage[] {
  const out: MentionMessage[] = [];
  let current: MentionMessage | null = null;
  for (const id of userIds) {
    const tag = ` <@${id}>`;
    const full =
      current !== null &&
      (current.userIds.length >= MENTIONS_MAX ||
        current.content.length + tag.length > CONTENT_MAX);
    if (current === null || full) {
      current = { content: MENTION_PREFIX, userIds: [] };
      out.push(current);
    }
    current.content += tag;
    current.userIds.push(id);
  }
  return out;
}

/**
 * The per-event BullMQ job id of the debounced flush (`-`, never `:` —
 * BullMQ rejects `:` in custom ids, ROK-1512). `trail` = the job queued
 * behind a flush already running.
 */
export function signupPingJobId(eventId: number, trail = false): string {
  return `forum-signup-pings-${eventId}${trail ? '-trail' : ''}`;
}

/**
 * What an event's post belongs to (scopes the pinged set): the hub thread,
 * or (ROK-2272 S4b) a non-hub event's registry post — null before the first
 * line creates it.
 */
export type PingedSetScope =
  { guildId: number; threadId: number } | { planningPostId: number | null };

/** The scope's key suffix; the hub form is unchanged since ROK-2260. */
export function pingScopeSuffix(scope: PingedSetScope): string {
  if ('planningPostId' in scope) {
    return `planning:${scope.planningPostId ?? 'new'}`;
  }
  return `${scope.guildId}:${scope.threadId}`;
}

/**
 * The Redis set of Discord ids already pinged into the event's post. Scoped
 * to the hub thread (Codex P2-4): a retag to another hub is a new post, so
 * its players are pinged again; the old set just expires. A re-created
 * registry post (new row id) is likewise a fresh set.
 */
export function pingedSetKey(eventId: number, scope: PingedSetScope): string {
  return `hub-forum:signup-pings:${eventId}:${pingScopeSuffix(scope)}`;
}
