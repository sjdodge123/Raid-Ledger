/**
 * ROK-1471 — fixtures for the LFG forum board.
 *
 * Split out of `fixtures.ts` (already 600+ lines) because these are the only
 * fixtures that reach past the API into the companion bot's discord.js client:
 * a forum post is a THREAD whose starter message carries the embed, and none
 * of the channel helpers in `helpers/messages.ts` can see one.
 *
 * The forum is always addressed by ID, taken from
 * `GET /admin/settings/discord-bot/lfg-board`. Finding it by NAME would be
 * ambiguous — a guild may already hold an unrelated channel called `lfg` —
 * and would silently assert against the wrong channel rather than fail.
 */
import { ChannelType, type ForumChannel, type ThreadChannel } from "discord.js";
import { getGuild } from "../client.js";
import { toSimpleMessage, type SimpleMessage } from "../helpers/messages.js";
import { ApiClient } from "./api.js";

/** `GET /admin/settings/discord-bot/lfg-board` (D1 + the D-smoke channel id). */
export interface LfgBoardSettings {
  enabled: boolean;
  /** Null until the board listener has created the forum — poll, don't assume. */
  channelId?: string | null;
  /** Advisory: the toggle persisted, but the bot lacks these permissions. */
  warning?: { missing: string[] };
}

/** One forum post, flattened to what the smoke asserts on. */
export interface ForumThreadSnapshot {
  id: string;
  name: string;
  archived: boolean;
  /** Applied tag NAMES (discord.js exposes ids; resolved via the parent). */
  appliedTagNames: string[];
  /** The post body. Null when it has been deleted out from under the thread. */
  starterMessage: SimpleMessage | null;
}

/** Read the board toggle and the forum channel it created. */
export function getLfgBoard(api: ApiClient): Promise<LfgBoardSettings> {
  return api.get<LfgBoardSettings>("/admin/settings/discord-bot/lfg-board");
}

/**
 * Flip the board master toggle.
 *
 * The PUT answers as soon as the setting is persisted — the forum channel is
 * created asynchronously by the toggle listener, so a caller that needs the
 * channel must poll {@link getLfgBoard} for a non-null `channelId`.
 */
export function setLfgBoardEnabled(
  api: ApiClient,
  enabled: boolean,
): Promise<LfgBoardSettings> {
  return api.put<LfgBoardSettings>("/admin/settings/discord-bot/lfg-board", {
    enabled,
  });
}

/**
 * Drain the board's debounce window.
 *
 * Thread renames and tag changes are debounced (~5s) so a burst of hands does
 * not rate-limit the channel edit. Without this the smoke would either race
 * the debounce or `sleep()` through it; call it before asserting on a thread's
 * NAME or TAGS. Embed edits are not debounced — those land through the normal
 * queue and `awaitProcessing` covers them.
 */
export async function flushLfgBoard(api: ApiClient): Promise<void> {
  await api.post("/admin/test/lfg-board/flush", {});
}

/** Fetch the board's forum channel, failing loudly if it is not one. */
async function fetchForum(forumChannelId: string): Promise<ForumChannel> {
  const channel = await getGuild().channels.fetch(forumChannelId);
  if (!channel) {
    throw new Error(
      `LFG board: channel ${forumChannelId} does not exist in the guild — ` +
        `the settings row points at a deleted channel`,
    );
  }
  if (channel.type !== ChannelType.GuildForum) {
    throw new Error(
      `LFG board: channel ${forumChannelId} ("${channel.name}") is type ` +
        `${channel.type}, not a forum (${ChannelType.GuildForum}) — the board ` +
        `must create a FORUM channel so posts are threads with tags`,
    );
  }
  return channel;
}

/**
 * Whether an id still names a forum channel in the guild.
 *
 * Never throws: a dead or wrong-typed id is an ANSWER here (the board has not
 * provisioned yet, or the channel was deleted), not a failure — the callers
 * are a poll predicate and a cleanup guard.
 */
export async function forumExists(
  forumChannelId: string | null | undefined,
): Promise<boolean> {
  if (!forumChannelId) return false;
  try {
    await fetchForum(forumChannelId);
    return true;
  } catch {
    return false;
  }
}

/** The names of the tags the board's forum offers (AC: the 5 lifecycle tags). */
export async function readForumTagNames(
  forumChannelId: string,
): Promise<string[]> {
  const forum = await fetchForum(forumChannelId);
  return forum.availableTags.map((t) => t.name);
}

/** Resolve a thread's applied tag ids to names via its parent forum. */
function tagNamesFor(forum: ForumChannel, thread: ThreadChannel): string[] {
  const byId = new Map(forum.availableTags.map((t) => [t.id, t.name]));
  return thread.appliedTags.map((id) => byId.get(id) ?? `<unknown:${id}>`);
}

/** Flatten one thread, tolerating a starter message that no longer exists. */
async function snapshot(
  forum: ForumChannel,
  thread: ThreadChannel,
): Promise<ForumThreadSnapshot> {
  let starterMessage: SimpleMessage | null = null;
  try {
    const msg = await thread.fetchStarterMessage({ force: true });
    starterMessage = msg ? toSimpleMessage(msg) : null;
  } catch {
    starterMessage = null;
  }
  return {
    id: thread.id,
    name: thread.name,
    archived: thread.archived === true,
    appliedTagNames: tagNamesFor(forum, thread),
    starterMessage,
  };
}

/**
 * Every post in the board's forum, ACTIVE and ARCHIVED.
 *
 * Both lists are required, not belt-and-braces: converting a group archives
 * its thread, which removes it from `fetchActive()`. Reading only the active
 * list would make the post-conversion assertions look like "the thread
 * vanished" instead of "the thread is archived", and would let a duplicate
 * post hide in the archive.
 */
export async function readForumThreads(
  forumChannelId: string,
): Promise<ForumThreadSnapshot[]> {
  const forum = await fetchForum(forumChannelId);
  const [active, archived] = await Promise.all([
    forum.threads.fetchActive(),
    forum.threads.fetchArchived(),
  ]);
  const threads = new Map<string, ThreadChannel>();
  for (const [id, t] of active.threads) threads.set(id, t);
  for (const [id, t] of archived.threads) if (!threads.has(id)) threads.set(id, t);
  return Promise.all([...threads.values()].map((t) => snapshot(forum, t)));
}

/**
 * Delete a forum post. Never throws — this runs in `finally`, where a cleanup
 * failure would replace the test's real failure with its own.
 */
export async function deleteThread(threadId: string): Promise<void> {
  try {
    const thread = await getGuild().channels.fetch(threadId);
    await thread?.delete("smoke cleanup (ROK-1471)");
  } catch {
    /* already gone, or the bot lost Manage Threads — not the test's finding */
  }
}

/**
 * Delete the board's forum channel. Best effort, for the same reason as
 * {@link deleteThread}: leaving one behind costs the next run nothing (the
 * board re-creates and re-records it), but throwing here would mask a failure.
 */
export async function deleteForumChannel(
  forumChannelId: string,
): Promise<void> {
  try {
    const channel = await getGuild().channels.fetch(forumChannelId);
    await channel?.delete("smoke cleanup (ROK-1471)");
  } catch {
    /* already gone, or the bot lost Manage Channels */
  }
}

/**
 * The forum's `topic` (ROK-1493 A4 — it carries the ownership sentinel).
 *
 * Null when the channel has no topic at all, which is an ANSWER the caller
 * asserts on rather than a fixture failure.
 */
export async function readForumTopic(
  forumChannelId: string,
): Promise<string | null> {
  const forum = await fetchForum(forumChannelId);
  return forum.topic ?? null;
}

/**
 * Whether the companion bot holds `Administrator` in this guild.
 *
 * Administrator bypasses channel permission overwrites entirely, so a guild
 * that grants it makes ROK-1493's negative assertion (a member post must be
 * refused) unprovable — the caller skips rather than asserts. `fetchMe()`
 * rather than `members.me` because the cache may not hold the bot's member.
 */
export async function botHasAdministrator(): Promise<boolean> {
  const me = await getGuild().members.fetchMe();
  return me.permissions.has("Administrator");
}

/**
 * The companion bot's resolved permissions on a board forum, as a plain
 * member. ROK-1493 T29 reads these so a refused post can be told apart from a
 * forum the member cannot see at all — Discord reports both as `50001`.
 */
export async function memberForumPermissions(
  forumChannelId: string,
): Promise<{ canView: boolean; canPost: boolean }> {
  const forum = await fetchForum(forumChannelId);
  const perms = forum.permissionsFor(await getGuild().members.fetchMe());
  return {
    canView: perms.has("ViewChannel"),
    canPost: perms.has("SendMessages"),
  };
}

/**
 * Open a forum post AS THE COMPANION BOT (a plain member).
 *
 * Deliberately does NOT catch: ROK-1493's whole point is that this rejects
 * with `50013`, so the caller must see the `DiscordAPIError` and read its
 * `code`. Swallowing it here would turn the assertion into a tautology.
 */
export async function createForumThreadAsMember(
  forumChannelId: string,
  name: string,
  content: string,
): Promise<string> {
  const forum = await fetchForum(forumChannelId);
  return (await forum.threads.create({ name, message: { content } })).id;
}

/** Fetch a thread, failing loudly if the id does not name one. */
async function fetchThread(threadId: string): Promise<ThreadChannel> {
  const channel = await getGuild().channels.fetch(threadId);
  if (!channel?.isThread()) {
    throw new Error(
      `LFG board: channel ${threadId} is not a thread — cannot post in it`,
    );
  }
  return channel;
}

/**
 * Reply inside an existing forum post, as a plain member. Also does not catch:
 * this is ROK-1493's POSITIVE control, so a rejection is the finding.
 */
export async function replyInThreadAsMember(
  threadId: string,
  content: string,
): Promise<string> {
  const message = await (await fetchThread(threadId)).send(content);
  return message.id;
}

/**
 * Delete one message from a thread. Never throws — same reason as
 * {@link deleteThread}: it runs in `finally`.
 */
export async function deleteThreadMessage(
  threadId: string,
  messageId: string,
): Promise<void> {
  try {
    await (await fetchThread(threadId)).messages.delete(messageId);
  } catch {
    /* already gone, or the bot lost Manage Messages — not the test's finding */
  }
}
