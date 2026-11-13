/**
 * ROK-1789 Part B (B-3) — pure: a guild's stored pulls grouped into raid
 * instance sections for the Progression tab. Per `(encounter, difficulty)`
 * the widget's own fold is reused (`collapseNearDuplicates` + `toBoss`), so
 * each boss row's `firstKillAt` is the Q-B18 first kill.
 *
 * Placement of one boss (all its pulls together, so a boss never splits):
 * (1) its pull map id via `RAID_MAP_INSTANCES`; (2) else its name against
 * the boss rows of a known raid; (3) else `m:<mapId>` "Instance <mapId>"
 * (Q-B12 v1); (4) else `other` "Other bosses". Totals use `forever` boss
 * rows when the raid has any, else `classic` (Q-B11); null ⇒ "N/?".
 */
import {
  WOW_PROGRESSION_INSTANCES_MAX,
  type WowGuildProgressionDto,
  type WowProgressionBossDto,
  type WowProgressionInstanceDto,
} from '@raid-ledger/contract';
import {
  collapseNearDuplicates,
  compareBosses,
  toBoss,
  type RaidPull,
} from '../roster-insights/roster-insights.raid-progress';
import { raidForMap, raidNameForJournal } from './raid-map-instances';

/** The `wow_classic_bosses` columns the grouping reads (`instanceId` = Journal id). */
export interface ProgressionBossRow {
  instanceId: number;
  name: string;
  order: number;
  expansion: string;
}

/** Per Journal id: boss total, and name → Journal id / order lookups. */
interface BossIndex {
  totals: Map<number, number>;
  journalByName: Map<string, number>;
  /** `${journalId}:${normName}` → order. */
  orderOf: Map<string, number>;
}

/** Boss names compare case-insensitively, trimmed. */
const normBossName = (name: string): string => name.trim().toLowerCase();

/** Q-B11: per Journal id, its `forever` rows when it has any, else `classic`. */
function preferredRows(
  rows: readonly ProgressionBossRow[],
): ProgressionBossRow[] {
  const hasForever = new Set(
    rows.filter((r) => r.expansion === 'forever').map((r) => r.instanceId),
  );
  return rows.filter((r) =>
    hasForever.has(r.instanceId)
      ? r.expansion === 'forever'
      : r.expansion === 'classic',
  );
}

/** The lookups `groupIntoInstances` places and orders bosses with. */
function buildBossIndex(rows: readonly ProgressionBossRow[]): BossIndex {
  const index: BossIndex = {
    totals: new Map(),
    journalByName: new Map(),
    orderOf: new Map(),
  };
  const sorted = preferredRows(rows).sort(
    (a, b) => a.instanceId - b.instanceId || a.order - b.order,
  );
  for (const r of sorted) {
    const norm = normBossName(r.name);
    index.totals.set(r.instanceId, (index.totals.get(r.instanceId) ?? 0) + 1);
    if (
      !index.journalByName.has(norm) &&
      raidNameForJournal(r.instanceId) !== null
    ) {
      index.journalByName.set(norm, r.instanceId);
    }
    index.orderOf.set(`${r.instanceId}:${norm}`, r.order);
  }
  return index;
}

/** A widget pull plus its in-game map id (null on older exports). */
export interface ProgressionPull extends RaidPull {
  instanceId: number | null;
}

/** Where one boss is shown: the section key, label and its Journal id. */
interface Placement {
  key: string;
  name: string;
  journalId: number | null;
}

/** One `(encounter, difficulty)` boss, placed, with its newest kill. */
interface BossEntry {
  boss: WowProgressionBossDto;
  place: Placement;
  lastKill: Date | null;
}

const OTHER: Placement = {
  key: 'other',
  name: 'Other bosses',
  journalId: null,
};

/** Group pulls by `(encounter, difficulty)`. */
function groupPulls(pulls: readonly ProgressionPull[]): ProgressionPull[][] {
  const groups = new Map<string, ProgressionPull[]>();
  for (const p of pulls) {
    const key = `${p.encounterId}:${p.difficultyId}`;
    const group = groups.get(key);
    if (group) group.push(p);
    else groups.set(key, [p]);
  }
  return [...groups.values()];
}

/** Steps (1)–(4) of the placement order for one boss. */
function placeBoss(
  mapId: number | null,
  name: string,
  index: BossIndex,
): Placement {
  const raid = mapId === null ? null : raidForMap(mapId);
  if (raid) {
    return raid.journalId === null
      ? { key: `m:${mapId}`, name: raid.name, journalId: null }
      : {
          key: `j:${raid.journalId}`,
          name: raid.name,
          journalId: raid.journalId,
        };
  }
  const byName = index.journalByName.get(normBossName(name));
  const raidName = byName === undefined ? null : raidNameForJournal(byName);
  if (byName !== undefined && raidName !== null) {
    return { key: `j:${byName}`, name: raidName, journalId: byName };
  }
  if (mapId !== null)
    return { key: `m:${mapId}`, name: `Instance ${mapId}`, journalId: null };
  return OTHER;
}

/** The newest successful pull end, or null. */
function lastKillOf(pulls: readonly RaidPull[]): Date | null {
  let last: Date | null = null;
  for (const p of pulls) {
    if (p.success && (last === null || p.endAt > last)) last = p.endAt;
  }
  return last;
}

/** One placed boss entry from the raw pulls of one `(encounter, difficulty)`. */
function toEntry(
  group: readonly ProgressionPull[],
  index: BossIndex,
): BossEntry | null {
  const collapsed = collapseNearDuplicates(group);
  const widgetBoss = toBoss(collapsed);
  if (!widgetBoss) return null;
  const mapId = group.find((p) => p.instanceId !== null)?.instanceId ?? null;
  const place = placeBoss(mapId, widgetBoss.name, index);
  const order =
    place.journalId === null
      ? null
      : (index.orderOf.get(
          `${place.journalId}:${normBossName(widgetBoss.name)}`,
        ) ?? null);
  return {
    boss: { ...widgetBoss, order },
    place,
    lastKill: lastKillOf(collapsed),
  };
}

/** Boss order: boss-row `order` (unmatched last), then the widget's order. */
function compareOrdered(
  a: WowProgressionBossDto,
  b: WowProgressionBossDto,
): number {
  if (a.order !== b.order) {
    if (a.order === null) return 1;
    if (b.order === null) return -1;
    return a.order - b.order;
  }
  return compareBosses(a, b);
}

/** The newest kill among entries, as `{ name, at }`, or null. */
function latestKill(
  entries: readonly BossEntry[],
): WowProgressionInstanceDto['latestKill'] {
  let best: BossEntry | null = null;
  for (const e of entries) {
    if (e.lastKill && (!best?.lastKill || e.lastKill > best.lastKill)) best = e;
  }
  return best?.lastKill
    ? { name: best.boss.name, at: best.lastKill.toISOString() }
    : null;
}

/** One instance section from its placed entries (non-empty). */
function toInstance(
  place: Placement,
  entries: readonly BossEntry[],
  index: BossIndex,
): WowProgressionInstanceDto {
  const bosses = entries.map((e) => e.boss).sort(compareOrdered);
  const killed = new Set(
    bosses.filter((b) => b.kills > 0).map((b) => b.encounterId),
  );
  const total =
    place.journalId === null ? 0 : (index.totals.get(place.journalId) ?? 0);
  return {
    key: place.key,
    name: place.name,
    bossesDown: killed.size,
    bossTotal: total > 0 ? total : null,
    showDifficulty: new Set(bosses.map((b) => b.difficultyId)).size > 1,
    latestKill: latestKill(entries),
    bosses,
  };
}

/** The newest `lastPullAt` of an instance's bosses ('' when none). */
function newestPull(inst: WowProgressionInstanceDto): string {
  return inst.bosses.reduce(
    (at, b) => (b.lastPullAt > at ? b.lastPullAt : at),
    '',
  );
}

/** Most recent pull first; `other` always last; then name. */
function compareInstances(
  a: WowProgressionInstanceDto,
  b: WowProgressionInstanceDto,
): number {
  if ((a.key === 'other') !== (b.key === 'other'))
    return a.key === 'other' ? 1 : -1;
  return (
    newestPull(b).localeCompare(newestPull(a)) || a.name.localeCompare(b.name)
  );
}

/** Placed entries bucketed by section key, keeping each key's placement. */
function bucket(entries: readonly BossEntry[]): Map<string, BossEntry[]> {
  const out = new Map<string, BossEntry[]>();
  for (const e of entries) {
    const list = out.get(e.place.key);
    if (list) list.push(e);
    else out.set(e.place.key, [e]);
  }
  return out;
}

/**
 * The Progression tab's `progression` half from the hub's trusted, in-scope
 * pulls and the `forever`/`classic` boss rows (pure).
 */
export function groupIntoInstances(
  pulls: readonly ProgressionPull[],
  bossRows: readonly ProgressionBossRow[],
): WowGuildProgressionDto {
  const index = buildBossIndex(bossRows);
  const entries = groupPulls(pulls).flatMap((g) => {
    const entry = toEntry(g, index);
    return entry ? [entry] : [];
  });
  const instances = [...bucket(entries).values()].flatMap((list) => {
    const first = list[0];
    return first ? [toInstance(first.place, list, index)] : [];
  });
  const bosses = entries.map((e) => e.boss);
  return {
    instances: instances
      .sort(compareInstances)
      .slice(0, WOW_PROGRESSION_INSTANCES_MAX),
    pullCount: bosses.reduce((n, b) => n + b.kills + b.wipes, 0),
    lastPullAt: bosses.reduce<string | null>(
      (at, b) => (at === null || b.lastPullAt > at ? b.lastPullAt : at),
      null,
    ),
  };
}
