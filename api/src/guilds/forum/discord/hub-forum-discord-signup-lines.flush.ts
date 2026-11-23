/**
 * ROK-2271 C3 — the pure half of a signup-line flush: what was last POSTED
 * per member (a Redis hash next to the ROK-2260 pinged set), the lines one
 * flush posts, who leaves the thread, and how the lines are cut into
 * Discord-sized messages (one line per member, never truncated).
 */
import {
  isActiveSignup,
  signupLines,
  type SignupLine,
  type SignupLineEmoji,
  type SignupLineState,
} from './hub-forum-discord-signup-lines';
import type { SignupLineMember } from './hub-forum-discord-signup-lines.queries';
import {
  pingScopeSuffix,
  type PingedSetScope,
} from './hub-forum-discord-signup-pings';

/** Hash field marking "seeded / written by C3" — never a Discord id. */
export const SEEDED_FIELD = '_seeded';

/** The "re-sync silently" flag a confirmation reset leaves for the flush. */
export function lineResyncKey(eventId: number): string {
  return `hub-forum:signup-lines-resync:${eventId}`;
}

/** The flag while a reset's write is in flight (fix round 2). */
export const RESYNC_PENDING = 'pending';

/** A landed reset's flag: unique, so a newer reset's flag is never taken. */
export function resyncLandedValue(nonce: string): string {
  return `landed:${nonce}`;
}

/** Deletes KEYS[1] only while it still holds ARGV[1] (atomic). */
export const DEL_IF_EQUALS =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0";

/** Discord's message content cap. */
const CONTENT_MAX = 2000;
/** Discord's `allowedMentions.users` cap. */
const MENTIONS_MAX = 100;

/** What the hash keeps per member: the name we last used and the state. */
export interface PostedMember {
  name: string;
  state: SignupLineState;
}

/** What one flush does: the lines it posts, who leaves the thread. */
export interface LineFlushPlan {
  lines: SignupLine[];
  remove: string[];
}

/** One bot message: its lines and the users it may ping. */
export interface LineMessage {
  content: string;
  userIds: string[];
  lines: SignupLine[];
}

/** The Redis hash of last-posted states; same scope as the pinged set. */
export function postedLinesKey(eventId: number, scope: PingedSetScope): string {
  return `hub-forum:signup-lines:${eventId}:${pingScopeSuffix(scope)}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isPostedMember(v: unknown): v is PostedMember {
  if (!isRecord(v) || typeof v.name !== 'string') return false;
  return isRecord(v.state) && typeof v.state.status === 'string';
}

function parseOne(raw: string): PostedMember | null {
  try {
    const v: unknown = JSON.parse(raw);
    return isPostedMember(v) ? v : null;
  } catch {
    return null;
  }
}

/** The hash as members; the marker and unreadable fields are skipped. */
export function parsePosted(
  hash: Record<string, string>,
): Map<string, PostedMember> {
  const out = new Map<string, PostedMember>();
  for (const [id, raw] of Object.entries(hash)) {
    if (id === SEEDED_FIELD) continue;
    const member = parseOne(raw);
    if (member) out.set(id, member);
  }
  return out;
}

/** The hash value for a member's state now. */
export function postedValue(member: SignupLineMember): string {
  const value: PostedMember = { name: member.displayName, state: member.state };
  return JSON.stringify(value);
}

/**
 * Deploy-time seeding: a thread pinged before C3 shipped has no hash. Its
 * already-pinged members are recorded as "posted" at their current state,
 * so the first C3 flush does not announce every one of them again.
 */
export function seedFields(
  pinged: readonly string[],
  members: ReadonlyMap<string, SignupLineMember>,
): Record<string, string> {
  const fields: Record<string, string> = { [SEEDED_FIELD]: '1' };
  for (const id of pinged) {
    const member = members.get(id);
    if (member) fields[id] = postedValue(member);
  }
  return fields;
}

/** Statuses a confirmation reset moves to `signed_up` (its only effect). */
const RESET_FROM = new Set(['tentative', 'roached_out']);

/** True when a reset (not the member) moved `was` → `now` (ROK-2274 reuses it). */
export function isResetMove(was: string, now: string | undefined): boolean {
  return now === 'signed_up' && RESET_FROM.has(was);
}

/**
 * Review MAJOR-1 — after a reschedule reset, a posted member whose STATUS
 * went tentative/roached-out → signed_up (the reset's own effect) is moved
 * to it silently (role, character and late are kept, so a real change of
 * those still posts). Any other status change (a decline, a roach-out, a
 * tentative, a re-signup) is real and still posts its line (review round 3,
 * MAJOR-D1). Returns the hash fields to write.
 */
export function resyncStatusFields(
  posted: ReadonlyMap<string, PostedMember>,
  members: ReadonlyMap<string, SignupLineMember>,
): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [id, was] of posted) {
    const status = members.get(id)?.state.status;
    if (status === undefined || !isResetMove(was.state.status, status)) {
      continue;
    }
    const next: PostedMember = { ...was, state: { ...was.state, status } };
    fields[id] = JSON.stringify(next);
  }
  return fields;
}

/**
 * Lines = every member's change since their last posted state (in the
 * hash or signed up now); remove = pinged members no longer active.
 */
export function planLineFlush(
  pinged: readonly string[],
  posted: ReadonlyMap<string, PostedMember>,
  members: ReadonlyMap<string, SignupLineMember>,
  emoji: SignupLineEmoji,
): LineFlushPlan {
  const was = new Set(pinged);
  const ids = [...new Set([...posted.keys(), ...members.keys()])];
  const lines = signupLines(
    ids.map((discordId) => ({
      discordId,
      displayName:
        members.get(discordId)?.displayName ??
        posted.get(discordId)?.name ??
        discordId,
      previous: posted.get(discordId)?.state ?? null,
      current: members.get(discordId)?.state ?? null,
      mentioned: was.has(discordId),
    })),
    emoji,
  );
  const remove = pinged.filter(
    (id) => !isActiveSignup(members.get(id)?.state ?? null),
  );
  return { lines, remove };
}

/**
 * The lines as bot messages, one line each, split only where 2000 chars
 * or 100 mentions force it. A line is never cut or dropped.
 */
export function lineMessages(lines: readonly SignupLine[]): LineMessage[] {
  const out: LineMessage[] = [];
  let cur: LineMessage | null = null;
  for (const line of lines) {
    const full =
      cur !== null &&
      (cur.content.length + 1 + line.content.length > CONTENT_MAX ||
        (line.mention && cur.userIds.length >= MENTIONS_MAX));
    if (cur === null || full) {
      cur = { content: line.content, userIds: [], lines: [] };
      out.push(cur);
    } else {
      cur.content += `\n${line.content}`;
    }
    cur.lines.push(line);
    if (line.mention) cur.userIds.push(line.discordId);
  }
  return out;
}
