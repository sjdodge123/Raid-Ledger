/**
 * LFG forum-board smoke test (ROK-1471 AC16 / T24-T27).
 *
 * Drives ONE group through its whole life on the FORUM surface and asserts the
 * six things the design promises. It is the sibling of `lfm-embed.test.ts`,
 * which asserts the same lifecycle on the TEXT surface — and it deliberately
 * re-asserts 1454's roster regression (T27) because this story renders the same
 * roster through a different surface adapter, where it can be lost again.
 *
 *   T24. NOTHING is posted on the first hand — "LFG is quiet. LFM is loud."
 *        The most important assertion in the file: a forum post announces a
 *        room to the whole guild, so a premature one is the expensive defect.
 *   T25. The 1 -> 2 transition creates exactly one thread, correctly named,
 *        tagged, and carrying the `+1` button row (and therefore NO masked
 *        group link in the description).
 *   T26. Every later hand EDITS the starter message; its id never changes, and
 *        the thread NAME catches up once the debounce is flushed.
 *   T27. Conversion retags to SCHEDULED, drops the button row, archives the
 *        thread, and still names every player.
 *   T28. (ROK-1483) A COMPANION-bot reply into that thread is mirrored, its
 *        delete is reflected, and no message authored by the APP bot is ever
 *        mirrored (D9). It runs before the conversion, while the thread is
 *        still live — posting into an archived thread would silently unarchive
 *        it and invalidate T27's assertion. Lives in `lfg-board.mirror.ts`.
 *   T30. (ROK-1506) A COMPANION-bot 🔥 on that reply is mirrored as
 *        `{ key, count: 1 }` and its removal is reflected. Runs inside T28's
 *        window, before the probe is deleted. Same module.
 *   T29. (ROK-1493) The board is bot-write-only: a plain member cannot OPEN a
 *        post, can still REPLY inside one, and the forum topic carries the
 *        ownership sentinel. Numbered T29 because ROK-1483 owns T28.
 *
 * WHY IT CONVERTS TO A POLL, NOT AN EVENT: the spec's T27 says "convert to an
 * event", but `POST /events` signs its creator up, `signup.created` clears the
 * creator's intent (ROK-1451 AC6), and the convert then 403s with "Only a
 * member of this LFG group can convert it". `lfm-embed.test.ts` hit exactly
 * that on its first fleet run; the interaction is recorded in
 * `TECH-DEBT-BACKLOG.md` (2026-09-05). The scheduling-poll path is the
 * product's own flow and reaches the same terminal render.
 *
 * The board's master toggle is GLOBAL, so the whole run is wrapped in
 * `withLfgSurface` — see `lfg-surface-lock.ts` for why.
 */
import { pollForCondition } from "../../helpers/polling.js";
import { assertEmbedRenderRules } from "../assert.js";
import {
  assertConditionNeverMet,
  awaitProcessing,
  convertLfg,
  postLfgIntent,
  seedFixtureUser,
  withdrawLfgIntent,
  type FixtureUser,
  type LfgGroupSummary,
} from "../fixtures.js";
import {
  botHasAdministrator,
  createForumThreadAsMember,
  memberForumPermissions,
  deleteForumChannel,
  deleteThread,
  deleteThreadMessage,
  flushLfgBoard,
  forumExists,
  getLfgBoard,
  readForumTagNames,
  readForumThreads,
  readForumTopic,
  replyInThreadAsMember,
  setLfgBoardEnabled,
  type ForumThreadSnapshot,
} from "../fixtures-lfg-board.js";
import {
  assertMirrorsCompanionReply as assertMirrorFollowsCompanion,
  threadIdOf,
} from "./lfg-board.mirror.js";
import { withLfgSurface } from "../lfg-surface-lock.js";
import type { SimpleEmbed } from "../../helpers/messages.js";
import type { SmokeTest, TestContext } from "../types.js";

/** `LFG_BOARD_TAGS` — the forum's five lifecycle tags, verbatim. */
const BOARD_TAGS = [
  "NEEDS PLAYERS",
  "READY TO SCHEDULE",
  "SCHEDULED",
  "EXPIRED",
  "CLOSED",
];
/** `LFG_BOARD_INTRO_TITLE` — the pinned explainer, never a group thread. */
const INTRO_TITLE = "How this board works";
/** `LFG_JOIN_BUTTON_LABEL`. U+00B7 MIDDLE DOT, as the API constant spells it. */
const JOIN_LABEL = "+1 · I'm in";
/** `LFG_OPEN_GROUP_LABEL`. U+2197 NORTH EAST ARROW. */
const OPEN_GROUP_LABEL = "Open group ↗";
/** `LFG_BUTTON_IDS.JOIN` — the custom id prefix the join listener slices. */
const JOIN_CUSTOM_ID = 'lfg:join';
/**
 * `LFG_BOARD_TOPIC_SENTINEL`, mirrored from
 * `api/src/discord-bot/lfg-board/lfg-board-permissions.helpers.ts`. U+00B7
 * MIDDLE DOT, exactly as that constant spells it. Kept as a literal rather
 * than imported: the companion bot does not depend on the api workspace.
 */
const TOPIC_SENTINEL = '\u00b7 raid-ledger:lfg-board';
/** The post T29 tries — and must never manage — to open. */
const REFUSED_POST_TITLE = 'ROK-1493 smoke - must be refused';
/** `DISCORD_THREAD_NAME_MAX` / the `SEP` in `threadNameFor`. */
const THREAD_NAME_MAX = 100;
const SEP = "·";
/** AC16 says ">= 10 s"; a little over, and no `sleep()` anywhere. */
const QUIET_WINDOW_MS = 12_000;
/** Provisioning a forum + intro post is several Discord round-trips. */
const BOARD_READY_MS = 45_000;
/** How many games to probe for an idle one before giving up. */
const GAME_SCAN_LIMIT = 8;
/**
 * `lfm-embed.test.ts` takes its candidates from the LAST 8 games in the
 * registry. This suite starts past that window so the two LFG suites never
 * contend for one group — they are serialised by the surface lock, but a game
 * the sibling suite has already CONVERTED is no longer idle for either of us.
 */
const GAME_SCAN_OFFSET = 8;

/** `GET /lfg/:gameId` — the summary plus the live roster. */
interface LfgGroupDetail extends LfgGroupSummary {
  members: { userId: number; username: string; displayName: string | null }[];
}

/** What the DEMO_MODE slash-command harness hands back. */
interface HarnessReply {
  content?: string;
  embeds?: { author?: { name?: string }; description?: string }[];
}

/** What `POST /scheduling-polls` hands back — the match id IS the poll id. */
interface SchedulingPoll {
  id: number;
  lineupId: number;
}

/** Everything the phases share. Assembled as the run progresses. */
interface Run {
  ctx: TestContext;
  game: { id: number; name: string };
  /** The board forum, addressed by ID (never by name) once provisioned. */
  forumChannelId?: string;
  /** True when the forum outlived a previous run — cleanup must NOT delete it. */
  forumPreexisting: boolean;
  /** Advisory permission warning from the toggle, quoted in later failures. */
  warning?: string;
  /**
   * Thread ids present before the first hand, INCLUDING the intro post. The
   * forum is shared across runs and the idle-game scan can hand back a game
   * whose archived post from a previous run is still there.
   */
  preexistingThreads: Set<string>;
  second?: FixtureUser;
  third?: FixtureUser;
  /** The one thread this group is allowed to own. */
  threadId?: string;
  /** The starter message every later hand must EDIT rather than replace. */
  starterMessageId?: string;
  /** T28's probe message, while it is still posted — removed in cleanup. */
  probeMessageId?: string;
  lineupId?: number;
  rosterNames?: string[];
}

/** The forum id, or a failure that says the run never got one. */
function forumId(run: Run): string {
  if (!run.forumChannelId) {
    throw new Error(
      "LFG board: the forum channel was never resolved — the enable step " +
        "should have failed before reaching here",
    );
  }
  return run.forumChannelId;
}

/** Mirror of `threadNameFor`: the game name is what gets truncated, not the count. */
function gameHead(gameName: string, count: number): string {
  const room = THREAD_NAME_MAX - ` ${SEP} ${String(count)} looking`.length;
  return gameName.length <= room ? gameName : `${gameName.slice(0, room - 1)}…`;
}

/** The exact thread name the board must give this group at `count` hands. */
function expectedThreadName(gameName: string, count: number): string {
  return `${gameHead(gameName, count)} ${SEP} ${String(count)} looking`;
}

/**
 * The head every name this group's thread can take shares.
 *
 * The separator is part of it on purpose: a bare game-name prefix would also
 * match a DIFFERENT game whose name it prefixes ("Halo" vs "Halo Infinite"),
 * and the count is excluded so one prefix identifies the thread at any size.
 */
function threadNamePrefix(gameName: string): string {
  return `${gameHead(gameName, 2)} ${SEP} `;
}

/** `GET /lfg/:gameId` as the admin. */
function readGroup(ctx: TestContext, gameId: number): Promise<LfgGroupDetail> {
  return ctx.api.get<LfgGroupDetail>(`/lfg/${gameId}`);
}

/**
 * Truly unused by LFG: no live hands AND no live LFG-born session.
 *
 * `activeCount === 0` alone stopped meaning "unused" at ROK-1494. Two `now`
 * hands spawn a live session and CONVERT both intents, so the count falls back
 * to 0 while the group's `lfg_group_messages` row stays `state = 'open'` —
 * `TERMINAL_STATE.playing` is null on purpose, because the post's voice
 * head-count is still moving. `uq_lfg_group_messages_game_open` allows exactly
 * one open row per game, so `onLfmReached` takes its edit branch for that game
 * and posts NO new forum thread. That is precisely this suite's "no thread ever
 * appeared" failure when it lands on the game `lfm-embed.test.ts::runNowUrgency`
 * spawned a session on moments earlier (same `embed` category, runs just
 * before). The session is reaped ~30 min after its hour is up, and the reaper
 * closes the row (ROK-1494 Q4) — until then the game is not ours to use.
 */
function isIdle(group: LfgGroupDetail): boolean {
  return group.activeCount === 0 && !group.playingNow;
}

/**
 * The candidate games, ordered so this suite and `lfm-embed.test.ts` collide
 * last rather than first.
 *
 * The offset window is the ideal: `lfm-embed.test.ts` scans the LAST
 * {@link GAME_SCAN_LIMIT} games in the registry, so starting past them keeps
 * the two suites off each other's groups entirely. It needs
 * `GAME_SCAN_OFFSET + 1` games to exist, and the CI seed creates SEVEN — so on
 * every CI run the offset branch is dead and both suites used to scan the
 * identical window in the identical order, handing this suite whatever game the
 * sibling suite had just finished with.
 *
 * The fallback therefore walks the same short registry from the OTHER end
 * (oldest first, where the sibling starts newest first). It cannot guarantee
 * disjointness — seven games cannot be split two ways eight at a time — but the
 * two suites now have to exhaust almost the whole registry before they meet,
 * and {@link isIdle} rejects the collision if they ever do.
 */
function candidateGames<T>(games: T[]): T[] {
  const reversed = games.slice().reverse();
  return reversed.length > GAME_SCAN_OFFSET + 1
    ? reversed.slice(GAME_SCAN_OFFSET, GAME_SCAN_OFFSET + GAME_SCAN_LIMIT)
    : reversed.slice(0, GAME_SCAN_LIMIT).reverse();
}

/**
 * A game nobody is currently looking for and nobody is currently playing.
 *
 * Re-scanned every run so a leaked intent from a failed run costs the next run
 * a different game rather than a false failure.
 */
async function pickIdleGame(
  ctx: TestContext,
): Promise<{ id: number; name: string }> {
  const res = await ctx.api.get<{ data: { id: number; name: string }[] }>(
    "/admin/settings/games?limit=100",
  );
  const window = candidateGames(res.data ?? []);
  if (window.length === 0)
    throw new Error("LFG board: no games in the registry");
  for (const game of window) {
    const group = await readGroup(ctx, game.id);
    if (isIdle(group)) return game;
  }
  throw new Error(
    `LFG board: all ${window.length} candidate games already hold active LFG ` +
      `intents or a live LFG-born session — clear them before re-running ` +
      `(ids: ${window.map((g) => g.id).join(", ")})`,
  );
}

/** One line per thread, for a failure message that shows the real state. */
function describeThreads(threads: ForumThreadSnapshot[]): string {
  if (threads.length === 0) return "(none)";
  return threads
    .map((t) => {
      const author = t.starterMessage?.embeds[0]?.author ?? "-";
      const title = t.starterMessage?.embeds[0]?.title ?? "-";
      return (
        `{id=${t.id} name="${t.name}" archived=${String(t.archived)} ` +
        `tags=[${t.appliedTagNames.join(", ")}] embedTitle="${title}" ` +
        `author="${author}"}`
      );
    })
    .join(", ");
}

/**
 * Poll the forum for a thread matching `predicate`.
 *
 * The timeout is re-thrown as `label` plus a dump of every thread in the forum:
 * a bare "pollForCondition timed out" proves nothing about WHICH invariant
 * broke, and this is the shape every phase below fails in.
 */
async function pollForThread(
  run: Run,
  predicate: (t: ForumThreadSnapshot) => boolean,
  label: string,
  timeoutMs = run.ctx.config.timeoutMs,
): Promise<ForumThreadSnapshot> {
  let seen: ForumThreadSnapshot[] = [];
  try {
    return await pollForCondition(async () => {
      seen = await readForumThreads(forumId(run));
      return seen.find(predicate) ?? null;
    }, timeoutMs);
  } catch {
    throw new Error(
      `${label}. Forum ${forumId(run)} holds ${seen.length} thread(s): ` +
        `${describeThreads(seen)}`,
    );
  }
}

/** Threads this run created, for this game, excluding the intro explainer. */
function isGroupThread(run: Run, t: ForumThreadSnapshot): boolean {
  if (run.preexistingThreads.has(t.id)) return false;
  // Named rather than inferred: the intro post is created by the same enable
  // that provisions the forum, so a slow seed can land AFTER the snapshot.
  if (t.name === INTRO_TITLE) return false;
  // Identity does not rest on the embed alone — a post whose embed is wrong is
  // exactly the defect T25 exists to catch, and it must still be FOUND.
  if (t.name.startsWith(threadNamePrefix(run.game.name))) return true;
  // A thread whose starter message cannot be read is NOT claimed: identity
  // rests on the name, and claiming an unreadable stranger would fail T24 for
  // somebody else's post.
  return (
    t.starterMessage?.embeds.some((e) => e.title === run.game.name) ?? false
  );
}

/** The starter embed for this game, or a failure naming what was there. */
function starterEmbed(run: Run, t: ForumThreadSnapshot): SimpleEmbed {
  const embeds = t.starterMessage?.embeds ?? [];
  const embed = embeds.find((e) => e.title === run.game.name);
  if (!embed) {
    throw new Error(
      `LFG board: thread ${t.id} ("${t.name}") carries no starter embed ` +
        `titled "${run.game.name}" (embed titles: ` +
        `[${embeds.map((e) => e.title ?? "null").join(", ")}], starter message ` +
        `${t.starterMessage ? t.starterMessage.id : "MISSING"})`,
    );
  }
  assertEmbedRenderRules(embed);
  return embed;
}

/** Assert an author line, reporting the line that was actually rendered. */
function assertAuthor(
  embed: SimpleEmbed,
  pattern: RegExp,
  label: string,
): void {
  const author = embed.author ?? "";
  if (!pattern.test(author)) {
    throw new Error(
      `${label}: expected author matching ${String(pattern)}, got "${author}"`,
    );
  }
}

/** Assert the starter message id never changed (T26/T27's core invariant). */
function assertSameStarter(
  run: Run,
  t: ForumThreadSnapshot,
  label: string,
): void {
  const id = t.starterMessage?.id;
  if (id !== run.starterMessageId) {
    throw new Error(
      `${label}: expected the SAME starter message id ${run.starterMessageId} ` +
        `(one post per group, edited in place), got ${id ?? "no starter message"} ` +
        `on thread ${t.id}`,
    );
  }
}

/** Enable the board and wait until its forum + intro post are provisioned. */
async function enableBoard(run: Run): Promise<void> {
  const before = await getLfgBoard(run.ctx.api);
  run.forumPreexisting = await forumExists(before.channelId);
  const put = await setLfgBoardEnabled(run.ctx.api, true);
  if (!put.enabled) {
    throw new Error(
      "AC16 step 1: PUT /admin/settings/discord-bot/lfg-board {enabled:true} " +
        `answered { enabled: ${String(put.enabled)} } — the toggle did not persist`,
    );
  }
  // Advisory, never fatal: preflight reporting a missing grant explains a later
  // timeout far better than it predicts one.
  if (put.warning) run.warning = put.warning.missing.join(", ");
  run.forumChannelId = await waitForForum(run);
  await assertForumTags(run);
  // Waiting for the intro post also GUARANTEES it is in the pre-run snapshot,
  // which is what stops it satisfying T24's negative assertion.
  await pollForThread(
    run,
    (t) => t.name === INTRO_TITLE,
    `AC16 step 1: enabling the board must seed one intro post titled ` +
      `"${INTRO_TITLE}" in forum ${run.forumChannelId}, and none appeared`,
    BOARD_READY_MS,
  );
  run.preexistingThreads = new Set(
    (await readForumThreads(forumId(run))).map((t) => t.id),
  );
}

/** Poll settings until `channelId` names a real forum channel. */
async function waitForForum(run: Run): Promise<string> {
  try {
    return await pollForCondition(async () => {
      const settings = await getLfgBoard(run.ctx.api);
      if (!settings.channelId) return null;
      return (await forumExists(settings.channelId))
        ? settings.channelId
        : null;
    }, BOARD_READY_MS);
  } catch {
    const settings = await getLfgBoard(run.ctx.api);
    const warn = run.warning
      ? ` The toggle also warned the bot is missing [${run.warning}].`
      : "";
    throw new Error(
      `AC16 step 1: enabling the board must create a forum channel, but after ` +
        `${String(BOARD_READY_MS)}ms GET /admin/settings/discord-bot/lfg-board ` +
        `still answers { enabled: ${String(settings.enabled)}, channelId: ` +
        `${settings.channelId ?? "null"} } and no forum with that id exists ` +
        `in the guild.${warn}`,
    );
  }
}

/** AC6: the forum offers the five lifecycle tags the author line uses. */
async function assertForumTags(run: Run): Promise<void> {
  const tags = await readForumTagNames(forumId(run));
  const missing = BOARD_TAGS.filter((t) => !tags.includes(t));
  if (missing.length > 0) {
    throw new Error(
      `AC16 step 1: the board forum ${forumId(run)} must offer the five ` +
        `lifecycle tags, missing [${missing.join(", ")}] — it offers ` +
        `[${tags.join(", ")}]`,
    );
  }
}

/** T24 — the first hand posts NOTHING. */
async function assertQuietOnFirstHand(run: Run): Promise<void> {
  const first = await postLfgIntent(run.ctx.api, run.game.id);
  if (first.group.activeCount !== 1) {
    throw new Error(
      `T24 precondition: expected activeCount 1 after the first hand on ` +
        `"${run.game.name}", got ${String(first.group.activeCount)} — the group ` +
        `was not idle, so the quiet-window assertion would be vacuous`,
    );
  }
  await awaitProcessing(run.ctx.api);
  await assertConditionNeverMet(
    async () => {
      const threads = await readForumThreads(forumId(run));
      return threads.some((t) => isGroupThread(run, t));
    },
    QUIET_WINDOW_MS,
    `T24: a forum thread for "${run.game.name}" appeared in board ` +
      `${forumId(run)} after ONE hand — nothing may be posted before the ` +
      `1 -> 2 transition ("LFG is quiet, LFM is loud"). A forum post ` +
      `announces the room to the whole guild, so this is the expensive defect`,
  );
}

/** T25 — the second hand creates exactly one correctly furnished thread. */
async function assertPostsOnSecondHand(run: Run): Promise<void> {
  run.second = await seedFixtureUser(run.ctx.api, 3, 3);
  const second = await postLfgIntent(run.second.api, run.game.id);
  if (second.group.activeCount !== 2) {
    throw new Error(
      `T25 precondition: expected activeCount 2 after the second hand, got ` +
        `${String(second.group.activeCount)}`,
    );
  }
  await awaitProcessing(run.ctx.api);
  const found = await pollForThread(
    run,
    (t) => isGroupThread(run, t),
    `T25: the 1 -> 2 transition must create a forum thread for ` +
      `"${run.game.name}" in board ${forumId(run)}, and none appeared`,
  );
  assertThreadName(run, found, 2, 'T25');
  // Discord can 404 a forum post's starter message for a moment after the
  // post exists (observed 2026-09-06 on the fleet: thread created and named
  // "· 2 looking", starter MISSING on the first read). The snapshot tolerates
  // that, so the starter is polled for on its own before it is asserted.
  const thread = await pollForThread(
    run,
    (t) => t.id === found.id && t.starterMessage !== null,
    `T25: thread ${found.id} ("${found.name}") was created and named, but ` +
      'its starter message never became readable',
  );
  run.threadId = thread.id;
  run.starterMessageId = thread.starterMessage?.id;
  assertOpenStarter(run, thread);
  assertOpenTag(run, thread);
}

/** The thread name is `${game} · ${n} looking` — the D10 rename contract. */
function assertThreadName(
  run: Run,
  t: ForumThreadSnapshot,
  count: number,
  label: string,
): void {
  const expected = expectedThreadName(run.game.name, count);
  if (t.name !== expected) {
    throw new Error(
      `${label}: expected thread ${t.id} to be named "${expected}", got ` +
        `"${t.name}"`,
    );
  }
}

/** The starter message while the group is OPEN: author, buttons, no masked link. */
function assertOpenStarter(run: Run, t: ForumThreadSnapshot): void {
  const embed = starterEmbed(run, t);
  assertAuthor(embed, /NEEDS PLAYERS|READY TO SCHEDULE/u, "T25 author");
  assertAuthor(embed, /\b2 looking\b/u, "T25 count");
  const components = t.starterMessage?.components ?? [];
  const expectedId = `${JOIN_CUSTOM_ID}:${String(run.game.id)}`;
  const join = components.find((c) => c.customId === expectedId);
  if (!join || join.label !== JOIN_LABEL) {
    throw new Error(
      `T25: the open post must carry the join button (customId ` +
        `"${expectedId}", label "${JOIN_LABEL}"), got components ` +
        `[${components.map((c) => `${c.label ?? "null"}/${c.customId ?? "link"}`).join(", ")}]`,
    );
  }
  if (!components.some((c) => c.label === OPEN_GROUP_LABEL)) {
    throw new Error(
      `T25: the open post must carry the "${OPEN_GROUP_LABEL}" Link button ` +
        `that REPLACES the masked description link, got components ` +
        `[${components.map((c) => c.label ?? "null").join(", ")}]`,
    );
  }
  const description = embed.description ?? "";
  if (/\[Open group/u.test(description)) {
    throw new Error(
      `T25: the open post carries BOTH the Link button and the masked ` +
        `"[Open group" description link — the button must replace it ` +
        `(linkStyle: 'button'). Description: "${description}"`,
    );
  }
}

/** The open post is tagged with whichever open state its author line claims. */
function assertOpenTag(run: Run, t: ForumThreadSnapshot): void {
  const author = starterEmbed(run, t).author ?? "";
  const expected = /READY TO SCHEDULE/u.test(author)
    ? "READY TO SCHEDULE"
    : "NEEDS PLAYERS";
  if (!t.appliedTagNames.includes(expected)) {
    throw new Error(
      `T25: thread ${t.id} must carry the forum tag "${expected}" to match its ` +
        `author line "${author}" (AC6 — the filter and the embed say the same ` +
        `words), got tags [${t.appliedTagNames.join(", ")}]`,
    );
  }
}

/** Invoke `/lfg game:<id>` through the DEMO_MODE harness. */
function invokeLfg(
  ctx: TestContext,
  discordUserId: string,
  game: string,
): Promise<HarnessReply> {
  return ctx.api.post<HarnessReply>("/admin/test/slash-command", {
    commandName: "lfg",
    options: { game },
    discordUserId,
    guildId: ctx.config.guildId,
    channelId: ctx.defaultChannelId,
  });
}

/**
 * T29 (ROK-1493) — the board is bot-write-only, and only for POSTS.
 *
 * Runs on the live forum T25 just posted in, so all three halves address real
 * state rather than a freshly provisioned channel. The two write assertions
 * are a matched pair on purpose: R1 alone is satisfied by a deny so broad it
 * also kills replies, and R2 alone is satisfied by no deny at all.
 *
 * The bot's own intro REDISCOVERY (D6/AC2) is deliberately absent and is not
 * an oversight: reproducing it means unsetting `LFG_BOARD_INTRO_THREAD_ID` in
 * `app_settings` between two enables while leaving the forum intact, and the
 * companion bot has no settings-write surface for one key. It is covered by
 * the listener unit specs, five of them verified by reverting the fix.
 */
async function assertBoardIsBotWriteOnly(run: Run): Promise<void> {
  await assertMemberPostRefused(run);
  await assertMemberReplyAllowed(run);
  await assertTopicSentinel(run);
}

/** A Discord API error code, or null when the throw carried none. */
function discordErrorCode(err: unknown): number | string | null {
  if (typeof err !== 'object' || err === null || !('code' in err)) return null;
  const { code } = err as { code: unknown };
  return typeof code === 'number' || typeof code === 'string' ? code : null;
}

/** R1 — a plain member opening a post must be refused. */
async function assertMemberPostRefused(run: Run): Promise<void> {
  if (await botHasAdministrator()) {
    console.log(
      '  [lfg-board] T29 R1 SKIPPED: the companion bot holds Administrator, ' +
        'which bypasses channel overwrites — neither outcome would say ' +
        'anything about the @everyone deny. Remove Administrator from the ' +
        'smoke bot role for R1 coverage; R2 and R3 still run.',
    );
    return;
  }
  let opened: string | null = null;
  try {
    opened = await createForumThreadAsMember(
      forumId(run),
      REFUSED_POST_TITLE,
      'ROK-1493 smoke: if you can read this, any member can open board posts.',
    );
  } catch (err: unknown) {
    assertMissingPermissions(run, err, await memberForumPermissions(forumId(run)));
    return;
  } finally {
    if (opened) await deleteThread(opened);
  }
  throw new Error(
    `T29 (AC1): expected board forum ${forumId(run)} to REFUSE a post from ` +
      'the companion bot (a plain member) with Discord code 50001/50013; ' +
      `it ACCEPTED one — thread ${opened}, since deleted. The ` +
      '@everyone deny is missing or omits SendMessages.',
  );
}

/**
 * The refusal must be a permission refusal, not a visibility one.
 *
 * Discord answers a forum-post create that is refused by a `SendMessages`
 * deny with `50001 Missing Access` (403), NOT `50013 Missing Permissions` —
 * measured on 2026-09-06 against slot 4 with the deny exactly as D1 writes it
 * and `ViewChannel` resolved true for the member. So the code alone cannot
 * separate "cannot post" from "cannot see the forum"; the caller passes the
 * member's resolved permissions and this asserts BOTH halves: the forum is
 * still visible, and posting is what was refused.
 */
function assertMissingPermissions(
  run: Run,
  err: unknown,
  resolved: { canView: boolean; canPost: boolean },
): void {
  const code = discordErrorCode(err);
  if (!resolved.canView) {
    throw new Error(
      `T29 (AC1): the @everyone deny on board forum ${forumId(run)} hides ` +
        'the forum from a plain member (ViewChannel resolved false) — the ' +
        `deny is too broad. Discord said: ${String(err)}`,
    );
  }
  if (resolved.canPost) {
    throw new Error(
      `T29 (AC1): board forum ${forumId(run)} still resolves SendMessages ` +
        `true for a plain member, yet the post was refused with code ` +
        `${code === null ? 'none' : String(code)} — ${String(err)}`,
    );
  }
  if (code === 50001 || code === 50013) return;
  throw new Error(
    `T29 (AC1): opening a post in board forum ${forumId(run)} as a plain ` +
      'member: expected Discord code 50001 (Missing Access) or 50013 ' +
      `(Missing Permissions), got code ${code === null ? 'none' : String(code)} — ${String(err)}`,
  );
}

/**
 * R2 — the positive control. `SendMessagesInThreads` is deliberately left
 * inherited, so a member replying INSIDE an existing post still works. Without
 * this half, a deny broad enough to silence the whole board passes R1 happily.
 */
async function assertMemberReplyAllowed(run: Run): Promise<void> {
  const threadId = run.threadId;
  if (!threadId) {
    throw new Error(
      'T29 (R2) precondition: expected T25 to have recorded the group thread ' +
        'id before the positive control runs; the run carries none',
    );
  }
  let messageId: string | null = null;
  try {
    messageId = await replyInThreadAsMember(
      threadId,
      'ROK-1493 smoke — replies stay open',
    );
  } catch (err: unknown) {
    throw new Error(
      `T29 (R2/AC3): expected thread.send() into board post ${threadId} to ` +
        'SUCCEED (the board denies opening posts, not talking in them); it ' +
        'was refused with Discord code ' +
        `${String(discordErrorCode(err) ?? 'none')}: ${String(err)}`,
    );
  } finally {
    if (messageId) await deleteThreadMessage(threadId, messageId);
  }
}

/**
 * R3 (A4) — the forum topic carries the ownership sentinel, which is how a
 * redeployed instance rediscovers its own board instead of creating a second.
 */
async function assertTopicSentinel(run: Run): Promise<void> {
  const topic = await readForumTopic(forumId(run));
  if (topic?.includes(TOPIC_SENTINEL) === true) return;
  throw new Error(
    `T29 (A4): expected board forum ${forumId(run)}'s topic to contain the ` +
      `ownership sentinel "${TOPIC_SENTINEL}", got ` +
      `${topic === null ? '<no topic set>' : JSON.stringify(topic)}`,
  );
}

/** T26 — the third hand EDITS the same starter message and renames the thread. */
async function assertEditsOnThirdHand(run: Run): Promise<void> {
  // Its own fixture user (own JWT and Discord id) so the `/lfg` harness can
  // resolve it by `users.discord_id` AND cleanup can withdraw its hand.
  run.third = await seedFixtureUser(run.ctx.api, 3, 4);
  const reply = await invokeLfg(
    run.ctx,
    run.third.discordId,
    String(run.game.id),
  );
  const replyAuthor = reply.embeds?.[0]?.author?.name ?? "";
  if (!/\b3 looking\b/u.test(replyAuthor)) {
    throw new Error(
      `T26: /lfg should have raised the third hand and answered with the group ` +
        `state, got author "${replyAuthor}" / content "${reply.content ?? ""}"`,
    );
  }
  await awaitProcessing(run.ctx.api);
  const edited = await pollForThread(
    run,
    (t) =>
      t.id === run.threadId &&
      /\b3 looking\b/u.test(t.starterMessage?.embeds[0]?.author ?? ""),
    `T26: the third hand must EDIT the starter message of thread ` +
      `${run.threadId ?? "?"} to say "3 looking"`,
  );
  assertSameStarter(run, edited, "T26");
  await assertRenamedAfterFlush(run);
  await captureRoster(run);
}

/** The rename is debounced; flush it, then the name must catch up. */
async function assertRenamedAfterFlush(run: Run): Promise<void> {
  await flushLfgBoard(run.ctx.api);
  const expected = expectedThreadName(run.game.name, 3);
  await pollForThread(
    run,
    (t) => t.id === run.threadId && t.name === expected,
    `T26: after POST /admin/test/lfg-board/flush drained the rename debounce, ` +
      `thread ${run.threadId ?? "?"} must be named "${expected}"`,
  );
}

/** Capture the roster while the LIVE read still works (see T27). */
async function captureRoster(run: Run): Promise<void> {
  const group = await readGroup(run.ctx, run.game.id);
  run.rosterNames = group.members.map((m) => m.displayName ?? m.username);
  if (run.rosterNames.length !== 3) {
    throw new Error(
      `T26 precondition: expected a 3-player roster before conversion, got ` +
        `${String(run.rosterNames.length)} ([${run.rosterNames.join(", ")}])`,
    );
  }
}

/**
 * The product's conversion, step 1: a scheduling poll for the live roster,
 * created by the admin — a MEMBER of the group (the first hand). Creating a
 * poll signs nobody up, so every intent is still `active` when the convert
 * call checks membership (see the header for why an event would not be).
 */
async function createPollForGroup(run: Run): Promise<SchedulingPoll> {
  const group = await readGroup(run.ctx, run.game.id);
  const memberUserIds = group.members.map((m) => m.userId);
  const poll = await run.ctx.api.post<SchedulingPoll>("/scheduling-polls", {
    gameId: run.game.id,
    memberUserIds,
    durationHours: 2,
    minVoteThreshold: memberUserIds.length,
  });
  run.lineupId = poll.lineupId;
  return poll;
}

/** T27 — conversion retags, disarms, archives, and keeps every player. */
async function assertConvertedThread(
  run: Run,
  poll: SchedulingPoll,
): Promise<void> {
  await convertLfg(run.ctx.api, run.game.id, { pollId: poll.id });
  await awaitProcessing(run.ctx.api);
  const converted = await pollForThread(
    run,
    (t) =>
      t.id === run.threadId &&
      /SCHEDULED/u.test(t.starterMessage?.embeds[0]?.author ?? ""),
    `T27: converting the group must rewrite thread ${run.threadId ?? "?"}'s ` +
      `starter embed to the SCHEDULED author line`,
  );
  assertSameStarter(run, converted, "T27");
  const components = converted.starterMessage?.components ?? [];
  if (components.length > 0) {
    throw new Error(
      `T27: the converted post must carry NO components — a pressable ` +
        `"${JOIN_LABEL}" on a scheduled group is a trap — got ` +
        `[${components.map((c) => c.label ?? "null").join(", ")}]`,
    );
  }
  assertRosterSurvived(run, starterEmbed(run, converted).description ?? "");
  await assertArchivedAndTagged(run);
}

/** The terminal thread settles: tagged SCHEDULED and archived. */
async function assertArchivedAndTagged(run: Run): Promise<void> {
  await flushLfgBoard(run.ctx.api);
  await pollForThread(
    run,
    (t) =>
      t.id === run.threadId &&
      t.archived &&
      t.appliedTagNames.includes("SCHEDULED"),
    `T27: the converted thread ${run.threadId ?? "?"} must end up ARCHIVED and ` +
      `tagged "SCHEDULED"`,
  );
}

/**
 * The 1454 round-1 regression guard, re-asserted on the forum surface: every
 * player is still named after conversion.
 *
 * Asserted name by name. A count would pass if the roster had been rebuilt from
 * different rows, and the round-1 defect rendered the `|| 'Nobody yet'`
 * fallback, which satisfies any "description is non-empty" check.
 */
function assertRosterSurvived(run: Run, description: string): void {
  const missing = (run.rosterNames ?? []).filter(
    (name) => !description.includes(name),
  );
  if (missing.length > 0) {
    throw new Error(
      `T27 regression guard: the converted post lost ${String(missing.length)} ` +
        `of ${String(run.rosterNames?.length ?? 0)} players from the roster — ` +
        `missing [${missing.join(", ")}]. This is 1454's round-1 defect (the ` +
        `converted read composed liveIntent) on the forum surface. ` +
        `Description: "${description}"`,
    );
  }
}

/** Step 6 — one thread for this game across the whole run, and it renders. */
async function assertExactlyOneThread(run: Run): Promise<void> {
  const threads = await readForumThreads(forumId(run));
  const mine = threads.filter((t) => isGroupThread(run, t));
  for (const t of mine) starterEmbed(run, t);
  if (mine.length !== 1 || mine[0].id !== run.threadId) {
    throw new Error(
      `AC16 step 6: expected exactly 1 forum thread for "${run.game.name}" ` +
        `(the one created at the 1 -> 2 transition, ${run.threadId ?? "?"}) in ` +
        `board ${forumId(run)} for the whole run, found ${mine.length}: ` +
        `${describeThreads(mine)} — a terminal state must EDIT, never post a ` +
        `second card`,
    );
  }
}

/** T28 + T30 — the mirror assertions, with this run's ids made explicit. */
function assertMirrorsCompanionReply(run: Run): Promise<void> {
  return assertMirrorFollowsCompanion({
    api: run.ctx.api,
    threadId: threadIdOf(run.threadId),
    gameId: run.game.id,
    forumChannelId: forumId(run),
    timeoutMs: run.ctx.config.timeoutMs,
    trackProbe: (id) => {
      run.probeMessageId = id;
    },
  });
}

/**
 * Undo everything, in `finally`. Every step is best-effort and logged: a
 * cleanup failure must never replace the test's real failure with its own.
 */
async function cleanup(run: Run): Promise<void> {
  await withdrawLfgIntent(run.ctx.api, run.game.id);
  if (run.second) await withdrawLfgIntent(run.second.api, run.game.id);
  if (run.third) await withdrawLfgIntent(run.third.api, run.game.id);
  // No `DELETE /lineups/:id` exists — force-archive the poll's lineup the way
  // the abort smoke does (operator/admin route, empty body).
  if (run.lineupId !== undefined) {
    await run.ctx.api
      .post(`/lineups/${run.lineupId}/abort`, {})
      .catch(() => {});
  }
  if (run.threadId && run.probeMessageId) {
    await deleteThreadMessage(run.threadId, run.probeMessageId);
  }
  if (run.threadId) await deleteThread(run.threadId);
  await setLfgBoardEnabled(run.ctx.api, false).catch((err: unknown) => {
    console.log(
      `  [lfg-board] could not disable the board in cleanup: ${String(err)}`,
    );
  });
  // Only a forum THIS run caused to exist is deleted. Deleting one that
  // predates the run would destroy an operator's board.
  if (!run.forumPreexisting && run.forumChannelId) {
    await deleteForumChannel(run.forumChannelId);
  }
}

const lfgBoardLifecycle: SmokeTest = {
  name: "LFG board: quiet on hand 1, one forum thread edited in place through conversion",
  category: "embed",
  run(ctx) {
    return withLfgSurface("lfg-board", async () => {
      const game = await pickIdleGame(ctx);
      const run: Run = {
        ctx,
        game,
        forumPreexisting: false,
        preexistingThreads: new Set<string>(),
      };
      try {
        await enableBoard(run);
        await assertQuietOnFirstHand(run);
        await assertPostsOnSecondHand(run);
        await assertBoardIsBotWriteOnly(run);
        await assertEditsOnThirdHand(run);
        await assertMirrorsCompanionReply(run);
        const poll = await createPollForGroup(run);
        await assertConvertedThread(run, poll);
        await assertExactlyOneThread(run);
      } finally {
        await cleanup(run);
      }
    });
  },
};

export const lfgBoardTests: SmokeTest[] = [lfgBoardLifecycle];
