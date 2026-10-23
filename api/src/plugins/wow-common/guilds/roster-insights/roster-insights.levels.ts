import type { WowRosterInsightsDto } from '@raid-ledger/contract';
import { CLASSIC_INSTANCE_LEVELS } from '../../blizzard-instance-data';
import type { InsightRow } from './roster-insights.types';

/** WoW: Forever level cap (Classic rules). */
export const FOREVER_LEVEL_CAP = 60;

/** Lowest dungeon entry level (Ragefire Chasm) — the dungeon-eligible bar. */
export const LOWEST_DUNGEON_LEVEL: number = Math.min(
  ...Object.values(CLASSIC_INSTANCE_LEVELS).map((l) => l.minimumLevel),
);

type Levels = WowRosterInsightsDto['levels'];
type ClassEntry = WowRosterInsightsDto['classes'][number];

/** A row's resolved level, or null when unknown. */
export function levelOf(row: InsightRow): number | null {
  return row.facts?.level?.value ?? null;
}

/** Buckets 1-9, 10-19 … 50-59, then the cap on its own. */
export function emptyBuckets(): Levels['buckets'] {
  const buckets: Levels['buckets'] = [{ from: 1, to: 9, count: 0 }];
  for (let from = 10; from < FOREVER_LEVEL_CAP; from += 10) {
    buckets.push({ from, to: from + 9, count: 0 });
  }
  buckets.push({ from: FOREVER_LEVEL_CAP, to: FOREVER_LEVEL_CAP, count: 0 });
  return buckets;
}

/** Median of a list (mean of the middle two when even); null when empty. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const hi = sorted[mid] ?? 0;
  if (sorted.length % 2 === 1) return hi;
  return ((sorted[mid - 1] ?? hi) + hi) / 2;
}

/** Histogram, max, median and at-cap count over EVERY row with a level. */
export function computeLevels(rows: readonly InsightRow[]): Levels {
  const buckets = emptyBuckets();
  const levels: number[] = [];
  for (const row of rows) {
    const level = levelOf(row);
    if (level === null) continue;
    levels.push(level);
    const idx = Math.min(Math.floor(level / 10), buckets.length - 1);
    const bucket = buckets[idx];
    if (bucket) bucket.count += 1;
  }
  return {
    buckets,
    max: levels.length > 0 ? Math.max(...levels) : null,
    median: median(levels),
    atCap: levels.filter((l) => l >= FOREVER_LEVEL_CAP).length,
  };
}

/** Class → count + members over EVERY row; biggest class first. */
export function computeClasses(rows: readonly InsightRow[]): ClassEntry[] {
  const byClass = new Map<string, ClassEntry>();
  for (const row of rows) {
    const name = row.facts?.class?.value ?? 'Unknown';
    const entry = byClass.get(name) ?? { class: name, count: 0, members: [] };
    entry.count += 1;
    entry.members.push({
      name: row.name,
      characterId: row.characterId,
      level: levelOf(row),
    });
    byClass.set(name, entry);
  }
  return [...byClass.values()].sort(
    (a, b) => b.count - a.count || a.class.localeCompare(b.class),
  );
}
