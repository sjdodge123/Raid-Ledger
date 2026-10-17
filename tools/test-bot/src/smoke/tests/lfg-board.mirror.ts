/**
 * The thread-MIRROR assertions of the LFG board smoke (ROK-1483 T28,
 * ROK-1506 T30), split out of `lfg-board.test.ts` — which is at the 750-line
 * convention and three stories deep — and given explicit arguments instead of
 * that file's `Run` so ROK-1484's surfaces can reuse them one-way.
 *
 *   T28. A COMPANION-bot reply into the thread is mirrored, its delete is
 *        reflected, and no message authored by the APP bot is ever mirrored.
 *   T30. A COMPANION-bot 🔥 on that reply reaches the mirror as
 *        `{ key: 🔥, count: 1 }`; removing it makes the entry disappear.
 *
 * T30 runs INSIDE T28's window — after the probe is mirrored and before it is
 * deleted — because a deleted message has no reactions to assert on. The
 * whole block must run before the conversion: posting into an archived thread
 * would silently unarchive it and invalidate T27.
 */
import { pollForCondition } from "../../helpers/polling.js";
import type { ApiClient } from "../api.js";
import { assertConditionNeverMet } from "../fixtures.js";
import {
  deleteThreadMessage,
  postToThread,
  reactToThreadMessage,
  readForumThreads,
  readThreadMessages,
  unreactFromThreadMessage,
  type ThreadMessageSnapshot,
} from "../fixtures-lfg-board.js";

/** Unicode only (D14): the fleet guild is not guaranteed a custom emoji. */
export const REACTION_EMOJI = "🔥";

/** Everything the mirror assertions need, made explicit by the caller. */
export interface MirrorTarget {
  api: ApiClient;
  /** The run's thread — see {@link threadIdOf}. */
  threadId: string;
  /** The LFG group's game id: the `surfaceId` claim the read is 403'd on. */
  gameId: number;
  /** The board forum, to learn the APP bot's id from the starter message. */
  forumChannelId: string;
  timeoutMs: number;
  /** T28's probe message while it is posted — the caller removes it in cleanup. */
  trackProbe: (messageId: string | undefined) => void;
}

/** How the companion bot reacts — injectable so the assertion is unit-testable. */
export interface ReactionPort {
  react: (threadId: string, messageId: string, emoji: string) => Promise<void>;
  unreact: (threadId: string, messageId: string, emoji: string) => Promise<void>;
}

const liveReactions: ReactionPort = {
  react: reactToThreadMessage,
  unreact: unreactFromThreadMessage,
};

/** The run's thread id, or a failure that says T25 should have failed first. */
export function threadIdOf(threadId: string | undefined): string {
  if (!threadId) {
    throw new Error(
      "T28: the run never captured a thread id — T25 creates it, so T25 " +
        "should have failed before reaching here",
    );
  }
  return threadId;
}

/** The mirror's view of this run's thread, read as the admin. */
export async function readMirror(
  target: MirrorTarget,
): Promise<ThreadMessageSnapshot[]> {
  const page = await readThreadMessages(target.api, target.threadId, {
    kind: "lfg-group",
    id: String(target.gameId),
  });
  return page.messages;
}

/** What the mirror actually held, for a failure message that names it. */
export function describeMirror(messages: ThreadMessageSnapshot[]): string {
  if (messages.length === 0) return "no messages at all";
  return messages
    .map((m) => `${m.author.displayName}: "${m.content}"`)
    .join(" | ");
}

/** What a message's reactions actually were, for a failure that names them. */
export function describeReactions(message: ThreadMessageSnapshot | undefined): string {
  if (!message) return "no such message in the mirror";
  if (message.reactions.length === 0) return "no reactions";
  return message.reactions
    .map((r) => `{key: "${r.key}", name: "${r.name}", count: ${String(r.count)}}`)
    .join(", ");
}

/**
 * Poll the mirror until `pick` yields, or fail SAYING WHAT WAS THERE.
 *
 * `pollForCondition`'s own timeout text names neither the thread nor its
 * contents, and a bare timeout proves nothing — so the timeout is re-thrown as
 * a real assertion. Any other error (a 403 from a thread that is not
 * app-owned, say) is re-thrown untouched, because that is a different defect.
 *
 * `failure` may be a function of the last page read, for an assertion whose
 * evidence is not the message list itself (T30 names the reactions).
 */
export async function pollMirror<T>(
  target: MirrorTarget,
  pick: (messages: ThreadMessageSnapshot[]) => T | null,
  failure: string | ((last: ThreadMessageSnapshot[]) => string),
): Promise<T> {
  let last: ThreadMessageSnapshot[] = [];
  try {
    return await pollForCondition(async () => {
      last = await readMirror(target);
      return pick(last);
    }, target.timeoutMs);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("pollForCondition timed out")) throw err;
    if (typeof failure === "function") throw new Error(failure(last));
    throw new Error(`${failure} — the mirror held ${describeMirror(last)}`);
  }
}

/** The APP bot's user id, learned from the starter message it authored. */
export async function appBotId(target: MirrorTarget): Promise<string> {
  const threads = await readForumThreads(target.forumChannelId);
  const authorId = threads.find((t) => t.id === target.threadId)?.starterMessage
    ?.authorId;
  if (!authorId) {
    throw new Error(
      `T28: could not read the starter message of thread ${target.threadId} ` +
        `to learn the app bot's user id`,
    );
  }
  return authorId;
}

/** The probe message's 🔥 entry, or null while the mirror lacks it. */
function fireReaction(
  messages: ThreadMessageSnapshot[],
  messageId: string,
): { key: string; count: number } | null {
  const message = messages.find((m) => m.messageId === messageId);
  return message?.reactions.find((r) => r.key === REACTION_EMOJI) ?? null;
}

/**
 * T30 — a companion-bot reaction on a mirrored reply reaches the mirror as
 * `{ key, count: 1 }`, and removing it makes the entry disappear (D3/D7).
 *
 * The count must be EXACTLY 1: the probe is freshly posted, so any other
 * number is a drifted or duplicated reducer, not a stale fixture.
 */
export async function assertReactionMirrored(
  target: MirrorTarget,
  probe: { id: string; content: string },
  port: ReactionPort = liveReactions,
): Promise<void> {
  const { threadId } = target;
  const byId = (last: ThreadMessageSnapshot[]) =>
    last.find((m) => m.messageId === probe.id);

  await port.react(threadId, probe.id, REACTION_EMOJI);
  await pollMirror(
    target,
    (messages) => {
      const fire = fireReaction(messages, probe.id);
      return fire?.count === 1 ? fire : null;
    },
    (last) =>
      `T30: the companion bot reacted ${REACTION_EMOJI} to "${probe.content}" ` +
      `(${probe.id}) in thread ${threadId}, but GET /discord/threads/` +
      `${threadId}/messages never carried {key: "${REACTION_EMOJI}", count: 1} ` +
      `on it — the mirror held ${describeReactions(byId(last))}`,
  );

  await port.unreact(threadId, probe.id, REACTION_EMOJI);
  await pollMirror(
    target,
    (messages) => (fireReaction(messages, probe.id) ? null : true),
    (last) =>
      `T30: the companion bot removed its ${REACTION_EMOJI} from ` +
      `"${probe.content}" (${probe.id}) in thread ${threadId}, but the mirror ` +
      `still carries it — a removed reaction must disappear, never linger as ` +
      `a 0-count pill (D7); the mirror held ${describeReactions(byId(last))}`,
  );
}

/**
 * T28 — the mirror follows the companion bot, and never the app bot (D9/A1b).
 * T30 runs inside its window (see the file header).
 */
export async function assertMirrorsCompanionReply(
  target: MirrorTarget,
  port: ReactionPort = liveReactions,
): Promise<void> {
  const { threadId } = target;
  const probe = `ROK-1483 mirror probe ${String(Date.now())}`;
  const posted = await postToThread(threadId, probe);
  target.trackProbe(posted.id);

  const mirrored = await pollMirror(
    target,
    (messages) => messages.find((m) => m.content === probe) ?? null,
    `T28: the companion bot posted "${probe}" into thread ${threadId}, but ` +
      `GET /discord/threads/${threadId}/messages never returned it`,
  );
  if (mirrored.author.displayName !== posted.authorDisplayName) {
    throw new Error(
      `T28: the mirrored message must carry the author's display name ` +
        `"${posted.authorDisplayName}", got "${mirrored.author.displayName}"`,
    );
  }

  await assertReactionMirrored(target, { id: posted.id, content: probe }, port);

  await deleteThreadMessage(threadId, posted.id);
  target.trackProbe(undefined);
  await pollMirror(
    target,
    (messages) => (messages.some((m) => m.content === probe) ? null : true),
    `T28: "${probe}" was deleted from Discord but is still mirrored in ` +
      `thread ${threadId} — a delete must be reflected as a disappearance`,
  );

  const appBot = await appBotId(target);
  await assertConditionNeverMet(
    async () =>
      (await readMirror(target)).some((m) => m.author.discordUserId === appBot),
    10_000,
    `T28 (D9): a message authored by the APP bot (${appBot}) appeared in the ` +
      `mirror for thread ${threadId}. The app's own posts — the starter card ` +
      `and every roster edit — must never be mirrored`,
  );
}
