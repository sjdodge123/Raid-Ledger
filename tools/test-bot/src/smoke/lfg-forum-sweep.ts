/**
 * ROK-1522 — delete the forum threads an LFM smoke test's hands spawned.
 *
 * `lfg-board.test.ts` records and deletes its own thread. The LFM suites did
 * not: they poll a TEXT binding, but whenever the board's master toggle is on
 * (a fleet env, or a local env carrying the operator's settings) ROK-1505 puts
 * the forum AHEAD of that binding, so every hand opened a forum post that
 * nothing ever removed.
 *
 * Usage, INSIDE the test's `withLfgSurface` callback so no other LFG test can
 * touch the board between arm and sweep:
 *
 *   const sweep = await armForumSweep(ctx.api, game.name);   // before hand 1
 *   try { ... } finally { ...withdraw hands...; await sweepForumThreads(ctx.api, sweep); }
 *
 * Which threads qualify is decided by the pure {@link isSweepableThread}
 * (authored by this env's bot, new since arm, named for this game). Both
 * functions reuse the board fixtures in `fixtures-lfg-board.ts` and NEVER
 * throw: they run around and inside `finally`, where a cleanup error would
 * replace the test's real failure with its own.
 */
import { getApiBotUserId } from '../helpers/bot-author.js';
import type { ApiClient } from './api.js';
import { awaitProcessing } from './fixtures.js';
import {
  deleteThread,
  forumExists,
  getLfgBoard,
  readForumThreads,
} from './fixtures-lfg-board.js';
import { threadNamePrefix } from './lfg-board-shared.js';
import { isSweepableThread, type SweepScope } from './lfg-smoke-scope.js';

/** An armed sweep — the scope the teardown filters against. */
export type ForumSweep = Omit<SweepScope, 'botUserId'>;

/** The board's forum id when the board has one that still exists, else null. */
async function liveForumId(api: ApiClient): Promise<string | null> {
  const board = await getLfgBoard(api);
  const id = board.channelId ?? null;
  return (await forumExists(id)) ? id : null;
}

/**
 * Record the forum's current threads and the time. Call it after the game is
 * picked and BEFORE the first hand. A board that is off, unprovisioned or
 * unreadable arms an empty set — the time window still guards the sweep.
 */
export async function armForumSweep(
  api: ApiClient,
  gameName: string,
): Promise<ForumSweep> {
  const sweep: ForumSweep = {
    sinceMs: Date.now(),
    preexisting: new Set<string>(),
    namePrefix: threadNamePrefix(gameName),
  };
  try {
    const forumId = await liveForumId(api);
    if (forumId) {
      const ids = (await readForumThreads(forumId)).map((t) => t.id);
      sweep.preexisting = new Set(ids);
    }
  } catch (err) {
    console.log(`  [lfg-sweep] could not snapshot the forum: ${String(err)}`);
  }
  return sweep;
}

/**
 * Delete every thread this run's hands spawned. Call it LAST in `finally`,
 * after the hands are withdrawn. Tolerates a board that is off, a forum that
 * is gone, and threads already deleted (`deleteThread` swallows the 404).
 */
export async function sweepForumThreads(
  api: ApiClient,
  sweep: ForumSweep,
): Promise<void> {
  const botUserId = getApiBotUserId();
  if (!botUserId) {
    // Fail CLOSED: without the env's bot id nothing can be proven ours.
    console.log('  [lfg-sweep] bot user id unknown — deleting nothing');
    return;
  }
  try {
    // Let any in-flight hand finish posting before the forum is read.
    await awaitProcessing(api).catch(() => undefined);
    const forumId = await liveForumId(api);
    if (!forumId) return;
    const scope: SweepScope = { ...sweep, botUserId };
    const ours = (await readForumThreads(forumId)).filter((t) =>
      isSweepableThread(t, scope),
    );
    for (const t of ours) await deleteThread(t.id);
    if (ours.length > 0) {
      console.log(`  [lfg-sweep] deleted ${ours.length} forum thread(s)`);
    }
  } catch (err) {
    console.log(`  [lfg-sweep] forum sweep failed: ${String(err)}`);
  }
}
