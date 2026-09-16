/**
 * Shared game-time heatmap aggregation (ROK-1559).
 *
 * `game_time_templates.dayOfWeek` is stored with **0 = Monday** (the editor's
 * convention), while `AggregateGameTimeCell.dayOfWeek` in the contract and
 * `GameTimeGrid` read **0 = Sunday**. Every aggregate that turns templates into
 * grid cells must apply the same remap — the events aggregate did and the
 * scheduling-poll aggregate did not, which painted Monday in the Sunday
 * column. Both now call this one helper so they cannot drift again.
 */
import type { AggregateGameTimeResponse } from '@raid-ledger/contract';

export interface HeatmapTemplateRow {
  dayOfWeek: number;
  startHour: number;
}

/** Template day (0 = Monday … 6 = Sunday) → grid day (0 = Sunday … 6 = Saturday). */
export function templateDayToGridDay(templateDay: number): number {
  return (templateDay + 1) % 7;
}

/** Aggregate templates into grid-convention day×hour cells with counts. */
export function aggregateTemplatesToCells(
  templates: HeatmapTemplateRow[],
  totalUsers: number,
): AggregateGameTimeResponse['cells'] {
  const countMap = new Map<string, number>();
  for (const t of templates) {
    const key = `${templateDayToGridDay(t.dayOfWeek)}:${t.startHour}`;
    countMap.set(key, (countMap.get(key) ?? 0) + 1);
  }
  return Array.from(countMap.entries()).map(([key, count]) => {
    const [day, hour] = key.split(':').map(Number);
    return {
      dayOfWeek: day,
      hour,
      availableCount: count,
      totalCount: totalUsers,
    };
  });
}
