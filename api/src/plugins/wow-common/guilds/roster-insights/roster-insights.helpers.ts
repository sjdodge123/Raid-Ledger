import type {
  HubFactSource,
  WowRosterInsightsDto,
} from '@raid-ledger/contract';
import type { Fact } from '../../facts/wow-fact.types';
import {
  FOREVER_LEVEL_CAP,
  LOWEST_DUNGEON_LEVEL,
  levelOf,
} from './roster-insights.levels';
import type { InsightRow } from './roster-insights.types';

type Roles = WowRosterInsightsDto['roles'];
type RoleCounts = Roles['dungeon'];
type Profession = WowRosterInsightsDto['professions'] extends
  (infer P)[] | undefined
  ? P
  : never;
type Freshness = WowRosterInsightsDto['freshness'];

const MAX_PROFESSIONS = 40;

/** Main first, then the best (lowest) rank. */
function outranks(a: InsightRow, b: InsightRow): boolean {
  if (a.isMain !== b.isMain) return a.isMain;
  const ra = a.rankIndex ?? Number.MAX_SAFE_INTEGER;
  const rb = b.rankIndex ?? Number.MAX_SAFE_INTEGER;
  return ra < rb;
}

/** One row per linked user (its main, else best rank); unlinked rows dropped. */
export function representativeRows(rows: readonly InsightRow[]): InsightRow[] {
  const byUser = new Map<number, InsightRow>();
  for (const row of rows) {
    if (row.userId === null || row.characterId === null) continue;
    const prev = byUser.get(row.userId);
    if (!prev || outranks(row, prev)) byUser.set(row.userId, row);
  }
  return [...byUser.values()];
}

/**
 * "Mains only": a linked user's alts drop out (their representative row
 * stays); unlinked rows are kept — we cannot tell whose alt they are.
 */
export function mainsOnly(rows: readonly InsightRow[]): InsightRow[] {
  const keep = new Set(representativeRows(rows));
  return rows.filter((r) => r.userId === null || keep.has(r));
}

function zeroRoles(): RoleCounts {
  return { tank: 0, healer: 0, dps: 0, unknown: 0 };
}

/**
 * Role mix, ONE per linked user (like `roleCounts`). Dungeon-eligible =
 * level ≥ the lowest instance minimum; raid-eligible = at cap.
 */
export function computeRoles(rows: readonly InsightRow[]): Roles {
  const roles: Roles = { dungeon: zeroRoles(), raid: zeroRoles() };
  for (const row of representativeRows(rows)) {
    const level = levelOf(row);
    if (level === null || level < LOWEST_DUNGEON_LEVEL) continue;
    const role = row.facts?.role?.value ?? 'unknown';
    roles.dungeon[role] += 1;
    if (level >= FOREVER_LEVEL_CAP) roles.raid[role] += 1;
  }
  return roles;
}

/** Profession → linked members with their skill; most members first. */
export function computeProfessions(rows: readonly InsightRow[]): Profession[] {
  const byName = new Map<string, Profession>();
  for (const row of rows) {
    const fact = row.facts?.professions;
    if (!fact || row.characterId === null) continue;
    for (const p of [...fact.value.primary, ...fact.value.secondary]) {
      const entry = byName.get(p.name) ?? { name: p.name, members: [] };
      entry.members.push({
        characterId: row.characterId,
        name: row.name,
        skill: p.skillLevel,
        maxSkill: p.maxSkillLevel,
        source: fact.source,
      });
      byName.set(p.name, entry);
    }
  }
  return [...byName.values()]
    .sort(
      (a, b) =>
        b.members.length - a.members.length || a.name.localeCompare(b.name),
    )
    .slice(0, MAX_PROFESSIONS);
}

/** The oldest-dated class/level fact fed the numbers; null on no facts. */
function rosterFreshness(rows: readonly InsightRow[]): Freshness['roster'] {
  let oldest: Fact<unknown> | null = null;
  for (const row of rows) {
    for (const fact of [row.facts?.level, row.facts?.class]) {
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

/** Linked characters by the best source that fed them. */
function characterFreshness(
  rows: readonly InsightRow[],
): Freshness['characters'] {
  const counts = { addon: 0, blizzard: 0, none: 0 };
  for (const row of rows) {
    if (row.characterId === null) continue;
    const sources = new Set<HubFactSource>(
      Object.values(row.facts ?? {}).flatMap((f) => (f ? [f.source] : [])),
    );
    if (sources.has('addon')) counts.addon += 1;
    else if (sources.has('blizzard')) counts.blizzard += 1;
    else counts.none += 1;
  }
  return counts;
}

/** Footer freshness: the roster's oldest fact + per-character sources. */
export function computeFreshness(rows: readonly InsightRow[]): Freshness {
  return {
    roster: rosterFreshness(rows),
    characters: characterFreshness(rows),
  };
}
