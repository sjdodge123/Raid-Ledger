/**
 * The LFG board's hand-count phases (ROK-1505 T24 / T25 / T30).
 *
 * ROK-1505 makes the board post EVERY active hand: one hand opens a post
 * tagged `LOOKING` and titled with the web chip's sentence, the second hand
 * upgrades that SAME post to the LFM state, a withdrawal back to one hand
 * downgrades it in place, and only the LAST hand leaving closes and archives
 * it — after which the next hand opens a NEW post. Each phase here is one row
 * of the spec's state-machine table, asserted against a real forum.
 *
 * Extracted from `tests/lfg-board.test.ts` for its counted-line cap; the
 * shared record and helpers live in `lfg-board-shared.ts`.
 */
import {
  awaitProcessing,
  postLfgIntent,
  seedFixtureUser,
} from './fixtures.js';
import {
  flushLfgBoard,
  readForumThreads,
  type ForumThreadSnapshot,
} from './fixtures-lfg-board.js';
import {
  assertAuthor,
  assertSameStarter,
  assertTag,
  assertThreadName,
  describeThreads,
  expectedThreadName,
  forumId,
  isGroupThread,
  JOIN_CUSTOM_ID,
  JOIN_LABEL,
  OPEN_GROUP_LABEL,
  pollForThread,
  readGroup,
  starterEmbed,
  type Run,
} from './lfg-board-shared.js';

/** `LFG_BOARD_TAGS[6]` — the one-hand tag (ROK-1505 D7). */
const LOOKING_TAG = 'LOOKING';
/** The 2+ open states (ROK-1454 D7) — what a `LOOKING` post upgrades to. */
const LFM_OPEN_AUTHOR = /NEEDS PLAYERS|READY TO SCHEDULE/u;

/**
 * T24 — the FIRST hand opens a post (ROK-1505 AC1).
 *
 * Also re-run as the tail of T30 with `retiredThreadId` set: a hand raised
 * after the last one left must open a NEW post, never revive the closed one.
 */
export async function assertPostsOnFirstHand(
  run: Run,
  label: string,
  retiredThreadId?: string,
): Promise<void> {
  const first = await postLfgIntent(run.ctx.api, run.game.id);
  if (first.group.activeCount !== 1) {
    throw new Error(
      `${label} precondition: expected activeCount 1 after the first hand on ` +
        `"${run.game.name}", got ${String(first.group.activeCount)} — the ` +
        `group was not idle, so the one-hand assertions would be vacuous`,
    );
  }
  const threshold = first.group.viabilityThreshold;
  await awaitProcessing(run.ctx.api);
  const found = await pollForThread(
    run,
    (t) =>
      isGroupThread(run, t) || (t.id === retiredThreadId && !t.archived),
    `${label}: ONE hand must open a forum post for "${run.game.name}" in ` +
      `board ${forumId(run)} within one embed sync (ROK-1505 — every active ` +
      `hand is posted), and none appeared`,
  );
  if (retiredThreadId !== undefined && found.id === retiredThreadId) {
    throw new Error(
      `${label} (AC3): a hand raised after the last one left must open a NEW ` +
        `post; the CLOSED thread ${retiredThreadId} was re-opened instead ` +
        `(archived=${String(found.archived)}, tags ` +
        `[${found.appliedTagNames.join(', ')}])`,
    );
  }
  assertThreadName(run, found, 1, threshold, label);
  const thread = await pollForStarter(run, found, label);
  run.threadId = thread.id;
  run.starterMessageId = thread.starterMessage?.id;
  assertLookingState(run, thread, label);
  assertOpenButtons(run, thread, label);
}

/**
 * Discord can 404 a forum post's starter message for a moment after the post
 * exists (observed 2026-09-06 on the fleet: thread created and named, starter
 * MISSING on the first read). The snapshot tolerates that, so the starter is
 * polled for on its own before it is asserted.
 */
function pollForStarter(
  run: Run,
  found: ForumThreadSnapshot,
  label: string,
): Promise<ForumThreadSnapshot> {
  return pollForThread(
    run,
    (t) => t.id === found.id && t.starterMessage !== null,
    `${label}: thread ${found.id} ("${found.name}") was created and named, ` +
      'but its starter message never became readable',
  );
}

/**
 * Re-read a thread AFTER draining the board's rename/tag debounce.
 *
 * The starter EMBED and the forum TAG are separate writes: the embed edit goes
 * out immediately, the tag and title go through the D10 debouncer. So polling
 * on the embed proves nothing about the tag, and any snapshot taken by that
 * poll has stale tags BY CONSTRUCTION. Every tag assertion goes through here.
 *
 * Both directions raced in CI on 2026-09-09 — the upgrade read `[LOOKING]`
 * when it wanted NEEDS PLAYERS, and the downgrade read `[NEEDS PLAYERS]` when
 * it wanted LOOKING. Fixing one call site and not the other just moved the
 * failure, so the flush lives in one helper rather than in each caller.
 *
 * @param run - The run, for the forum id and thread id.
 * @param hasTag - The tag the thread must carry once the debounce has drained.
 * @param label - Phase label for the failure message.
 */
async function drainedThread(
  run: Run,
  hasTag: string,
  label: string,
): Promise<ForumThreadSnapshot> {
  await flushLfgBoard(run.ctx.api);
  return pollForThread(
    run,
    (t) => t.id === run.threadId && t.appliedTagNames.includes(hasTag),
    `${label}: after POST /admin/test/lfg-board/flush drained the tag ` +
      `debounce, thread ${run.threadId ?? '?'} must carry the "${hasTag}" tag`,
  );
}

/** The one-hand render: `LOOKING` in the author line AND as the forum tag. */
function assertLookingState(
  run: Run,
  t: ForumThreadSnapshot,
  label: string,
): void {
  const embed = starterEmbed(run, t);
  assertAuthor(embed, /\bLOOKING\b/u, `${label} author`);
  assertAuthor(embed, /\b1 looking\b/u, `${label} count`);
  const author = embed.author ?? '';
  if (LFM_OPEN_AUTHOR.test(author)) {
    throw new Error(
      `${label}: a one-hand post must not claim an LFM state — "LFM" starts ` +
        `at two hands (Q1) — got author "${author}"`,
    );
  }
  assertTag(t, LOOKING_TAG, label);
}

/** The buttons every OPEN post carries, at one hand as much as at two. */
function assertOpenButtons(run: Run, t: ForumThreadSnapshot, label: string): void {
  const components = t.starterMessage?.components ?? [];
  const expectedId = `${JOIN_CUSTOM_ID}:${String(run.game.id)}`;
  const join = components.find((c) => c.customId === expectedId);
  if (!join || join.label !== JOIN_LABEL) {
    throw new Error(
      `${label}: the open post must carry a LIVE join button (customId ` +
        `"${expectedId}", label "${JOIN_LABEL}"), got components ` +
        `[${components.map((c) => `${c.label ?? 'null'}/${c.customId ?? 'link'}`).join(', ')}]`,
    );
  }
  if (!components.some((c) => c.label === OPEN_GROUP_LABEL)) {
    throw new Error(
      `${label}: the open post must carry the "${OPEN_GROUP_LABEL}" Link ` +
        `button that REPLACES the masked description link, got components ` +
        `[${components.map((c) => c.label ?? 'null').join(', ')}]`,
    );
  }
  const description = starterEmbed(run, t).description ?? '';
  if (/\[Open group/u.test(description)) {
    throw new Error(
      `${label}: the open post carries BOTH the Link button and the masked ` +
        `"[Open group" description link — the button must replace it ` +
        `(linkStyle: 'button'). Description: "${description}"`,
    );
  }
}

/**
 * T25 — the SECOND hand upgrades the SAME post (ROK-1505 AC2).
 *
 * The expensive defect is now a SECOND thread: the one-hand post already
 * announced the room, so the 1 -> 2 transition must edit it, not post again.
 */
export async function assertUpgradesOnSecondHand(
  run: Run,
  label: string,
): Promise<void> {
  run.second ??= await seedFixtureUser(run.ctx.api, 3, 3);
  const second = await postLfgIntent(run.second.api, run.game.id);
  if (second.group.activeCount !== 2) {
    throw new Error(
      `${label} precondition: expected activeCount 2 after the second hand, ` +
        `got ${String(second.group.activeCount)}`,
    );
  }
  const threshold = second.group.viabilityThreshold;
  await awaitProcessing(run.ctx.api);
  const upgraded = await pollForThread(
    run,
    (t) =>
      t.id === run.threadId &&
      /\b2 looking\b/u.test(t.starterMessage?.embeds[0]?.author ?? ''),
    `${label}: the second hand must EDIT the starter message of thread ` +
      `${run.threadId ?? '?'} to say "2 looking" (same thread, same post)`,
  );
  assertSameStarter(run, upgraded, label);
  await assertExactlyOneThread(run, label);
  // The starter EDIT and the tag/rename are separate writes: the embed goes out
  // immediately, the tag and title go through the D10 board debouncer. Polling
  // on the embed therefore proves nothing about the tag, and asserting one off
  // that snapshot raced the window — CI read `[LOOKING]` 9.2s in while the
  // upgrade was still queued (2026-09-09). Drain the debounce, then RE-READ:
  // `upgraded` was captured before the flush and its tags are already stale.
  const author = upgraded.starterMessage?.embeds[0]?.author ?? '';
  const expectedTag = /READY TO SCHEDULE/u.test(author)
    ? 'READY TO SCHEDULE'
    : 'NEEDS PLAYERS';
  const drained = await drainedThread(run, expectedTag, label);
  assertLfmState(run, drained, label);
  assertOpenButtons(run, drained, label);
  await assertRenamedTo(run, 2, threshold, label);
}

/** The 2+ render: an LFM author line, tagged with the state it claims. */
function assertLfmState(run: Run, t: ForumThreadSnapshot, label: string): void {
  const embed = starterEmbed(run, t);
  assertAuthor(embed, LFM_OPEN_AUTHOR, `${label} author`);
  const author = embed.author ?? '';
  if (/\bLOOKING\b/u.test(author)) {
    throw new Error(
      `${label}: at two hands the post must have LEFT the one-hand ` +
        `"LOOKING" state, got author "${author}"`,
    );
  }
  const expected = /READY TO SCHEDULE/u.test(author)
    ? 'READY TO SCHEDULE'
    : 'NEEDS PLAYERS';
  assertTag(t, expected, label);
}

/** One live thread for this game — a hand-count change edits, never posts. */
async function assertExactlyOneThread(run: Run, label: string): Promise<void> {
  const mine = (await readForumThreads(forumId(run))).filter((t) =>
    isGroupThread(run, t),
  );
  if (mine.length !== 1 || mine[0].id !== run.threadId) {
    throw new Error(
      `${label}: expected exactly 1 forum thread for "${run.game.name}" ` +
        `(${run.threadId ?? '?'}, opened at the FIRST hand) in board ` +
        `${forumId(run)}, found ${String(mine.length)}: ` +
        `${describeThreads(mine)} — a hand-count change must EDIT the post, ` +
        `never open a second one`,
    );
  }
}

/** The rename is debounced; flush it, then the name must catch up. */
async function assertRenamedTo(
  run: Run,
  count: number,
  threshold: number | null,
  label: string,
): Promise<void> {
  await flushLfgBoard(run.ctx.api);
  const expected = expectedThreadName(run.game.name, count, threshold);
  await pollForThread(
    run,
    (t) => t.id === run.threadId && t.name === expected,
    `${label}: after POST /admin/test/lfg-board/flush drained the rename ` +
      `debounce, thread ${run.threadId ?? '?'} must be named "${expected}"`,
  );
}

/**
 * T30 (a) — withdrawing the second hand DOWNGRADES the post in place
 * (ROK-1505 D4 / AC3): back to `LOOKING`, back to the one-hand title, still
 * open. Before ROK-1505 this withdrawal archived the post.
 */
export async function assertDowngradeOnWithdraw(run: Run): Promise<void> {
  if (!run.second) {
    throw new Error('T30 precondition: T25 never seeded the second hand');
  }
  await run.second.api.delete(`/lfg/${String(run.game.id)}`);
  const group = await readGroup(run.ctx, run.game.id);
  if (group.activeCount !== 1) {
    throw new Error(
      `T30 precondition: expected activeCount 1 after the second hand ` +
        `withdrew, got ${String(group.activeCount)}`,
    );
  }
  await awaitProcessing(run.ctx.api);
  const downgraded = await pollForThread(
    run,
    (t) =>
      t.id === run.threadId &&
      /\bLOOKING\b/u.test(t.starterMessage?.embeds[0]?.author ?? ''),
    `T30: withdrawing the second hand must EDIT thread ${run.threadId ?? '?'} ` +
      `back to the one-hand "LOOKING" render and keep it OPEN (D4 — only ` +
      `the LAST hand leaving closes a post)`,
  );
  if (downgraded.archived) {
    throw new Error(
      `T30: thread ${downgraded.id} was ARCHIVED on a 2 -> 1 withdrawal; a ` +
        `one-hand group is still a live post (tags ` +
        `[${downgraded.appliedTagNames.join(', ')}])`,
    );
  }
  assertSameStarter(run, downgraded, 'T30');
  const drained = await drainedThread(run, LOOKING_TAG, 'T30');
  assertLookingState(run, drained, 'T30');
  assertOpenButtons(run, drained, 'T30');
  await assertRenamedTo(run, 1, group.viabilityThreshold, 'T30');
}

/**
 * T30 (b) — the LAST hand leaving closes and archives the post (AC3), and
 * retires it so the fresh post that follows is the only live thread.
 *
 * @returns The closed thread's id, for the fresh-post half of T30.
 */
export async function assertClosesOnLastWithdraw(run: Run): Promise<string> {
  await run.ctx.api.delete(`/lfg/${String(run.game.id)}`);
  const group = await readGroup(run.ctx, run.game.id);
  if (group.activeCount !== 0) {
    throw new Error(
      `T30 precondition: expected activeCount 0 after the last hand ` +
        `withdrew, got ${String(group.activeCount)}`,
    );
  }
  await awaitProcessing(run.ctx.api);
  const closed = await pollForThread(
    run,
    (t) =>
      t.id === run.threadId &&
      /\bCLOSED\b/u.test(t.starterMessage?.embeds[0]?.author ?? ''),
    `T30: the last hand withdrawing must EDIT thread ${run.threadId ?? '?'} ` +
      `to the CLOSED author line`,
  );
  assertSameStarter(run, closed, 'T30');
  await flushLfgBoard(run.ctx.api);
  await pollForThread(
    run,
    (t) => t.id === closed.id && t.archived && t.appliedTagNames.includes('CLOSED'),
    `T30: the closed thread ${closed.id} must end up ARCHIVED and tagged ` +
      `"CLOSED" (zero hands is terminal)`,
  );
  run.preexistingThreads.add(closed.id);
  run.retiredThreadIds.push(closed.id);
  return closed.id;
}
