/**
 * ROK-1522 — what an LFG smoke run may touch: which GAMES it may pick, and
 * which forum THREADS it may delete afterwards.
 *
 * Pure on purpose (no discord.js, no API client): `lfg-smoke-scope.spec.ts`
 * runs it in the GitHub `lint` job with no guild and no env.
 *
 * GAME WINDOWS. Every LFG suite scans the admin registry from its END. Before
 * this module, `lfm-embed.test.ts` and `lfm-playing.test.ts` took the last 8
 * games with no offset, so on any env with the full seed they converged on the
 * newest game (Chao Chao, `api/src/games-lookup/seed-games.data.ts`) and, with
 * the board on, filled the operator's forum with its threads. The windows now
 * live in one place so the three suites cannot drift back onto each other:
 *
 *   reversed registry:  [0 .. 8)   skipped (newest games — the old default)
 *                       [8 .. 16)  lfg-board.test.ts   (BOARD_SCAN_OFFSET)
 *                       [16 .. 24) lfm-embed / lfm-playing (LFM_SCAN_OFFSET)
 *
 * The LFM suites deliberately do NOT share the board's offset: the board
 * started past the LFM window precisely so the two never contend for one
 * group (a game the sibling suite already converted is no longer idle for
 * either). Sharing the offset would reintroduce that collision.
 *
 * On a mid-size registry (10..17 games) only the board window fits. The LFM
 * suites then scan the games between the newest one and the board window
 * (reversed [1 .. 8)), so they avoid both the board's games and Chao Chao.
 *
 * On a short registry (the CI seed has seven games) neither window fits and
 * each suite keeps its pre-ROK-1522 fallback: LFM newest-first, the board
 * oldest-first, so the two meet as late as possible.
 */
import type { ForumThreadSnapshot } from './fixtures-lfg-board.js';

/** How many games each suite probes for an idle one before giving up. */
export const GAME_SCAN_LIMIT = 8;
/** `lfg-board.test.ts` starts here in the reversed registry. */
export const BOARD_SCAN_OFFSET = 8;
/** The LFM suites start past the board's window, never on the newest games. */
export const LFM_SCAN_OFFSET = BOARD_SCAN_OFFSET + GAME_SCAN_LIMIT;

/** The window at `offset`, or null when the registry is too short for it. */
function windowAt<T>(reversed: T[], offset: number): T[] | null {
  return reversed.length > offset + 1
    ? reversed.slice(offset, offset + GAME_SCAN_LIMIT)
    : null;
}

/** Candidate games for `lfg-board.test.ts`, in scan order. */
export function boardCandidates<T>(games: T[]): T[] {
  const reversed = games.slice().reverse();
  return (
    windowAt(reversed, BOARD_SCAN_OFFSET) ??
    reversed.slice(0, GAME_SCAN_LIMIT).reverse()
  );
}

/** Candidate games for `lfm-embed.test.ts` / `lfm-playing.test.ts`. */
export function lfmCandidates<T>(games: T[]): T[] {
  const reversed = games.slice().reverse();
  const lfm = windowAt(reversed, LFM_SCAN_OFFSET);
  if (lfm) return lfm;
  // Board window in use: take the games before it, skipping the newest.
  if (windowAt(reversed, BOARD_SCAN_OFFSET)) {
    return reversed.slice(1, BOARD_SCAN_OFFSET);
  }
  return reversed.slice(0, GAME_SCAN_LIMIT);
}

/** Discord's epoch (2015-01-01T00:00:00Z) — snowflakes count from it. */
const DISCORD_EPOCH_MS = 1_420_070_400_000;

/**
 * Laptop/runner clock vs Discord's clock. A thread created just after the
 * sweep was armed must not be missed because the local clock runs ahead;
 * the preexisting-id set, not this window, is what excludes older threads.
 */
export const SWEEP_CLOCK_SKEW_MS = 60_000;

/** When Discord minted a snowflake id, in epoch ms. */
export function snowflakeTimestampMs(id: string): number {
  return Number(BigInt(id) >> 22n) + DISCORD_EPOCH_MS;
}

/** Everything the thread filter needs to decide "ours". */
export interface SweepScope {
  /** The env's bot. Null means unknown — and unknown deletes NOTHING. */
  botUserId: string | null;
  /** `Date.now()` when the sweep was armed. */
  sinceMs: number;
  /** Thread ids already in the forum when the sweep was armed. */
  preexisting: ReadonlySet<string>;
  /** `threadNamePrefix(game.name)` — the head every name of the group shares. */
  namePrefix: string;
}

/**
 * May this run delete this thread? Every clause must hold — it FAILS CLOSED:
 *
 *  - authored by this env's bot (never another slot's bot, never a human);
 *  - not in the forum when the sweep was armed;
 *  - minted no earlier than the arm time (less the clock-skew allowance);
 *  - named for THIS run's game (not the intro post, not a sibling test's group).
 */
export function isSweepableThread(
  thread: Pick<ForumThreadSnapshot, 'id' | 'name' | 'ownerId'>,
  scope: SweepScope,
): boolean {
  if (!scope.botUserId || thread.ownerId !== scope.botUserId) return false;
  if (scope.preexisting.has(thread.id)) return false;
  if (!/^\d+$/.test(thread.id)) return false;
  const minted = snowflakeTimestampMs(thread.id);
  if (minted < scope.sinceMs - SWEEP_CLOCK_SKEW_MS) return false;
  return thread.name.startsWith(scope.namePrefix);
}
