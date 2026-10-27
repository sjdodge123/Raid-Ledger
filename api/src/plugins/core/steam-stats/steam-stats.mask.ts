/**
 * ROK-1953 §4.4 — per-viewer masking (pure). A hidden achievement the viewer
 * has not unlocked leaves the server as `{ masked: true, globalPct }` only:
 * its api name, name and description never reach that viewer. Staff get no
 * unmask (D8).
 */
import type { SteamAchievementView } from '@raid-ledger/contract';

/** An achievement as stored (`global_pct` is a numeric string, e.g. `'12.500'`). */
export interface StoredAchievement {
  apiName: string;
  name: string;
  description: string | null;
  hidden: boolean;
  globalPct: string | null;
}

/** The stored numeric % as 0–100, `null` when absent or unparsable. */
export function parseGlobalPct(raw: string | null): number | null {
  if (raw === null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, n));
}

/**
 * The view of `a` for a viewer who has unlocked `viewerUnlocked` (api names).
 * Builds the masked object from scratch — never spreads the stored row.
 */
export function maskAchievement(
  a: StoredAchievement,
  viewerUnlocked: ReadonlySet<string>,
): SteamAchievementView {
  const globalPct = parseGlobalPct(a.globalPct);
  if (a.hidden && !viewerUnlocked.has(a.apiName)) {
    return { masked: true, globalPct };
  }
  return {
    masked: false,
    apiName: a.apiName,
    name: a.name,
    description: a.description,
    hidden: a.hidden,
    globalPct,
  };
}
