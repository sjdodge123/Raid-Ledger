/**
 * ROK-2260 ruling 3 — take cancelled signups out of an event's Discord post.
 * Discord refuses Remove Thread Member on an archived post, and forum posts
 * auto-archive after inactivity, so an unlocked archived post is reopened
 * first (the bot has Manage Threads) and put back afterwards. Returns only
 * the ids that are out of the post, so a failed removal is retried next flush.
 */
import {
  describeError,
  isPermanentRefusal,
} from '../../../discord-bot/lfg-board/lfg-board-retire.helpers';

/** The slice of a discord.js thread the removal needs. */
export interface PostMemberTarget {
  id: string;
  archived: boolean | null;
  locked: boolean | null;
  setArchived(archived: boolean, reason?: string): Promise<unknown>;
  members: { remove(userId: string): Promise<unknown> };
}

/** Discord's "already not in it" answers (Unknown Member / Unknown User). */
const NOT_A_MEMBER_CODES = new Set([10007, 10013]);
const REASON = 'Raid Ledger: remove cancelled event signups';

/**
 * Remove `userIds` from the post; never throws, warns at most once.
 *
 * @returns The ids now out of the post (removed, or were never in it).
 */
export async function removePostMembers(
  thread: PostMemberTarget,
  userIds: readonly string[],
  warn: (message: string) => void,
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const reopen = thread.archived === true && thread.locked !== true;
  if (reopen && !(await setArchived(thread, false, warn))) return [];
  const { done, error } = await removeEach(thread, userIds);
  if (error !== null) warn(failureText(thread.id, userIds, done, error));
  if (reopen) await setArchived(thread, true, warn);
  return done;
}

/** Archive or reopen the post; false (warned) when Discord refuses. */
async function setArchived(
  thread: PostMemberTarget,
  archived: boolean,
  warn: (message: string) => void,
): Promise<boolean> {
  try {
    await thread.setArchived(archived, REASON);
    return true;
  } catch (err) {
    const what = archived ? 're-archive' : 'reopen';
    warn(`Could not ${what} event post ${thread.id}: ${describeError(err)}`);
    return false;
  }
}

async function removeEach(
  thread: PostMemberTarget,
  userIds: readonly string[],
): Promise<{ done: string[]; error: unknown }> {
  const done: string[] = [];
  let error: unknown = null;
  for (const id of userIds) {
    try {
      await thread.members.remove(id);
      done.push(id);
    } catch (err) {
      if (isNotAMember(err)) {
        done.push(id);
        continue;
      }
      error ??= err;
      if (isPermanentRefusal(err)) break;
    }
  }
  return { done, error };
}

function isNotAMember(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'number' && NOT_A_MEMBER_CODES.has(code);
}

function failureText(
  postId: string,
  userIds: readonly string[],
  done: readonly string[],
  error: unknown,
): string {
  return (
    `Could not remove ${userIds.length - done.length} of ${userIds.length} ` +
    `cancelled signup(s) from event post ${postId}: ${describeError(error)}. ` +
    'The bot needs Manage Threads; retried on the next flush.'
  );
}
