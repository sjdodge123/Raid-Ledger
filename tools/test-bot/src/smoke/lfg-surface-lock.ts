/**
 * ROK-1471 — serialise the two smoke tests that contend for the LFG post SURFACE.
 *
 * `resolveLfgBoardSurface` (api `lfg-board/lfg-board-surface.helpers.ts`) puts
 * step 0 — the forum — AHEAD of every per-game text binding, for EVERY group,
 * whenever the board's master toggle is on. That toggle is one global settings
 * row. So while `lfg-board.test.ts` holds it on, the ROK-1454 group driven by
 * `lfm-embed.test.ts` posts into the FORUM, its text-channel poll times out,
 * and a test that did nothing wrong goes red.
 *
 * In GitHub CI the two tests run in different `SMOKE_CATEGORY` steps — separate
 * processes — so this lock is a no-op there. It exists for the UNFILTERED
 * `npm run smoke` that `validate-ci.sh` and the fleet gate run, where every
 * `embed` test runs five at a time inside ONE process.
 *
 * A promise chain rather than a lock with a deadline: the smoke runner imposes
 * no per-test timeout (`run.ts::runTest` only retries on timeouts raised by the
 * poll helpers), and a lock that gave up would reintroduce exactly the flake it
 * was added to remove.
 */

/** The tail of the queue. Each caller awaits the previous holder's release. */
let tail: Promise<unknown> = Promise.resolve();

/**
 * Run `fn` with exclusive use of the global LFG post-surface setting.
 *
 * @param label - Test name, logged so a stalled queue is legible in the output.
 * @param fn - The section that reads or writes the board toggle.
 * @returns Whatever `fn` returns. The lock is released even when `fn` throws —
 *   a holder that failed must not wedge every later test.
 */
export async function withLfgSurface<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = tail;
  let release!: () => void;
  tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  // A previous holder's REJECTION is its own test's failure, never ours.
  await previous.catch(() => undefined);
  console.log(`  [lfg-surface] ${label} holds the LFG surface lock`);
  try {
    return await fn();
  } finally {
    release();
  }
}
