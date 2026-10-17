/**
 * Lock keys for games-name serialization (ROK-1438).
 *
 * Pure key derivation only — the advisory lock itself (`withGameNameLock`,
 * `GAMES_NAME_LOCK_CLASS`) is DB-bound and stays in the api's
 * `igdb/games-name-lock.helpers`. Moved here unchanged (ROK-1668).
 */
import { normalizeForDedup } from './normalize-name.js';

/**
 * Normalized, de-duplicated, SORTED lock keys for `names`.
 *
 * Sorting is what keeps two overlapping batches from deadlocking: every caller
 * acquires the shared subset of keys in the same order, so no cycle can form.
 * Callers that lock a single name can't deadlock regardless.
 *
 * Names that normalize to empty contribute no key — there is nothing for the
 * ROK-1113 guard to match on, so there is nothing to serialize.
 */
export function buildGameNameLockKeys(
  names: string | readonly string[],
): string[] {
  const list = typeof names === 'string' ? [names] : names;
  const keys = new Set<string>();
  for (const name of list) {
    const normalized = normalizeForDedup(name);
    if (normalized) keys.add(normalized);
  }
  return [...keys].sort();
}
