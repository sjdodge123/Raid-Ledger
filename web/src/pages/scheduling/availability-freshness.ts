/**
 * Viewer-freshness predicate for the poll availability heatmap (ROK-1560).
 * Lives outside the component file so the legend module only exports components
 * (react-refresh/only-export-components).
 */
import type { AggregateGameTimeCell, AggregateGameTimeResponse } from '@raid-ledger/contract';

/**
 * True when the viewer's own game time is too old to feed the heatmap fill.
 * `null` means they never confirmed it; the boundary day itself is still fresh,
 * matching the server's `isGameTimeStale`.
 *
 * @param ageDays Whole days since the viewer confirmed, `null` if never, `undefined` if unknown.
 * @param freshnessDays The window the server counts as fresh.
 */
export function isViewerStale(
  ageDays: number | null | undefined,
  freshnessDays: number,
  serverVerdict?: boolean,
): boolean {
  // The server applies the SAME rule it used for the fill; its verdict wins
  // (floored days drift from the calendar cutoff for up to a day — review P2).
  if (serverVerdict !== undefined) return serverVerdict;
  return ageDays === null || (ageDays !== undefined && ageDays > freshnessDays);
}

const GRID_DAYS = 7;
const GRID_HOURS = 24;

/**
 * Cells for the grid. The poll aggregate only emits cells that at least one
 * template covers, but members with NO template are unknown on EVERY cell —
 * so in freshness mode every uncovered cell is filled in as
 * `0 free · untemplatedMembers unknown` (hatch, no fill). Aggregates without
 * the freshness model (events) are returned untouched.
 */
export function fillUnknownCells(data: AggregateGameTimeResponse): AggregateGameTimeCell[] {
  const unknown = data.untemplatedMembers ?? 0;
  if (data.freshnessDays === undefined || unknown <= 0) return data.cells;
  const total = data.totalMembers ?? data.totalUsers;
  const present = new Set(data.cells.map((c) => `${c.dayOfWeek}:${c.hour}`));
  const filled: AggregateGameTimeCell[] = [...data.cells];
  for (let dayOfWeek = 0; dayOfWeek < GRID_DAYS; dayOfWeek += 1) {
    for (let hour = 0; hour < GRID_HOURS; hour += 1) {
      if (present.has(`${dayOfWeek}:${hour}`)) continue;
      filled.push({ dayOfWeek, hour, availableCount: 0, totalCount: total, staleCount: 0, unknownCount: unknown });
    }
  }
  return filled;
}
