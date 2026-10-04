/**
 * archiveOwnLeftoverLineups: best-effort retirement of the active lineups a
 * smoke file left behind on an EARLIER run.
 *
 * Scoped, not global. Several lineups may be active at once since ROK-1065,
 * and the smoke suite runs files concurrently (SMOKE_CONCURRENCY). A global
 * archive retired other files' lineups mid-run and flipped their cards to
 * ABORTED / POLL CLOSED (TDB:1071). Each file therefore passes the title
 * prefixes it owns and touches nothing else.
 *
 * Run-start fence. A file's own tests also run concurrently, so a bare
 * `startsWith(prefix)` would archive a sibling test's lineup from the SAME
 * run. `isLeftoverLineup` reads the `Date.now()` stamp after the prefix and
 * matches only a stamp taken before `runStartedAt` (the file's module-load
 * time); a lineup created during this run is never touched.
 *
 * Title contract. Every title a caller creates MUST be exactly
 * `<prefix>${Date.now()}` with nothing after the stamp. A non-numeric suffix
 * (e.g. `Tie Hold 123 (b)`) does not parse as a stamp and counts as a
 * leftover, so this run would archive it (lineup-milestone-match.ts).
 *
 * Pure: the ApiClient is injected, so the spec drives it with a fake. Never
 * import fixtures.ts or config.ts here; either would pull config.ts's
 * required-env checks into the pure spec glob.
 */
import type { ApiClient } from './api.js';
import { isLeftoverLineup } from './lineup-milestone-match.js';

type ActiveLineupRow = { id: number; title?: string };

export interface ArchiveLeftoverOptions {
  /**
   * 'archive' (default): PATCH status archived. 'abort': POST /abort first
   * and fall back to the archive PATCH if the abort is refused.
   */
  retire?: 'archive' | 'abort';
}

async function retireLineup(
  api: ApiClient,
  id: number,
  retire: 'archive' | 'abort',
): Promise<void> {
  const archive = () =>
    api.patch(`/lineups/${id}/status`, { status: 'archived' }).catch(() => null);
  if (retire === 'abort') {
    await api.post(`/lineups/${id}/abort`, {}).catch(archive);
    return;
  }
  await archive();
}

export async function archiveOwnLeftoverLineups(
  api: ApiClient,
  prefixes: readonly string[],
  runStartedAt: number,
  opts: ArchiveLeftoverOptions = {},
): Promise<void> {
  const retire = opts.retire ?? 'archive';
  try {
    const res = await api.get<ActiveLineupRow[] | ActiveLineupRow | null>(
      '/lineups/active',
    );
    const list = Array.isArray(res) ? res : res ? [res] : [];
    for (const row of list) {
      if (!row?.id) continue;
      if (!isLeftoverLineup(row.title, prefixes, runStartedAt)) continue;
      await retireLineup(api, row.id, retire);
    }
  } catch {
    /* no active lineups */
  }
}
