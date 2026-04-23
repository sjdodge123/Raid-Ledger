import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  TASTE_PROFILE_AXIS_POOL,
  type CommunityRadarResponseDto,
  type CommunityTasteAxisDto,
  type ArchetypeDistributionEntryDto,
  type ArchetypeDto,
  type IntensityTier,
  type TasteProfileDimensionsDto,
  type TasteProfilePoolAxis,
} from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Radar payload: mean score per axis across the community, archetype
 * distribution counts, and a deterministic single-point drift series
 * (current week only). Historical drift will backfill as successive
 * snapshots accumulate — we read drift from prior snapshots, not from a
 * re-derived table, because the individual user history is not retained.
 */
export async function buildRadarSection(
  db: Db,
  snapshotDate: string,
): Promise<CommunityRadarResponseDto> {
  const rows = await db
    .select({
      dimensions: schema.playerTasteVectors.dimensions,
      archetype: schema.playerTasteVectors.archetype,
    })
    .from(schema.playerTasteVectors);

  const axes = meanAxes(rows.map((r) => r.dimensions));
  const archetypes = archetypeDistribution(rows.map((r) => r.archetype));
  const driftSeries = axes.map((a) => ({
    weekStart: snapshotDate,
    axis: a.axis,
    meanScore: a.meanScore,
  }));
  const dominantArchetype = pickDominantArchetype(rows.map((r) => r.archetype));

  return { snapshotDate, axes, archetypes, driftSeries, dominantArchetype };
}

function meanAxes(
  dims: Array<TasteProfileDimensionsDto | null>,
): CommunityTasteAxisDto[] {
  const valid = dims.filter((d): d is TasteProfileDimensionsDto => d !== null);
  return TASTE_PROFILE_AXIS_POOL.map((axis) => ({
    axis,
    meanScore: round(averageAxis(valid, axis)),
  }));
}

function averageAxis(
  dims: TasteProfileDimensionsDto[],
  axis: TasteProfilePoolAxis,
): number {
  if (dims.length === 0) return 0;
  let sum = 0;
  for (const d of dims) sum += Number(d[axis] ?? 0);
  return sum / dims.length;
}

function archetypeDistribution(
  archetypes: Array<ArchetypeDto | null>,
): ArchetypeDistributionEntryDto[] {
  const counts = new Map<
    string,
    { tier: IntensityTier; title: string | null; count: number }
  >();
  for (const a of archetypes) {
    if (!a) continue;
    const title = a.vectorTitles[0] ?? null;
    const key = `${a.intensityTier}|${title ?? ''}`;
    const prev = counts.get(key);
    if (prev) prev.count += 1;
    else counts.set(key, { tier: a.intensityTier, title, count: 1 });
  }
  return Array.from(counts.values()).map((c) => ({
    intensityTier: c.tier,
    vectorTitle: c.title,
    count: c.count,
  }));
}

function pickDominantArchetype(
  archetypes: Array<ArchetypeDto | null>,
): ArchetypeDto | null {
  const counts = new Map<string, { archetype: ArchetypeDto; count: number }>();
  for (const a of archetypes) {
    if (!a) continue;
    const key = `${a.intensityTier}|${a.vectorTitles.join(',')}`;
    const prev = counts.get(key);
    if (prev) prev.count += 1;
    else counts.set(key, { archetype: a, count: 1 });
  }
  let best: { archetype: ArchetypeDto; count: number } | null = null;
  for (const entry of counts.values()) {
    if (!best || entry.count > best.count) best = entry;
  }
  return best?.archetype ?? null;
}

function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}
