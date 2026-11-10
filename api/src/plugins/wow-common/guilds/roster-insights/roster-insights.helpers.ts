import type {
  HubFactSource,
  WowRosterInsightsDto,
} from '@raid-ledger/contract';
import { effectiveProfessionSkill } from '../../blizzard-professions.helpers';
import type { Fact } from '../../facts/wow-fact.types';
import {
  FOREVER_LEVEL_CAP,
  LOWEST_DUNGEON_LEVEL,
  levelOf,
} from './roster-insights.levels';
import type { InsightRow } from './roster-insights.types';
import { roleCountRows } from '../guild-role-counts.helpers';

type Roles = WowRosterInsightsDto['roles'];
type RoleCounts = Roles['dungeon'];
type Profession = WowRosterInsightsDto['professions'] extends
  (infer P)[] | undefined
  ? P
  : never;
type Freshness = WowRosterInsightsDto['freshness'];

const MAX_PROFESSIONS = 40;

/**
 * "Mains only": a linked user's alts drop out (their representative row —
 * main, else best rank — stays, picked by {@link roleCountRows}); unlinked
 * rows are kept — we cannot tell whose alt they are.
 */
export function mainsOnly(rows: readonly InsightRow[]): InsightRow[] {
  const keep = new Set(
    roleCountRows(rows).filter(
      (r) => r.userId !== null && r.characterId !== null,
    ),
  );
  return rows.filter((r) => r.userId === null || keep.has(r));
}

function zeroRoles(): RoleCounts {
  return { tank: 0, healer: 0, dps: 0, unknown: 0 };
}

/**
 * Role mix, ONE per linked user plus one per unlinked roster member — the
 * same rows as the guild page's `roleCounts` (ROK-2158). The role is the
 * resolved `role` fact from the facts layer: a manual override, else a
 * manual (non-Armory) character's own `role`, else Blizzard/Armory (the
 * member snapshot for an unclaimed row), else the gap-fill. This DIVERGES
 * from the guild chips/rows (`effectiveRole`: override → Armory → character
 * role): a manual character with role `dps` and an Armory snapshot `healer`
 * counts dps here but healer on the chips (TECH-DEBT-BACKLOG 2026-11-09).
 * Dungeon-eligible = level ≥ the lowest instance minimum; raid = at cap.
 */
export function computeRoles(rows: readonly InsightRow[]): Roles {
  const roles: Roles = { dungeon: zeroRoles(), raid: zeroRoles() };
  for (const row of roleCountRows(rows)) {
    const level = levelOf(row);
    if (level === null || level < LOWEST_DUNGEON_LEVEL) continue;
    const role = row.facts?.role?.value ?? 'unknown';
    roles.dungeon[role] += 1;
    if (level >= FOREVER_LEVEL_CAP) roles.raid[role] += 1;
  }
  return roles;
}

type ProfessionMember = Profession['members'][number];

/**
 * The identity half of a profession member: a linked character, or (ROK-2149
 * Q4=A) an unclaimed roster member keyed by `memberId`. Null = unkeyable.
 */
function memberIdentity(
  row: InsightRow,
): Pick<ProfessionMember, 'characterId' | 'memberId'> | null {
  const memberId = row.memberId ?? null;
  if (row.characterId === null && memberId === null) return null;
  return {
    characterId: row.characterId,
    ...(memberId === null ? {} : { memberId }),
  };
}

/**
 * Profession → members with their skill; most members first. A linked row
 * reports its character's resolved facts; an unclaimed roster row reports its
 * verified Armory snapshot (ROK-2133 member facts), with `characterId: null`.
 */
export function computeProfessions(rows: readonly InsightRow[]): Profession[] {
  const byName = new Map<string, Profession>();
  for (const row of rows) {
    const fact = row.facts?.professions;
    const identity = memberIdentity(row);
    if (!fact || !identity) continue;
    for (const p of [...fact.value.primary, ...fact.value.secondary]) {
      const entry = byName.get(p.name) ?? { name: p.name, members: [] };
      // Pre-ROK-2130 Armory rows store 0/0 with the real pair in `tiers[]`.
      const skill = effectiveProfessionSkill(p);
      entry.members.push({
        ...identity,
        name: row.name,
        skill: skill.skillLevel,
        maxSkill: skill.maxSkillLevel,
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
