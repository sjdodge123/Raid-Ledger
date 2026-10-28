/**
 * ROK-1957 D-7 — a campaign's canonical rows: every assigned row, deduped on
 * `(campaignKey, savedAt)`, preferring the host's row, then the lowest id.
 */

/** The `bg3_saves` columns the dedupe reads. */
export interface Bg3CanonicalRow {
  id: number;
  uploaderUserId: number;
  campaignKey: string;
  savedAt: Date;
}

function prefer<T extends Bg3CanonicalRow>(a: T, b: T, host: number | null): T {
  const aHost = a.uploaderUserId === host;
  const bHost = b.uploaderUserId === host;
  if (aHost !== bHost) return aHost ? a : b;
  return a.id <= b.id ? a : b;
}

/** The winners, in input order. */
export function pickCanonical<T extends Bg3CanonicalRow>(
  rows: readonly T[],
  hostUserId: number | null,
): T[] {
  const best = new Map<string, T>();
  for (const r of rows) {
    const key = `${r.campaignKey}|${r.savedAt.getTime()}`;
    const seen = best.get(key);
    best.set(key, seen ? prefer(seen, r, hostUserId) : r);
  }
  const winners = new Set(best.values());
  return rows.filter((r) => winners.has(r));
}
