/**
 * ROK-1915 (W7 + W8 "Gear readiness") — pure aggregation of the linked
 * level-cap mains' `ilvl`, `gear` and `enchantsReported` facts. No I/O.
 *
 * Population (D2/D3): `isMain && characterId !== null` rows of the FULL
 * roster at the level cap; linked mains below it are only counted as
 * `levelling`. A slot is missing an enchant only when an item is equipped
 * there without an `enchantId` (D6); gear from an export that does not report
 * enchants (schema 1) is `unknown`, never "missing".
 */
import {
  FOREVER_ENCHANTABLE_SLOTS,
  MAX_GEAR_BELOW,
  MAX_GEAR_MISSING,
  foreverIlvlFloor,
  type AddonSnapshotGearItem,
  type WowRosterGearDto,
} from '@raid-ledger/contract';
import type { Fact, ResolvedWowFacts } from '../../facts/wow-fact.types';
import { FOREVER_LEVEL_CAP, levelOf, median } from './roster-insights.levels';
import type { InsightRow } from './roster-insights.types';

type Gear = WowRosterGearDto;
type Bucket = Gear['ilvl']['buckets'][number];

/** Upper bound of the open-ended top bucket ("65+"). */
export const GEAR_TOP_BUCKET_TO = 999;

const BUCKET_RANGES: ReadonlyArray<{ from: number; to: number }> = [
  { from: 0, to: 44 },
  { from: 45, to: 49 },
  { from: 50, to: 54 },
  { from: 55, to: 59 },
  { from: 60, to: 64 },
  { from: 65, to: GEAR_TOP_BUCKET_TO },
];

const ENCHANTABLE: ReadonlySet<number> = new Set(FOREVER_ENCHANTABLE_SLOTS);

interface CapMain {
  name: string;
  characterId: string;
  facts: ResolvedWowFacts;
}

/** `<45, 45-49, 50-54, 55-59, 60-64, 65+`, all zero. */
export function emptyGearBuckets(): Bucket[] {
  return BUCKET_RANGES.map((r) => ({ ...r, count: 0 }));
}

/** Linked mains at the cap, and how many linked mains are still levelling. */
function capMains(rows: readonly InsightRow[]): {
  cap: CapMain[];
  levelling: number;
} {
  const cap: CapMain[] = [];
  let levelling = 0;
  for (const r of rows) {
    if (!r.isMain || r.characterId === null || r.facts === null) continue;
    const level = levelOf(r);
    if (level === null) continue;
    if (level < FOREVER_LEVEL_CAP) levelling += 1;
    else cap.push({ name: r.name, characterId: r.characterId, facts: r.facts });
  }
  return { cap, levelling };
}

function bucketFor(buckets: Bucket[], ilvl: number): Bucket | undefined {
  return buckets.find((b) => ilvl <= b.to) ?? buckets[buckets.length - 1];
}

/** Cap mains with an ilvl fact, rounded. */
function ratedMains(cap: readonly CapMain[]): Gear['ilvl']['below'] {
  return cap.flatMap((m) => {
    const fact = m.facts.ilvl;
    if (!fact) return [];
    return [
      {
        name: m.name,
        characterId: m.characterId,
        ilvl: Math.round(fact.value),
      },
    ];
  });
}

/** Histogram, median and below-floor list over cap mains with an ilvl. */
function computeIlvl(cap: readonly CapMain[], levelling: number): Gear['ilvl'] {
  const floor = foreverIlvlFloor(FOREVER_LEVEL_CAP);
  const rated = ratedMains(cap);
  const buckets = emptyGearBuckets();
  for (const m of rated) {
    const bucket = bucketFor(buckets, m.ilvl);
    if (bucket) bucket.count += 1;
  }
  const below = rated
    .filter((m) => m.ilvl < floor)
    .sort((a, b) => a.ilvl - b.ilvl || a.name.localeCompare(b.name));
  const mid = median(rated.map((m) => m.ilvl));
  return {
    buckets,
    median: mid === null ? null : Math.round(mid),
    floor,
    belowCount: below.length,
    below: below.slice(0, MAX_GEAR_BELOW),
    reporters: rated.length,
    levelling,
  };
}

/** Equipped enchantable slots with no enchant, ascending, each once. */
export function missingEnchantSlots(
  gear: readonly AddonSnapshotGearItem[],
): number[] {
  const slots = new Set<number>();
  for (const g of gear) {
    if (!ENCHANTABLE.has(g.slot) || g.itemId === undefined) continue;
    if (g.enchantId === undefined) slots.add(g.slot);
  }
  return [...slots].sort((a, b) => a - b);
}

/** Checked / unknown counts and the members missing enchants. */
function computeEnchants(cap: readonly CapMain[]): Gear['enchants'] {
  let checked = 0;
  let unknown = 0;
  const missing: Gear['enchants']['missing'] = [];
  for (const m of cap) {
    const gear = m.facts.gear;
    if (!gear) continue;
    if (m.facts.enchantsReported?.value !== true) {
      unknown += 1;
      continue;
    }
    checked += 1;
    const slots = missingEnchantSlots(gear.value);
    if (slots.length > 0)
      missing.push({ name: m.name, characterId: m.characterId, slots });
  }
  missing.sort((a, b) => a.name.localeCompare(b.name));
  return {
    checked,
    unknown,
    missingCount: missing.length,
    missing: missing.slice(0, MAX_GEAR_MISSING),
  };
}

/** The oldest ilvl/gear fact that fed the card; null when none did. */
function gearFreshness(cap: readonly CapMain[]): Gear['freshness'] {
  let oldest: Fact<unknown> | null = null;
  for (const m of cap) {
    for (const fact of [m.facts.ilvl, m.facts.gear]) {
      if (!fact) continue;
      if (!oldest || isOlder(fact, oldest)) oldest = fact;
    }
  }
  if (!oldest) return null;
  return { source: oldest.source, asOf: oldest.asOf?.toISOString() ?? null };
}

function isOlder(a: Fact<unknown>, b: Fact<unknown>): boolean {
  if (b.asOf === null) return false;
  return a.asOf === null ? true : a.asOf < b.asOf;
}

/** The members-only `gear` section of roster-insights. */
export function computeGear(rows: readonly InsightRow[]): Gear {
  const { cap, levelling } = capMains(rows);
  return {
    ilvl: computeIlvl(cap, levelling),
    enchants: computeEnchants(cap),
    freshness: gearFreshness(cap),
  };
}
