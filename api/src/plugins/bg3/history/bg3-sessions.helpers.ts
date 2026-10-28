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

/** One clustered session, oldest row first in `rowIds`. */
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

function extend(s: Bg3ClusteredSession, r: Bg3SessionRow): void {
  s.endedAt = r.savedAt;
  s.saveCount += countOf(r);
  s.partyLevelTo = r.partyMaxLevel;
  if (!s.areas.includes(r.currentLevel)) s.areas.push(r.currentLevel);
  s.lastSaveId = r.id;
  s.rowIds.push(r.id);
}

/** Sessions oldest first. The gap is measured to a row's first save. */
export function clusterSessions(
  rows: readonly Bg3SessionRow[],
  gapMs: number = BG3_SESSION_GAP_MS,
): Bg3ClusteredSession[] {
  const sessions: Bg3ClusteredSession[] = [];
  for (const r of sortBySavedAt(rows)) {
    const current = sessions.at(-1);
    const near =
      current !== undefined &&
      startOf(r).getTime() - current.endedAt.getTime() < gapMs;
    if (current && near) extend(current, r);
    else sessions.push(open(r));
  }
  return sessions;
}
