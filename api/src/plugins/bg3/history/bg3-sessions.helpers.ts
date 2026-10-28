/**
 * ROK-1957 D-8 — sessions are computed at read time, never stored: a gap of
 * at least `gapMs` between saves starts a new session. A row collapsed by
 * retention (D-9) stands for a whole session through its two stamps.
 */
import { BG3_SESSION_GAP_MS } from '../bg3.constants';

/** The `bg3_saves` columns clustering reads. */
export interface Bg3SessionRow {
  id: number;
  savedAt: Date;
  sessionFirstSavedAt?: Date | null;
  sessionSaveCount?: number | null;
  /** The save's area (`current_level`). */
  currentLevel: string;
  partyMaxLevel: number;
}

/** One clustered session; `rowIds` in order of each row's first save. */
export interface Bg3ClusteredSession {
  startedAt: Date;
  endedAt: Date;
  saveCount: number;
  partyLevelFrom: number;
  partyLevelTo: number;
  /** Distinct areas in the order they were first saved in. */
  areas: string[];
  lastSaveId: number;
  rowIds: number[];
}

const startOf = (r: Bg3SessionRow): Date => r.sessionFirstSavedAt ?? r.savedAt;
const countOf = (r: Bg3SessionRow): number => r.sessionSaveCount ?? 1;

/** Rows by `savedAt`, then `id` (a copy; the input is not reordered). */
export function sortBySavedAt<T extends Bg3SessionRow>(
  rows: readonly T[],
): T[] {
  return [...rows].sort(
    (a, b) => a.savedAt.getTime() - b.savedAt.getTime() || a.id - b.id,
  );
}

function open(r: Bg3SessionRow): Bg3ClusteredSession {
  return {
    startedAt: startOf(r),
    endedAt: r.savedAt,
    saveCount: countOf(r),
    partyLevelFrom: r.partyMaxLevel,
    partyLevelTo: r.partyMaxLevel,
    areas: [r.currentLevel],
    lastSaveId: r.id,
    rowIds: [r.id],
  };
}

/** Rows by first save, then `savedAt`, then `id` (a copy). */
function sortByStart(rows: readonly Bg3SessionRow[]): Bg3SessionRow[] {
  return [...rows].sort(
    (a, b) =>
      startOf(a).getTime() - startOf(b).getTime() ||
      a.savedAt.getTime() - b.savedAt.getTime() ||
      a.id - b.id,
  );
}

/** The session's end + last save move only to a later (or tied) save. */
function extend(s: Bg3ClusteredSession, r: Bg3SessionRow): void {
  s.saveCount += countOf(r);
  if (!s.areas.includes(r.currentLevel)) s.areas.push(r.currentLevel);
  s.rowIds.push(r.id);
  if (r.savedAt.getTime() < s.endedAt.getTime()) return;
  s.endedAt = r.savedAt;
  s.partyLevelTo = r.partyMaxLevel;
  s.lastSaveId = r.id;
}

/**
 * Sessions oldest first. Each row is the interval [first save, `savedAt`]
 * (a collapsed row spans its whole session); intervals are merged in order
 * of their first save while the gap to the session's end stays under
 * `gapMs` — interval clustering, so a collapsed row overlapping a later raw
 * save joins it (review fix 3).
 */
export function clusterSessions(
  rows: readonly Bg3SessionRow[],
  gapMs: number = BG3_SESSION_GAP_MS,
): Bg3ClusteredSession[] {
  const sessions: Bg3ClusteredSession[] = [];
  for (const r of sortByStart(rows)) {
    const current = sessions.at(-1);
    const near =
      current !== undefined &&
      startOf(r).getTime() - current.endedAt.getTime() < gapMs;
    if (current && near) extend(current, r);
    else sessions.push(open(r));
  }
  return sessions;
}
