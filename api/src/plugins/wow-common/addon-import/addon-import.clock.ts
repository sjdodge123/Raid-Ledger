import { AddonImportError } from './addon-import.errors';
import type { DecodedAddonExport } from './addon-import.decoder';

/**
 * ROK-1756 — export strings are unsigned, so their timestamps are
 * attacker-chosen. A guild snapshot dated 2099 would win every later
 * `last_snapshot_at` freshness check and lock the guild against honest
 * imports. Bound every export timestamp by the SERVER clock at decode time:
 * nothing more than a day ahead (clock skew), and the export itself / a guild
 * snapshot no older than a year. Raid pulls only get the future bound — an
 * old pull history is legitimate.
 */
const DAY_S = 86_400;
export const EXPORT_MAX_FUTURE_S = DAY_S;
export const EXPORT_MAX_AGE_S = 365 * DAY_S;

/**
 * The server clock the bound reads. A live-bound object (not a bare
 * `Date.now` reference) so a spec can pin it with `jest.spyOn` and the
 * golden fixtures — dated 2026-09-21 — never age out of the 1-year window.
 * See `testing/pin-export-clock.ts`.
 */
export const exportClock = { nowMs: (): number => Date.now() };

export const EXPORT_TIME_MESSAGE =
  "The import string's date doesn't match the server clock — check your computer's date and export again.";

/** `recent` must sit inside the window; `past` only must not be future. */
function exportStamps(p: DecodedAddonExport): {
  recent: number[];
  past: number[];
} {
  if (p.section === 'guild') {
    return { recent: [p.exportedAt, p.data.snapshotAt], past: [] };
  }
  if (p.section === 'raid') {
    const pulls = p.data.pulls.flatMap((pull) => [pull.startAt, pull.endAt]);
    return { recent: [p.exportedAt], past: pulls };
  }
  return { recent: [p.exportedAt], past: [] };
}

/** Throws 422 `INVALID_PAYLOAD` when any stamp is outside the window. */
export function assertPlausibleExportTimes(
  payload: DecodedAddonExport,
  nowMs: number = exportClock.nowMs(),
): void {
  const now = Math.floor(nowMs / 1000);
  const { recent, past } = exportStamps(payload);
  const future = [...recent, ...past].some(
    (t) => t > now + EXPORT_MAX_FUTURE_S,
  );
  const stale = recent.some((t) => t < now - EXPORT_MAX_AGE_S);
  if (future || stale) {
    throw new AddonImportError('INVALID_PAYLOAD', EXPORT_TIME_MESSAGE);
  }
}
