/**
 * ROK-2272 S10 (R5) — pure half of the poll voter ping: a voter's first
 * committed vote on a poll pings them once into the poll's Discord post
 * (`🗳 <@id> voted`), which is what adds them to the post (Discord thread
 * rule). The once-key is per post scope + user, so a re-created post pings
 * each voter again on their next vote (plan A4).
 *
 * ROK-2295 lane C — the line lists the slots the voter holds (`yes` votes;
 * a `no` is a decline and is not listed) as Discord timestamps, and is
 * edited in place when they change. Its message id is kept in a Redis hash
 * per Discord post (field = user id), so a re-created post starts fresh.
 */
import { formatSlotTimestamp } from '../../../discord-bot/services/discord-embed-scheduling.helpers';

/** Same glyph as the poll embed's author line (U+1F5F3, no VS16). */
export const VOTER_PING_COPY = { emoji: '\u{1F5F3}', text: 'voted' } as const;

/** A claimed voter once-key outlives any poll by far. */
export const VOTER_ONCE_TTL_SECONDS = 30 * 24 * 3600;

/** Which post a ping lands in: a hub thread's post or a registry post. */
export type VoterPingScope =
  { hubThreadId: number } | { planningPostId: number };

/** Why a voter ping did or did not go out. */
export type VoterPingOutcome =
  | 'pinged'
  | 'cleared'
  | 'no-post'
  | 'closed-post'
  | 'pending'
  | 'unlinked'
  | 'offline'
  | 'already'
  | 'send-failed';

/** `hub:<threadId>` / `planning:<postId>` — disjoint by construction. */
export function voterScopeKey(scope: VoterPingScope): string {
  if ('hubThreadId' in scope) return `hub:${scope.hubThreadId}`;
  return `planning:${scope.planningPostId}`;
}

/** Redis key that lets exactly one vote ping `userId` into a post. */
export function voterOnceKey(scope: VoterPingScope, userId: number): string {
  return `hfd:voter:${voterScopeKey(scope)}:${userId}`;
}

/** A voted line lists at most this many slots, then `+N more`. */
export const VOTER_LINE_MAX_SLOTS = 8;

/**
 * The voted line, e.g. `🗳 <@123> voted: <t:1700000000:f>, <t:…:f> +1 more`
 * (`slots` = ISO times, ascending); none left ⇒ `… voted: no times right now`.
 */
export function voterLine(discordId: string, slots: readonly string[]): string {
  const head = `${VOTER_PING_COPY.emoji} <@${discordId}> ${VOTER_PING_COPY.text}:`;
  if (slots.length === 0) return `${head} no times right now`;
  const shown = slots.slice(0, VOTER_LINE_MAX_SLOTS).map(formatSlotTimestamp);
  const rest = slots.length - VOTER_LINE_MAX_SLOTS;
  const more = rest > 0 ? ` +${rest} more` : '';
  return `${head} ${shown.join(', ')}${more}`;
}

/** Redis hash of one Discord post's voted lines (field = RL user id). */
export function voterLinesKey(discordThreadId: string): string {
  return `hfd:voter-lines:${discordThreadId}`;
}

/** One hash field: the line's message and the slots it currently shows. */
export interface StoredVoterLine {
  messageId: string;
  discordId: string;
  slots: string[];
}

function isStoredLine(v: unknown): v is StoredVoterLine {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.messageId === 'string' &&
    typeof o.discordId === 'string' &&
    Array.isArray(o.slots) &&
    o.slots.every((t) => typeof t === 'string')
  );
}

/** A hash field's value, or null when it is not one we wrote. */
export function parseVoterLine(raw: string): StoredVoterLine | null {
  try {
    const v: unknown = JSON.parse(raw);
    return isStoredLine(v) ? v : null;
  } catch {
    return null;
  }
}

/** `HGETALL` of a post's hash ⇒ user id → stored line (bad fields skipped). */
export function storedVoterLines(
  hash: Record<string, string>,
): Map<number, StoredVoterLine> {
  const out = new Map<number, StoredVoterLine>();
  for (const [field, raw] of Object.entries(hash)) {
    const userId = Number(field);
    const line = parseVoterLine(raw);
    if (Number.isInteger(userId) && line) out.set(userId, line);
  }
  return out;
}

/** Same slots in the same order (both lists are read ascending). */
export function sameSlots(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((t, i) => t === b[i]);
}

/** A real Discord snowflake; `local:` / `unlinked:` / null are not linked. */
export function linkedDiscordId(raw: string | null): string | null {
  return raw !== null && /^\d+$/.test(raw) ? raw : null;
}
