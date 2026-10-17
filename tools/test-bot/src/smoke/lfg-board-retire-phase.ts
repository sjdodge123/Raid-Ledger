/**
 * ROK-1523 — the board-toggle phase of the LFG board smoke.
 *
 * Its own file rather than a sixth phase in `lfg-board-hands.ts`, which is at
 * its 300-line cap. The hand-count phases there assert the state machine a
 * GROUP drives; this one asserts what the OPERATOR's master toggle does to a
 * post that is already live, which is a different axis entirely.
 */
import {
  flushLfgBoard,
  setLfgBoardEnabled,
} from './fixtures-lfg-board.js';
import {
  assertComposerCleared,
  assertComposerPinned,
} from './lfg-composer-pin.js';
import {
  assertAuthor,
  assertSameStarter,
  assertTag,
  isGroupThread,
  pollForThread,
  starterEmbed,
  type Run,
} from './lfg-board-shared.js';

/** The 2+ open states (ROK-1454 D7) — what a re-posted card must come back as. */
const LFM_OPEN_AUTHOR = /NEEDS PLAYERS|READY TO SCHEDULE/u;

/**
 * `LFG_BOARD_RETIRED_NOTE` — the description line the farewell card leads with.
 *
 * Pinned as a literal, deliberately. The point of this phase is the WORDS the
 * operator sees, so importing the constant (which the smoke cannot do — it is
 * api-side) or matching a loose fragment would let the copy drift silently.
 */
const RETIRED_NOTE =
  'The LFG board was switched off — this group is still live on the site.';
/** The retired author line: names the BOARD, never the group (ROK-1523). */
const RETIRED_AUTHOR = /BOARD OFF/u;
/** The card must NEVER use the vocabulary of cancellation. */
const CANCELLED = /cancel/iu;

/**
 * ROK-1523 — switching the board OFF retires the live post, and ON brings it
 * back.
 *
 * Runs with the group at TWO live hands, so the post being retired is a real
 * in-flight one. Both halves matter and neither is observable on its own:
 *
 *  - **off** must EDIT the existing post to the farewell render and archive it
 *    (never delete it, never leave it open and updating), and the copy must say
 *    the board went away rather than the group;
 *  - **on** must post a FRESH card for the same still-live group, with no new
 *    hand raised. That is the half the round-1 integration spec faked by adding
 *    a second hand.
 *
 * The retired thread is retired into `preexistingThreads` + `retiredThreadIds`
 * exactly as T30 does, so the one-thread invariant still holds afterwards and
 * cleanup deletes it.
 *
 * Deterministic throughout: the admin PUT answers for the SAVE and runs the
 * retire pass in the background (a busy board outlasts nginx's 60s), so every
 * wait here is a poll on observable Discord state, never a sleep.
 *
 * @param run - The active run, at two live hands.
 */
export async function assertRetiresOnDisable(run: Run): Promise<void> {
  const liveThreadId = run.threadId;
  await setLfgBoardEnabled(run.ctx.api, false);

  const retired = await pollForThread(
    run,
    (t) =>
      t.id === liveThreadId &&
      RETIRED_AUTHOR.test(t.starterMessage?.embeds[0]?.author ?? ''),
    `ROK-1523: disabling the board must EDIT the live thread ` +
      `${liveThreadId ?? '?'} to the BOARD OFF farewell render`,
  );
  assertSameStarter(run, retired, 'ROK-1523 (retire edits, never re-posts)');
  const embed = starterEmbed(run, retired);
  assertRetiredCopy(embed, retired.id);
  await flushLfgBoard(run.ctx.api);
  const archived = await pollForThread(
    run,
    (t) => t.id === retired.id && t.archived,
    `ROK-1523: the retired thread ${retired.id} must end up ARCHIVED — a ` +
      `board that is off must not leave live posts on the forum`,
  );
  // The tag stays the neutral terminal one; nothing the board creates may
  // imply the GROUP was cancelled.
  assertTag(archived, 'CLOSED', 'ROK-1523 (retired tag stays neutral)');
  run.preexistingThreads.add(retired.id);
  run.retiredThreadIds.push(retired.id);
  // ROK-1658 — the composer rides the board: off takes its button down...
  await assertComposerCleared(run);

  await assertRepostsOnEnable(run, retired.id);
  // ...and on puts it back, with no composer setting of its own.
  await assertComposerPinned(run);
}

/** The farewell copy: says what happened to the BOARD, never "cancelled". */
function assertRetiredCopy(
  embed: { author: string | null; description: string | null },
  threadId: string,
): void {
  const description = embed.description ?? '';
  if (!description.includes(RETIRED_NOTE)) {
    throw new Error(
      `ROK-1523: the retired card on thread ${threadId} must carry the note ` +
        `"${RETIRED_NOTE}" so the group knows it survives on the site, got ` +
        `description "${description}"`,
    );
  }
  const whole = `${embed.author ?? ''}\n${description}`;
  if (CANCELLED.test(whole)) {
    throw new Error(
      `ROK-1523: the retired card on thread ${threadId} must never read as a ` +
        `cancellation — the group is untouched. Rendered: "${whole}"`,
    );
  }
}

/**
 * The other half: re-enabling posts a FRESH card for the still-live group.
 *
 * No hand is raised here on purpose — the toggle alone has to bring the board
 * back, which is the acceptance criterion. The new post is re-bound onto the
 * run so the later phases keep asserting against the card that is actually live.
 *
 * @param run - The active run.
 * @param retiredThreadId - The thread the disable just archived.
 */
async function assertRepostsOnEnable(
  run: Run,
  retiredThreadId: string,
): Promise<void> {
  await setLfgBoardEnabled(run.ctx.api, true);
  const fresh = await pollForThread(
    run,
    (t) => t.id !== retiredThreadId && !t.archived && isGroupThread(run, t),
    `ROK-1523: re-enabling the board must post a FRESH card for the group ` +
      `that is still live on "${run.game.name}" — no new hand was raised, ` +
      `and thread ${retiredThreadId} is archived`,
  );
  const embed = starterEmbed(run, fresh);
  assertAuthor(
    embed,
    LFM_OPEN_AUTHOR,
    'ROK-1523: the fresh card must come back in an OPEN state, not terminal',
  );
  run.threadId = fresh.id;
  run.starterMessageId = fresh.starterMessage?.id;
}
