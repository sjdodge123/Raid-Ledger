/**
 * ROK-1917 (W10 "Raid progress") — the members-only `raidProgress` section of
 * roster-insights, from the boss pulls LedgerLink raid exports stored in
 * `addon_encounter_pulls`. Never reads a pull's `roster`/`rosterNames` (D6).
 *
 * Scope (D2): `game_id`, `region` and `guild_key` match the hub (the same
 * realm-less normaliser on both sides); unguilded ('') pulls never count.
 * Trust (Q1): only pulls reported by a linked roster user of this hub, or by
 * a since-deleted user (reporter NULL). Window (Q7): all time.
 */
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  MAX_RAID_PROGRESS_BOSSES,
  type WowRosterRaidProgressBossDto,
  type WowRosterRaidProgressDto,
} from '@raid-ledger/contract';
import * as schema from '../../../../drizzle/schema';
import { difficultyLabel } from '../../forever-lockouts.adapter';

/** Q2/D4: same-boss pulls starting ≤ this far apart are one pull. */
export const RAID_PULL_NEAR_DUP_MS = 10_000;

/** The pull columns the widget needs — never the roster. */
export interface RaidPull {
  encounterId: number;
  encounterName: string;
  difficultyId: number;
  startAt: Date;
  endAt: Date;
  success: boolean;
}

type Boss = WowRosterRaidProgressBossDto;

/**
 * D4: collapse near-duplicate pulls of ONE `(encounter, difficulty)` — two
 * exporters read `GetServerTime()` separately, so the same pull can land 1 s
 * apart and pass the exact-second DB dedupe. A pull within the window of the
 * cluster's first pull joins it; a kill in the cluster wins over a wipe.
 */
export function collapseNearDuplicates(pulls: readonly RaidPull[]): RaidPull[] {
  const sorted = [...pulls].sort(
    (a, b) => a.startAt.getTime() - b.startAt.getTime(),
  );
  const out: RaidPull[] = [];
  let anchor: RaidPull | null = null;
  for (const p of sorted) {
    const last = out[out.length - 1];
    const near =
      anchor !== null &&
      p.startAt.getTime() - anchor.startAt.getTime() <= RAID_PULL_NEAR_DUP_MS;
    if (near && last) out[out.length - 1] = mergePull(last, p);
    else {
      anchor = p;
      out.push(p);
    }
  }
  return out;
}

/** One cluster member wins: a kill beats a wipe; ties keep the earlier one. */
function mergePull(kept: RaidPull, dup: RaidPull): RaidPull {
  return dup.success && !kept.success ? dup : kept;
}

const maxDate = (a: Date, b: Date): Date => (b > a ? b : a);

/** One boss row from the collapsed pulls of one `(encounter, difficulty)`. */
function toBoss(pulls: readonly RaidPull[]): Boss | null {
  const first = pulls[0];
  if (!first) return null;
  let newest = first;
  let firstKill: Date | null = null;
  let lastPull = first.endAt;
  let kills = 0;
  for (const p of pulls) {
    if (p.startAt > newest.startAt) newest = p;
    lastPull = maxDate(lastPull, p.endAt);
    if (!p.success) continue;
    kills += 1;
    if (firstKill === null || p.endAt < firstKill) firstKill = p.endAt;
  }
  return {
    encounterId: first.encounterId,
    difficultyId: first.difficultyId,
    difficultyLabel: difficultyLabel(first.difficultyId),
    name: newest.encounterName,
    firstKillAt: firstKill?.toISOString() ?? null,
    kills,
    wipes: pulls.length - kills,
    lastPullAt: lastPull.toISOString(),
  };
}

/** AC5: killed first by first kill, then unkilled by wipes; then name. */
export function compareBosses(a: Boss, b: Boss): number {
  if (a.firstKillAt !== null && b.firstKillAt !== null) {
    const byKill = a.firstKillAt.localeCompare(b.firstKillAt);
    if (byKill !== 0) return byKill;
  } else if (a.firstKillAt !== b.firstKillAt) {
    return a.firstKillAt === null ? 1 : -1;
  } else if (a.wipes !== b.wipes) {
    return b.wipes - a.wipes;
  }
  return a.name.localeCompare(b.name) || a.difficultyId - b.difficultyId;
}

/** Group pulls by `(encounter, difficulty)`. */
function groupPulls(pulls: readonly RaidPull[]): RaidPull[][] {
  const groups = new Map<string, RaidPull[]>();
  for (const p of pulls) {
    const key = `${p.encounterId}:${p.difficultyId}`;
    const group = groups.get(key);
    if (group) group.push(p);
    else groups.set(key, [p]);
  }
  return [...groups.values()];
}

/** The `raidProgress` section from the hub's in-scope pulls (pure). */
export function computeRaidProgress(
  pulls: readonly RaidPull[],
): WowRosterRaidProgressDto {
  const bosses = groupPulls(pulls)
    .map((g) => collapseNearDuplicates(g))
    .flatMap((g) => {
      const boss = toBoss(g);
      return boss ? [boss] : [];
    })
    .sort(compareBosses);
  const pullCount = bosses.reduce((n, b) => n + b.kills + b.wipes, 0);
  const lastPullAt = bosses.reduce<string | null>(
    (at, b) => (at === null || b.lastPullAt > at ? b.lastPullAt : at),
    null,
  );
  return {
    bosses: bosses.slice(0, MAX_RAID_PROGRESS_BOSSES),
    killedCount: bosses.filter((b) => b.kills > 0).length,
    pullCount,
    lastPullAt,
  };
}

type Db = PostgresJsDatabase<typeof schema>;

/** The hub's pull scope; null for a non-guild hub or an empty name key. */
async function loadScope(db: Db, guildId: number) {
  const g = schema.guilds;
  const [row] = await db
    .select({
      gameId: g.gameId,
      region: g.region,
      nameKey: g.nameKey,
      kind: g.kind,
    })
    .from(g)
    .where(eq(g.id, guildId))
    .limit(1);
  if (!row || row.kind !== 'wow_guild' || row.nameKey === '') return null;
  return row;
}

/** Q1: a linked roster user of this hub, or a since-deleted user (NULL). */
function trustedReporter(reporterIds: readonly number[]) {
  const by = schema.addonEncounterPulls.reportedByUserId;
  return reporterIds.length > 0
    ? or(inArray(by, [...reporterIds]), isNull(by))
    : isNull(by);
}

/** In-scope pulls reported by `reporterIds` or by a deleted user (Q1). */
async function loadGuildPulls(
  db: Db,
  scope: { gameId: number; region: string; nameKey: string },
  reporterIds: readonly number[],
): Promise<RaidPull[]> {
  const p = schema.addonEncounterPulls;
  const trusted = trustedReporter(reporterIds);
  return db
    .select({
      encounterId: p.encounterId,
      encounterName: p.encounterName,
      difficultyId: p.difficultyId,
      startAt: p.startAt,
      endAt: p.endAt,
      success: p.success,
    })
    .from(p)
    .where(
      and(
        eq(p.gameId, scope.gameId),
        eq(p.region, scope.region),
        eq(p.guildKey, scope.nameKey),
        trusted,
      ),
    );
}

/**
 * The members-only `raidProgress` for a hub, or null when the hub is not a
 * WoW guild (the key is then omitted). `rosterUserIds` are the owners of the
 * FULL roster's linked characters — never narrowed by `?mainsOnly` (D5).
 */
export async function loadRaidProgress(
  db: Db,
  guildId: number,
  rosterUserIds: readonly number[],
): Promise<WowRosterRaidProgressDto | null> {
  const scope = await loadScope(db, guildId);
  if (!scope) return null;
  const reporters = [...new Set(rosterUserIds)];
  return computeRaidProgress(await loadGuildPulls(db, scope, reporters));
}
