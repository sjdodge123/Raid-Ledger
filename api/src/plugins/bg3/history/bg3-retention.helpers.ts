/**
 * ROK-1957 D-9 / D-11 — the retention plan for ONE `(uploader, campaign or
 * NULL)` group: once a session's last save is older than the cutoff, keep
 * only that last row, stamped with the session's first save and save count.
 * Sessions straddling the cutoff and single-row sessions are untouched, so
 * a second run over the result plans nothing.
 */
import { BG3_RETENTION_DAYS, BG3_SESSION_GAP_MS } from '../bg3.constants';
import { clusterSessions, type Bg3SessionRow } from './bg3-sessions.helpers';

const DAY_MS = 86_400_000;

export interface Bg3RetentionRow extends Bg3SessionRow {
  thumbnailSha256: string | null;
}

export interface Bg3RetentionKeep {
  id: number;
  sessionFirstSavedAt: Date;
  sessionSaveCount: number;
}

export interface Bg3RetentionPlan {
  keep: Bg3RetentionKeep[];
  deleteIds: number[];
  /**
   * Thumbnail shas of deleted rows that no remaining row of the group uses.
   * Candidates only: the release statement re-checks the user's other rows.
   */
  releasedShas: string[];
}

/** Saves older than this are thinned to one per session. */
export function retentionCutoff(
  now: Date,
  days: number = BG3_RETENTION_DAYS,
): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

function releasable(
  rows: readonly Bg3RetentionRow[],
  deleted: ReadonlySet<number>,
): string[] {
  const kept = new Set<string>();
  const gone = new Set<string>();
  for (const r of rows) {
    if (r.thumbnailSha256 === null) continue;
    (deleted.has(r.id) ? gone : kept).add(r.thumbnailSha256);
  }
  return [...gone].filter((sha) => !kept.has(sha));
}

/**
 * `rows` must hold every row of the group saved before `cutoff + gapMs`;
 * later rows cannot change a session that ended before the cutoff.
 */
export function planRetention(
  rows: readonly Bg3RetentionRow[],
  cutoff: Date,
  gapMs: number = BG3_SESSION_GAP_MS,
): Bg3RetentionPlan {
  const keep: Bg3RetentionKeep[] = [];
  const deleteIds: number[] = [];
  for (const s of clusterSessions(rows, gapMs)) {
    if (s.endedAt.getTime() >= cutoff.getTime() || s.rowIds.length < 2)
      continue;
    keep.push({
      id: s.lastSaveId,
      sessionFirstSavedAt: s.startedAt,
      sessionSaveCount: s.saveCount,
    });
    deleteIds.push(...s.rowIds.filter((id) => id !== s.lastSaveId));
  }
  return {
    keep,
    deleteIds,
    releasedShas: releasable(rows, new Set(deleteIds)),
  };
}
