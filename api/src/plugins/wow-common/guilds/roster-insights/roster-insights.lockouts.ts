/**
 * ROK-1914 (W6 "Who's saved") — pure grouping of the roster's resolved
 * `lockouts` facts by instance save. No I/O; the clock is passed in.
 */
import type { WowRosterLockoutDto } from '@raid-ledger/contract';
import { difficultyLabel } from '../../forever-lockouts.adapter';
import type { InsightRow } from './roster-insights.types';

/** Contract cap on `lockouts[]`. */
export const MAX_LOCKOUT_GROUPS = 200;

interface Group {
  instanceId: number;
  difficultyId: number;
  name: string;
  total: number;
  /** Soonest member reset, unix seconds. */
  resetAt: number;
  members: {
    characterId: string;
    name: string;
    killed: number;
    resetAt: number;
  }[];
}

const toIso = (unixSeconds: number): string =>
  new Date(unixSeconds * 1000).toISOString();

/**
 * One entry per `(instanceId, difficultyId)` (D2): every linked character
 * with an unexpired save there (D3: `resetAt*1000 <= nowMs` is expired).
 * Members sorted by name; groups by member count desc, then name.
 */
export function computeLockouts(
  rows: readonly InsightRow[],
  nowMs: number,
): WowRosterLockoutDto[] {
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const fact = row.facts?.lockouts;
    if (!fact || row.characterId === null) continue;
    for (const l of fact.value) {
      if (l.resetAt * 1000 <= nowMs) continue;
      const key = `${l.instanceId}:${l.difficultyId}`;
      const g = groups.get(key) ?? newGroup(l);
      g.resetAt = Math.min(g.resetAt, l.resetAt);
      g.members.push({
        characterId: row.characterId,
        name: row.name,
        killed: l.killed,
        resetAt: l.resetAt,
      });
      groups.set(key, g);
    }
  }
  return [...groups.values()]
    .sort(
      (a, b) =>
        b.members.length - a.members.length || a.name.localeCompare(b.name),
    )
    .slice(0, MAX_LOCKOUT_GROUPS)
    .map(toDto);
}

function newGroup(l: {
  instanceId: number;
  difficultyId: number;
  name: string;
  total: number;
  resetAt: number;
}): Group {
  return {
    instanceId: l.instanceId,
    difficultyId: l.difficultyId,
    name: l.name,
    total: l.total,
    resetAt: l.resetAt,
    members: [],
  };
}

function toDto(g: Group): WowRosterLockoutDto {
  return {
    instanceId: g.instanceId,
    difficultyId: g.difficultyId,
    name: g.name,
    difficulty: difficultyLabel(g.difficultyId),
    total: g.total,
    resetAt: toIso(g.resetAt),
    members: [...g.members]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((m) => ({ ...m, resetAt: toIso(m.resetAt) })),
  };
}
