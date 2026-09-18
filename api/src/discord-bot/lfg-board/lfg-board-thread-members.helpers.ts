/**
 * ROK-1541 — the pure half of "every LFG group member is a member of the
 * group's forum thread", so the post sits in their Discord sidebar.
 *
 * AC3 is structural, and it lives in {@link planMembershipChange}: a change
 * moves ONLY the users it names (the joiner, the withdrawer), never "the
 * roster". Re-deriving adds from the whole roster on every event would re-add
 * a member who deliberately left the thread the next time anybody else joined.
 * The one whole-roster add is the post itself (`THREAD_MIRROR_EVENTS.BOUND`).
 */
import type { LfgGroupChangedReason } from '../../lfg/lfg.constants';
import { describeError, isPermanentRefusal } from './lfg-board-retire.helpers';

/** Discord's hard cap on members of one thread. */
export const THREAD_MEMBER_CAP = 1000;

/** Whether a batch joins users to the thread or takes them out. */
export type ThreadMemberOp = 'add' | 'remove';

/** The users one membership change moves, and which way. */
export interface ThreadMemberPlan {
  kind: ThreadMemberOp;
  userIds: number[];
}

/** The slice of a discord.js `ThreadChannel` a batch touches. */
export interface ThreadMemberTarget {
  id: string;
  memberCount: number | null;
  members: {
    add(member: string): Promise<unknown>;
    remove(member: string): Promise<unknown>;
  };
}

/** Discord codes meaning "that user is not (or cannot be) a member" on remove. */
const NOT_A_MEMBER_CODES = new Set([10007, 10013]);

/**
 * Which users a group change moves in or out of the thread.
 *
 * @param reason - Why the group changed. Only joins and withdrawals move users.
 * @param userIds - The users the change is ABOUT, as the emitter named them.
 * @param roster - The live group's user ids, read after the change.
 * @returns The plan, or null when nobody moves.
 */
export function planMembershipChange(
  reason: LfgGroupChangedReason,
  userIds: readonly number[],
  roster: ReadonlySet<number>,
): ThreadMemberPlan | null {
  if (reason === 'joined' && userIds.length > 0) {
    return { kind: 'add', userIds: [...userIds] };
  }
  if (reason !== 'withdrawn') return null;
  // AC2 — only someone who WAS in the group and no longer is. A chatter who
  // joined the thread by hand is never named by a withdrawal, so is never here.
  const gone = userIds.filter((id) => !roster.has(id));
  return gone.length > 0 ? { kind: 'remove', userIds: gone } : null;
}

/**
 * The real Discord snowflakes among a set of user rows.
 *
 * @param rows - `users.discord_id` values; `local:` / `unlinked:` are not ids.
 * @returns Distinct linked ids, in first-seen order.
 */
export function linkedDiscordIds(
  rows: readonly { discordId: string | null }[],
): string[] {
  const ids = rows
    .map((row) => row.discordId)
    .filter((id): id is string => !!id && /^\d+$/.test(id));
  return [...new Set(ids)];
}

/**
 * Apply one batch of thread-member adds or removes.
 *
 * Never throws and warns at most ONCE per batch (AC5): a board with a revoked
 * grant must not turn every +1 into a log storm. A permanent refusal (thread
 * gone, Missing Access) ends the batch — every later call would fail the same.
 *
 * @param thread - The forum post.
 * @param op - Add or remove.
 * @param discordIds - Linked Discord ids to move.
 * @param warn - The caller's warning sink.
 */
export async function applyThreadMembers(
  thread: ThreadMemberTarget,
  op: ThreadMemberOp,
  discordIds: readonly string[],
  warn: (message: string) => void,
): Promise<void> {
  const ids = op === 'add' ? withinCap(thread, discordIds, warn) : discordIds;
  let failed = 0;
  let firstError: unknown = null;
  for (const id of ids) {
    try {
      await thread.members[op](id);
    } catch (err) {
      if (op === 'remove' && isNotAMember(err)) continue;
      failed += 1;
      firstError ??= err;
      if (isPermanentRefusal(err)) break;
    }
  }
  if (failed === 0) return;
  warn(
    `Could not ${op} ${failed} of ${ids.length} LFG group member(s) ` +
      `${op === 'add' ? 'to' : 'from'} board thread ${thread.id}: ` +
      `${describeError(firstError)}. The bot needs ${op === 'add' ? 'Send Messages in Threads' : 'Manage Threads'}.`,
  );
}

/** Trim an add batch to the thread's remaining capacity, warning once. */
function withinCap(
  thread: ThreadMemberTarget,
  discordIds: readonly string[],
  warn: (message: string) => void,
): readonly string[] {
  const room = Math.max(0, THREAD_MEMBER_CAP - (thread.memberCount ?? 0));
  if (discordIds.length <= room) return discordIds;
  warn(
    `LFG board thread ${thread.id} is at Discord's 1,000-member cap; ` +
      `skipped adding ${discordIds.length - room} group member(s).`,
  );
  return discordIds.slice(0, room);
}

/** A remove answered "not a member" already did what we wanted. */
function isNotAMember(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'number' && NOT_A_MEMBER_CODES.has(code);
}
