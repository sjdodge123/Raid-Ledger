import type { WowRecentDingDto } from '@raid-ledger/contract';

/** ROK-1919 — the feed window (operator ruling 2026-10-28: the log is kept forever; only the read is windowed). */
export const RECENT_DINGS_WINDOW_DAYS = 30;
/** Most dings the feed returns. */
export const RECENT_DINGS_LIMIT = 20;

const DAY_MS = 86_400_000;

/** One event row as `loadDingRows` returns it. */
export interface RawDingRow {
  id: number;
  name: string;
  characterId: string | null;
  fromLevel: number;
  toLevel: number;
  occurredAt: Date;
}

/** Start of the feed window relative to `now`. */
export function windowStart(now: number): Date {
  return new Date(now - RECENT_DINGS_WINDOW_DAYS * DAY_MS);
}

/**
 * Rows (already newest first) → feed entries: one per event id (the first
 * row wins when a GUID joined two characters), capped at `limit`.
 */
export function toDings(
  rows: RawDingRow[],
  limit: number = RECENT_DINGS_LIMIT,
): WowRecentDingDto[] {
  const seen = new Set<number>();
  const out: WowRecentDingDto[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push({
      name: row.name,
      characterId: row.characterId,
      fromLevel: row.fromLevel,
      toLevel: row.toLevel,
      at: row.occurredAt.toISOString(),
    });
    if (out.length >= limit) break;
  }
  return out;
}
