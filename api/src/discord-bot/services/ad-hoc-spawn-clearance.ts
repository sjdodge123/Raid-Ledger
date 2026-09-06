/**
 * ROK-1456 — `SpawnClearance`: the single-use receipt proving the ROK-959
 * scheduled-event suppression guard ran for a `(binding, game)` pair and found
 * no live scheduled event.
 *
 * The guard (`suppressScheduled`: one read + a monotonic `extended_until`
 * write) is run ONLY by `checkSuppression` below, which is the sole place a
 * receipt is constructed — the class itself is not exported, so nothing else
 * can mint one. `spawnNewEvent` requires a receipt, so at the type level no
 * call site can reach a spawn without the guard having run; the class is
 * nominal (private state) so a structural look-alike does not type-check.
 *
 * A receipt is bound to `(bindingId, gameId)` and consumable exactly once. The
 * listener's immediate-spawn path hands its receipt to `handleVoiceJoin` so the
 * spawn join runs the guard once instead of twice; a stale, foreign or spent
 * receipt is rejected and the guard re-runs. Delayed-spawn timers deliberately
 * carry NO receipt — one minted at join time would be 15 minutes stale at fire
 * time and could let an ad-hoc event spawn over a scheduled one.
 */
import { Logger } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import { suppressScheduled } from './ad-hoc-suppression.helpers';

type Db = PostgresJsDatabase<typeof schema>;

const logger = new Logger('AdHocSpawnClearance');

class SpawnClearanceReceipt {
  private used = false;

  constructor(
    private readonly bindingId: string,
    private readonly gameId: number | null | undefined,
    readonly channelId: string | undefined,
  ) {}

  /** True when the receipt was minted for exactly this `(binding, game)`. */
  matches(bindingId: string, gameId: number | null | undefined): boolean {
    return this.bindingId === bindingId && this.gameId === gameId;
  }

  /** Mark the receipt spent. Returns false if it was already consumed. */
  consume(): boolean {
    if (this.used) return false;
    this.used = true;
    return true;
  }
}

export type SpawnClearance = SpawnClearanceReceipt;

/**
 * Run the ROK-959 guard once. Returns `null` (after bound-extending the live
 * scheduled event's `extended_until` window) when ad-hoc creation is
 * suppressed; otherwise the receipt the spawn path must present.
 */
export async function checkSuppression(
  db: Db,
  bindingId: string,
  gameId: number | null | undefined,
  channelId?: string,
): Promise<SpawnClearance | null> {
  if (await suppressScheduled(db, bindingId, gameId, channelId)) return null;
  return new SpawnClearanceReceipt(bindingId, gameId, channelId);
}

/**
 * Honour a supplied receipt only when it was minted for exactly this
 * `(binding, game)` and has not been spent; anything else falls back to
 * running the guard here, so a receipt can never bypass ROK-959.
 */
export async function resolveSpawnClearance(
  db: Db,
  bindingId: string,
  gameId: number | null | undefined,
  channelId: string | undefined,
  supplied?: SpawnClearance,
): Promise<SpawnClearance | null> {
  // Commit A (ROK-1456): the receipt is threaded but not yet honoured, so the
  // pre-existing duplicate guard run is preserved byte-for-byte.
  void supplied;
  void logger;
  return checkSuppression(db, bindingId, gameId, channelId);
}
