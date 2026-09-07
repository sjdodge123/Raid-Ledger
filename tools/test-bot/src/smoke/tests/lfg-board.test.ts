/**
 * LFG forum-board smoke test (ROK-1471 AC16 / T24-T27, ROK-1505 T30).
 *
 * Drives ONE group through its whole life on the FORUM surface and asserts the
 * things the design promises. It is the sibling of `lfm-embed.test.ts`,
 * which asserts the lifecycle on the TEXT surface — and it deliberately
 * re-asserts 1454's roster regression (T27) because this story renders the same
 * roster through a different surface adapter, where it can be lost again.
 *
 * ROK-1505 rewrote the first two phases: the board is the always-on directory,
 * so EVERY active hand is posted. ("LFG is quiet, LFM is loud" now describes
 * the TEXT surface only — see `lfm-embed.test.ts`.)
 *
 *   T24. ONE hand opens exactly one thread within one embed sync, titled with
 *        the web chip's sentence (`· 1 looking · needs 1 more`), tagged
 *        `LOOKING`, and carrying a LIVE `+1` button row (and therefore NO
 *        masked group link in the description).
 *   T25. The 1 -> 2 transition EDITS that thread — same id, same starter
 *        message — to the LFM state. A SECOND thread is the expensive defect:
 *        the room was already announced.
 *   T29. (ROK-1493) The board is bot-write-only: a plain member cannot OPEN a
 *        post, can still REPLY inside one, and the forum topic carries the
 *        ownership sentinel. Numbered T29 because ROK-1483 owns T28.
 *   T30. (ROK-1505) Withdrawing back to one hand DOWNGRADES the post in place
 *        (`LOOKING` again, still open); the LAST hand leaving closes and
 *        archives it; the next hand opens a NEW post, which upgrades as T25.
 *   T26. Every later hand EDITS the starter message; its id never changes, and
 *        the thread NAME catches up once the debounce is flushed.
 *   T27. Conversion retags to SCHEDULED, drops the button row, archives the
 *        thread, and still names every player.
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
 * `withLfgSurface` — see `lfg-surface-lock.ts` for why. The hand-count phases
 * live in `../lfg-board-hands.ts`; the shared record in `../lfg-board-shared.ts`.
 */
import { pollForCondition } from '../../helpers/polling.js';
import {
  awaitProcessing,
  convertLfg,
  seedFixtureUser,
  withdrawLfgIntent,
} from '../fixtures.js';
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
} from '../fixtures-lfg-board.js';
import {
  assertClosesOnLastWithdraw,
  assertDowngradeOnWithdraw,
  assertPostsOnFirstHand,
  assertUpgradesOnSecondHand,
} from '../lfg-board-hands.js';
import {
  assertSameStarter,
  describeThreads,
  expectedThreadName,
  forumId,
  INTRO_TITLE,
  isGroupThread,
  JOIN_LABEL,
  pollForThread,
  readGroup,
  starterEmbed,
  type Run,
} from '../lfg-board-shared.js';
import { withLfgSurface } from '../lfg-surface-lock.js';
import type { SmokeTest, TestContext } from '../types.js';

/**
 * `LFG_BOARD_TAGS` — the forum's lifecycle tags, verbatim. A hand-copied
 * literal (the companion bot does not depend on the api workspace), so it goes
 * stale when a tag is appended: ROK-1494's `PLAYING NOW` was missing until
 * ROK-1505 appended it together with its own `LOOKING`.
 */
const BOARD_TAGS = [
  'NEEDS PLAYERS',
  'READY TO SCHEDULE',
  'SCHEDULED',
  'EXPIRED',
  'CLOSED',
  'PLAYING NOW',
  'LOOKING',
];
/**
 * `LFG_BOARD_TOPIC_SENTINEL`, mirrored from
 * `api/src/discord-bot/lfg-board/lfg-board-permissions.helpers.ts`. U+00B7
 * MIDDLE DOT, exactly as that constant spells it. Kept as a literal rather
 * than imported: the companion bot does not depend on the api workspace.
 */
const TOPIC_SENTINEL = '\u00b7 raid-ledger:lfg-board';
/** The post T29 tries — and must never manage — to open. */
const REFUSED_POST_TITLE = 'ROK-1493 smoke - must be refused';
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

/**
 * A game nobody is currently looking for.
 *
 * Re-scanned every run so a leaked intent from a failed run costs the next run
 * a different game rather than a false failure.
 */
async function pickIdleGame(
  ctx: TestContext,
): Promise<{ id: number; name: string }> {
  const res = await ctx.api.get<{ data: { id: number; name: string }[] }>(
    '/admin/settings/games?limit=100',
  );
  const reversed = (res.data ?? []).slice().reverse();
  const window =
    reversed.length > GAME_SCAN_OFFSET + 1
      ? reversed.slice(GAME_SCAN_OFFSET, GAME_SCAN_OFFSET + GAME_SCAN_LIMIT)
      : reversed.slice(0, GAME_SCAN_LIMIT);
  if (window.length === 0) throw new Error('LFG board: no games in the registry');
  for (const game of window) {
    const group = await readGroup(ctx, game.id);
    if (group.activeCount === 0) return game;
  }
  throw new Error(
    `LFG board: all ${window.length} candidate games already have active LFG ` +
      `intents — clear them before re-running (ids: ${window
        .map((g) => g.id)
        .join(', ')})`,
  );
}

/** Enable the board and wait until its forum + intro post are provisioned. */
async function enableBoard(run: Run): Promise<void> {
  const before = await getLfgBoard(run.ctx.api);
  run.forumPreexisting = await forumExists(before.channelId);
  const put = await setLfgBoardEnabled(run.ctx.api, true);
  if (!put.enabled) {
    throw new Error(
      'AC16 step 1: PUT /admin/settings/discord-bot/lfg-board {enabled:true} ' +
        `answered { enabled: ${String(put.enabled)} } — the toggle did not persist`,
    );
  }
  // Advisory, never fatal: preflight reporting a missing grant explains a later
  // timeout far better than it predicts one.
  if (put.warning) run.warning = put.warning.missing.join(', ');
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
      return (await forumExists(settings.channelId)) ? settings.channelId : null;
    }, BOARD_READY_MS);
  } catch {
    const settings = await getLfgBoard(run.ctx.api);
    const warn = run.warning
      ? ` The toggle also warned the bot is missing [${run.warning}].`
      : '';
    throw new Error(
      `AC16 step 1: enabling the board must create a forum channel, but after ` +
        `${String(BOARD_READY_MS)}ms GET /admin/settings/discord-bot/lfg-board ` +
        `still answers { enabled: ${String(settings.enabled)}, channelId: ` +
        `${settings.channelId ?? 'null'} } and no forum with that id exists ` +
        `in the guild.${warn}`,
    );
  }
}

/** AC6: the forum offers every lifecycle tag the author line uses. */
async function assertForumTags(run: Run): Promise<void> {
  const tags = await readForumTagNames(forumId(run));
  const missing = BOARD_TAGS.filter((t) => !tags.includes(t));
  if (missing.length > 0) {
    throw new Error(
      `AC16 step 1: the board forum ${forumId(run)} must offer the ` +
        `lifecycle tags, missing [${missing.join(', ')}] — it offers ` +
        `[${tags.join(', ')}]`,
    );
  }
}

/** Invoke `/lfg game:<id>` through the DEMO_MODE harness. */
function invokeLfg(
  ctx: TestContext,
  discordUserId: string,
  game: string,
): Promise<HarnessReply> {
  return ctx.api.post<HarnessReply>('/admin/test/slash-command', {
    commandName: 'lfg',
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
      'T29 (R2) precondition: expected T24 to have recorded the group thread ' +
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
  const reply = await invokeLfg(run.ctx, run.third.discordId, String(run.game.id));
  const replyAuthor = reply.embeds?.[0]?.author?.name ?? '';
  if (!/\b3 looking\b/u.test(replyAuthor)) {
    throw new Error(
      `T26: /lfg should have raised the third hand and answered with the group ` +
        `state, got author "${replyAuthor}" / content "${reply.content ?? ''}"`,
    );
  }
  await awaitProcessing(run.ctx.api);
  const edited = await pollForThread(
    run,
    (t) =>
      t.id === run.threadId &&
      /\b3 looking\b/u.test(t.starterMessage?.embeds[0]?.author ?? ''),
    `T26: the third hand must EDIT the starter message of thread ` +
      `${run.threadId ?? '?'} to say "3 looking"`,
  );
  assertSameStarter(run, edited, 'T26');
  await assertRenamedAfterFlush(run);
  await captureRoster(run);
}

/** The rename is debounced; flush it, then the name must catch up. */
async function assertRenamedAfterFlush(run: Run): Promise<void> {
  await flushLfgBoard(run.ctx.api);
  const { viabilityThreshold } = await readGroup(run.ctx, run.game.id);
  const expected = expectedThreadName(run.game.name, 3, viabilityThreshold);
  await pollForThread(
    run,
    (t) => t.id === run.threadId && t.name === expected,
    `T26: after POST /admin/test/lfg-board/flush drained the rename debounce, ` +
      `thread ${run.threadId ?? '?'} must be named "${expected}"`,
  );
}

/** Capture the roster while the LIVE read still works (see T27). */
async function captureRoster(run: Run): Promise<void> {
  const group = await readGroup(run.ctx, run.game.id);
  run.rosterNames = group.members.map((m) => m.displayName ?? m.username);
  if (run.rosterNames.length !== 3) {
    throw new Error(
      `T26 precondition: expected a 3-player roster before conversion, got ` +
        `${String(run.rosterNames.length)} ([${run.rosterNames.join(', ')}])`,
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
  const poll = await run.ctx.api.post<SchedulingPoll>('/scheduling-polls', {
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
      /SCHEDULED/u.test(t.starterMessage?.embeds[0]?.author ?? ''),
    `T27: converting the group must rewrite thread ${run.threadId ?? '?'}'s ` +
      `starter embed to the SCHEDULED author line`,
  );
  assertSameStarter(run, converted, 'T27');
  const components = converted.starterMessage?.components ?? [];
  if (components.length > 0) {
    throw new Error(
      `T27: the converted post must carry NO components — a pressable ` +
        `"${JOIN_LABEL}" on a scheduled group is a trap — got ` +
        `[${components.map((c) => c.label ?? 'null').join(', ')}]`,
    );
  }
  assertRosterSurvived(run, starterEmbed(run, converted).description ?? '');
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
      t.appliedTagNames.includes('SCHEDULED'),
    `T27: the converted thread ${run.threadId ?? '?'} must end up ARCHIVED and ` +
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
        `missing [${missing.join(', ')}]. This is 1454's round-1 defect (the ` +
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
        `(the one T30 re-opened at the FIRST hand, ${run.threadId ?? '?'}) in ` +
        `board ${forumId(run)} for the whole run, found ${mine.length}: ` +
        `${describeThreads(mine)} — a terminal state must EDIT, never post a ` +
        `second card`,
    );
  }
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
    await run.ctx.api.post(`/lineups/${run.lineupId}/abort`, {}).catch(() => {});
  }
  if (run.threadId) await deleteThread(run.threadId);
  for (const id of run.retiredThreadIds) await deleteThread(id);
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
  name: 'LFG board: every hand posts — one forum thread per group, edited in place through conversion',
  category: 'embed',
  run(ctx) {
    return withLfgSurface('lfg-board', async () => {
      const game = await pickIdleGame(ctx);
      const run: Run = {
        ctx,
        game,
        forumPreexisting: false,
        preexistingThreads: new Set<string>(),
        retiredThreadIds: [],
      };
      try {
        await enableBoard(run);
        await assertPostsOnFirstHand(run, 'T24');
        await assertUpgradesOnSecondHand(run, 'T25');
        await assertBoardIsBotWriteOnly(run);
        await assertDowngradeOnWithdraw(run);
        const closed = await assertClosesOnLastWithdraw(run);
        await assertPostsOnFirstHand(run, 'T30 (fresh post)', closed);
        await assertUpgradesOnSecondHand(run, 'T30 (fresh upgrade)');
        await assertEditsOnThirdHand(run);
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
