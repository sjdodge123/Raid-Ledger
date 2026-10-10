/**
 * ROK-1760: resolver failures (`error` / `not_found`) used to be stored
 * silently. This remembers the last failure logged per item so a repeating
 * failure produces ONE line, and a new outcome (or a recovery) re-arms it.
 */
import type { WowItemMetaInsert } from './wowhead-item.types';

/** Bound on remembered items; the map is reset when it would grow past it. */
export const OUTCOME_LOG_MAX_ITEMS = 10_000;

export type OutcomeRow = Pick<
  WowItemMetaInsert,
  'itemId' | 'status' | 'attempts' | 'nextRetryAt'
>;

function describe(row: OutcomeRow): string {
  const next = row.nextRetryAt ? row.nextRetryAt.toISOString() : 'none';
  if (row.status === 'not_found') {
    return `Wowhead item ${row.itemId} not found (env 16 or 4); re-check at ${next}`;
  }
  return `Wowhead item ${row.itemId} lookup failed (error, attempt ${row.attempts ?? 0}); retry at ${next}`;
}

export class ResolverOutcomeLog {
  private readonly logged = new Map<number, string>();

  /** @returns the line to log for this outcome, or null (success / already logged). */
  record(row: OutcomeRow): string | null {
    if (row.status !== 'error' && row.status !== 'not_found') {
      this.logged.delete(row.itemId);
      return null;
    }
    if (this.logged.get(row.itemId) === row.status) return null;
    if (this.logged.size >= OUTCOME_LOG_MAX_ITEMS) this.logged.clear();
    this.logged.set(row.itemId, row.status);
    return describe(row);
  }
}
