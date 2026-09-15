/**
 * Viewer-freshness predicate for the poll availability heatmap (ROK-1560).
 * Lives outside the component file so the legend module only exports components
 * (react-refresh/only-export-components).
 */

/**
 * True when the viewer's own game time is too old to feed the heatmap fill.
 * `null` means they never confirmed it; the boundary day itself is still fresh,
 * matching the server's `isGameTimeStale`.
 *
 * @param ageDays Whole days since the viewer confirmed, `null` if never, `undefined` if unknown.
 * @param freshnessDays The window the server counts as fresh.
 */
export function isViewerStale(ageDays: number | null | undefined, freshnessDays: number): boolean {
  return ageDays === null || (ageDays !== undefined && ageDays > freshnessDays);
}
