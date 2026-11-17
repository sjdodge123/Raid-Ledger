import {
  MAX_SUGGESTED_GROUPS_PER_DUNGEON,
  SUGGESTED_GROUPS_TOP_COUNT,
  type SuggestedGroupDto,
  type SuggestedGroupMemberDto,
  type SuggestedGroupRole,
  type SuggestedGroupsPoolDto,
} from '@raid-ledger/contract';
import type { InsightRow } from '../roster-insights/roster-insights.types';
import { memberKey, playerKey } from './suggested-groups.roles';

/**
 * ROK-2212 — pure Suggested groups maths: the eligible pool, per-dungeon
 * candidate lineups (1 tank / 1 healer / 3 dps, one character per player),
 * ranking and the top-of-distinct-dungeons pick. No DB, no Nest, no network.
 */

/** One pool character: its wire identity (minus the slot role), roles, player. */
export interface PoolEntry {
  member: Omit<SuggestedGroupMemberDto, 'role'>;
  /** Every role it may fill (one today; two once dual spec lands). */
  roles: readonly SuggestedGroupRole[];
  /** Distinct-player key (`u<userId>` or the member key). */
  player: string;
}

export interface EligiblePool {
  entries: PoolEntry[];
  counts: SuggestedGroupsPoolDto;
}

export type DungeonRef = SuggestedGroupDto['instance'];

/** The contract's level cap: a fact above it would fail the web's parse. */
const MAX_LEVEL = 100;

function cmp(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function byNameThenKey(a: PoolEntry, b: PoolEntry): number {
  return cmp(a.member.name, b.member.name) || cmp(a.member.key, b.member.key);
}

function emptyCounts(): SuggestedGroupsPoolDto {
  return {
    tank: 0,
    healer: 0,
    dps: 0,
    unclaimed: 0,
    skippedNoRole: 0,
    skippedNoLevel: 0,
  };
}

/** A pool entry for a row, or why it was left out. */
function toEntry(
  row: InsightRow,
  level: number | null,
  roles: SuggestedGroupRole[],
): PoolEntry | 'noRole' | 'noLevel' | 'noKey' {
  const key = memberKey(row);
  const player = playerKey(row);
  if (key === null || player === null) return 'noKey';
  if (roles.length === 0) return 'noRole';
  if (level === null || level < 1 || level > MAX_LEVEL) return 'noLevel';
  const member = {
    key,
    characterId: row.characterId,
    memberId: row.memberId ?? null,
    userId: row.userId,
    name: row.name,
    class: row.facts?.class?.value ?? null,
    level,
  };
  return { member, roles, player };
}

/**
 * Every known character (claimed AND unclaimed rows) with ≥1 playable role
 * and a known level. Unknown role → `skippedNoRole` (checked first), unknown
 * level → `skippedNoLevel`; a row with no key is dropped silently.
 */
export function eligiblePool(
  rows: readonly InsightRow[],
  levelOf: (row: InsightRow) => number | null,
  rolesOf: (row: InsightRow) => SuggestedGroupRole[],
): EligiblePool {
  const counts = emptyCounts();
  const entries: PoolEntry[] = [];
  for (const row of rows) {
    const entry = toEntry(row, levelOf(row), rolesOf(row));
    if (entry === 'noRole') counts.skippedNoRole += 1;
    else if (entry === 'noLevel') counts.skippedNoLevel += 1;
    else if (entry !== 'noKey') entries.push(entry);
  }
  for (const e of entries) {
    for (const role of e.roles) counts[role] += 1;
    if (e.member.characterId === null) counts.unclaimed += 1;
  }
  return { entries: entries.sort(byNameThenKey), counts };
}

/** One dungeon's dps bucketed by level (ascending), each bucket by name then key. */
interface DpsByLevel {
  levels: number[];
  buckets: PoolEntry[][];
}

function bucketByLevel(dps: readonly PoolEntry[]): DpsByLevel {
  const byLevel = new Map<number, PoolEntry[]>();
  for (const d of [...dps].sort(byNameThenKey)) {
    const bucket = byLevel.get(d.member.level);
    if (bucket) bucket.push(d);
    else byLevel.set(d.member.level, [d]);
  }
  const levels = [...byLevel.keys()].sort((a, b) => a - b);
  return { levels, buckets: levels.map((l) => byLevel.get(l) ?? []) };
}

/**
 * The dps in order of level distance from `mean`, nearest first, walking
 * outward with two pointers; an equal-distance pair of buckets (one each
 * side of `mean`) is merged by name then key — the order of one full sort.
 */
function* byDistance(d: DpsByLevel, mean: number): Generator<PoolEntry> {
  const dist = (i: number) => {
    const level = d.levels[i];
    return level === undefined ? Infinity : Math.abs(level - mean);
  };
  let hi = d.levels.findIndex((l) => l > mean);
  if (hi === -1) hi = d.levels.length;
  let lo = hi - 1;
  while (lo >= 0 || hi < d.levels.length) {
    const below = dist(lo);
    const above = dist(hi);
    const take: PoolEntry[] = [];
    if (below <= above) take.push(...(d.buckets[lo--] ?? []));
    if (above <= below) take.push(...(d.buckets[hi++] ?? []));
    yield* below === above ? take.sort(byNameThenKey) : take;
  }
}

/** The 3 dps of distinct players (not `taken`) closest in level to `mean`. */
function pickDps(
  dps: DpsByLevel,
  taken: ReadonlySet<string>,
  mean: number,
): PoolEntry[] | null {
  const players = new Set(taken);
  const picked: PoolEntry[] = [];
  for (const d of byDistance(dps, mean)) {
    if (players.has(d.player)) continue;
    players.add(d.player);
    picked.push(d);
    if (picked.length === 3) return picked.sort(byNameThenKey);
  }
  return null;
}

function toGroup(
  instance: DungeonRef,
  tank: PoolEntry,
  healer: PoolEntry,
  dps: PoolEntry[],
): SuggestedGroupDto {
  const slot = (e: PoolEntry, role: SuggestedGroupRole) => ({
    ...e.member,
    role,
  });
  const members = [
    slot(tank, 'tank'),
    slot(healer, 'healer'),
    ...dps.map((d) => slot(d, 'dps')),
  ];
  const levels = members.map((m) => m.level);
  const levelSpread = Math.max(...levels) - Math.min(...levels);
  return {
    instance: { ...instance },
    members,
    levelSpread,
    sharedQuests: null,
  };
}

function fits(e: PoolEntry, instance: DungeonRef): boolean {
  return (
    e.member.level >= instance.minimumLevel &&
    e.member.level <= instance.maximumLevel
  );
}

function withRole(
  entries: readonly PoolEntry[],
  role: SuggestedGroupRole,
): PoolEntry[] {
  return entries.filter((e) => e.roles.includes(role));
}

/** The same five characters (whatever slot each fills) — one lineup. */
function setKey(g: SuggestedGroupDto): string {
  return g.members
    .map((m) => m.key)
    .sort(cmp)
    .join(',');
}

/**
 * Candidate lineups for one dungeon: every (tank, healer) pair of distinct
 * players plus the 3 closest-level dps of other players, every member inside
 * the dungeon's range (inclusive). Ranked, identical 5-sets deduped, capped.
 */
export function buildCandidates(
  pool: readonly PoolEntry[],
  instance: DungeonRef,
  cap: number = MAX_SUGGESTED_GROUPS_PER_DUNGEON,
): SuggestedGroupDto[] {
  const fit = pool.filter((e) => fits(e, instance));
  const dps = bucketByLevel(withRole(fit, 'dps'));
  const groups: SuggestedGroupDto[] = [];
  for (const tank of withRole(fit, 'tank')) {
    for (const healer of withRole(fit, 'healer')) {
      if (healer.player === tank.player) continue;
      const mean = (tank.member.level + healer.member.level) / 2;
      const picked = pickDps(dps, new Set([tank.player, healer.player]), mean);
      if (picked) groups.push(toGroup(instance, tank, healer, picked));
    }
  }
  return dedupe(rankGroups(groups)).slice(0, cap);
}

/** Keeps the first (best-ranked) group of each distinct 5-set. */
function dedupe(ranked: readonly SuggestedGroupDto[]): SuggestedGroupDto[] {
  const seen = new Set<string>();
  const kept: SuggestedGroupDto[] = [];
  for (const g of ranked) {
    const key = setKey(g);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(g);
  }
  return kept;
}

function names(g: SuggestedGroupDto): string {
  return g.members.map((m) => m.name).join('\u0000');
}

function keys(g: SuggestedGroupDto): string {
  return g.members.map((m) => m.key).join(',');
}

/** Ruling 1: spread asc, shared quests desc (null last), dungeon min level asc, names. */
function compareGroups(a: SuggestedGroupDto, b: SuggestedGroupDto): number {
  return (
    a.levelSpread - b.levelSpread ||
    (b.sharedQuests ?? -1) - (a.sharedQuests ?? -1) ||
    a.instance.minimumLevel - b.instance.minimumLevel ||
    cmp(names(a), names(b)) ||
    cmp(keys(a), keys(b)) ||
    a.instance.id - b.instance.id
  );
}

/** A ranked copy (input untouched); total order, so ties are deterministic. */
export function rankGroups(
  groups: readonly SuggestedGroupDto[],
): SuggestedGroupDto[] {
  return [...groups].sort(compareGroups);
}

/** Ruling 3: the best group of each of the `n` best-ranked distinct dungeons. */
export function pickTop(
  groups: readonly SuggestedGroupDto[],
  n: number = SUGGESTED_GROUPS_TOP_COUNT,
): SuggestedGroupDto[] {
  const dungeons = new Set<number>();
  const top: SuggestedGroupDto[] = [];
  for (const g of rankGroups(groups)) {
    if (top.length >= n) break;
    if (dungeons.has(g.instance.id)) continue;
    dungeons.add(g.instance.id);
    top.push(g);
  }
  return top;
}
