import { and, eq, isNull, lte, or } from 'drizzle-orm';
import { guildMembers, guilds } from '../../../drizzle/schema';
import type { AddonImportTx } from '../addon-import/addon-import-apply.types';
import type { RosterFlag } from '../addon-import/addon-import-apply.types';
import {
  insertDings,
  levelUpsById,
} from '../addon-import/addon-import-guild.dings';
import {
  auditRosterChange,
  checkRosterChange,
  type RosterActor,
} from '../addon-import/addon-import-guild.guard';
import { lockGuildName } from '../addon-import/addon-import.locks';
import type { ForeverGuildMember } from '../blizzard-forever-guild.helpers';
import {
  classNameForForeverId,
  matchRosterMembers,
  rosterUpdatePatch,
  type ExistingRosterRow,
  type RosterMatchResult,
} from './blizzard-roster-sync.helpers';
import {
  identityMismatch,
  type JunkMerge,
  planJunkMerges,
  withMergesApplied,
} from './blizzard-roster-sync.identity';
import { writeJunkMerges } from './blizzard-roster-sync.repair';

/**
 * ROK-1928 §B2 steps 4–10 — apply one fetched Forever roster inside ONE
 * transaction, under the same advisory lock the addon import takes. Nothing
 * is deleted or deactivated: absent rows just fall out of
 * `inLatestSnapshot()` when `last_snapshot_at` moves to T.
 */

export const BLIZZARD_ACTOR: RosterActor = {
  kind: 'system',
  source: 'blizzard',
};

/** The guild columns the apply needs. */
export interface SyncGuild {
  id: number;
  gameId: number;
  region: string;
  nameKey: string;
}

/** What one applied sync wrote. */
export interface RosterApplyResult {
  /** True when a newer snapshot already landed (nothing written). */
  stale: boolean;
  /**
   * True when the guild's slug changed or was cleared after the fetch
   * (Codex P2-2) — the roster belongs to the old slug, nothing written.
   */
  superseded: boolean;
  /**
   * ROK-2139 safety guard: why the roster was refused (it would replace the
   * GUID roster) — nothing written. Null otherwise.
   */
  mismatch: string | null;
  updated: number;
  inserted: number;
  flag: RosterFlag | null;
  warnings: string[];
}

async function loadExisting(
  tx: AddonImportTx,
  guildId: number,
): Promise<ExistingRosterRow[]> {
  return tx
    .select({
      id: guildMembers.id,
      guid: guildMembers.guid,
      blizzardCharacterId: guildMembers.blizzardCharacterId,
      characterName: guildMembers.characterName,
      className: guildMembers.class,
      level: guildMembers.level,
      rankIndex: guildMembers.rankIndex,
      rankName: guildMembers.rankName,
      lastSeenAt: guildMembers.lastSeenAt,
    })
    .from(guildMembers)
    .where(eq(guildMembers.guildId, guildId));
}

/** Step 8 — stamp the guild; the addon's `setWhere` (never move back in time). */
async function stampGuild(
  tx: AddonImportTx,
  guildId: number,
  members: number,
  now: Date,
): Promise<boolean> {
  const rows = await tx
    .update(guilds)
    .set({
      lastSnapshotAt: now,
      memberCount: members,
      blizzardRosterStatus: 'ok',
      blizzardRosterSyncedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(guilds.id, guildId),
        or(isNull(guilds.lastSnapshotAt), lte(guilds.lastSnapshotAt, now)),
      ),
    )
    .returning({ id: guilds.id });
  return rows.length > 0;
}

/** Step 7 — a member no stored row matched: a GUID-less Blizzard row. */
function insertValues(guildId: number, m: ForeverGuildMember, now: Date) {
  return {
    guildId,
    guid: null,
    blizzardCharacterId: m.blizzardId,
    characterName: m.name,
    level: m.level,
    class: classNameForForeverId(m.classId),
    rankIndex: m.rank,
    rankName: null,
    source: 'blizzard',
    lastSeenAt: now,
    capturedByUserId: null,
    updatedAt: now,
  };
}

/** Steps 6–7 — UPDATE matched rows (allowed columns only), INSERT the rest. */
async function writeMembers(
  tx: AddonImportTx,
  guildId: number,
  existing: readonly ExistingRosterRow[],
  match: ReturnType<typeof matchRosterMembers>,
  now: Date,
): Promise<void> {
  const byId = new Map(existing.map((r) => [r.id, r]));
  for (const { existingId, member } of match.matched) {
    const row = byId.get(existingId);
    if (row === undefined) continue;
    await tx
      .update(guildMembers)
      .set(rosterUpdatePatch(row, member, now))
      .where(eq(guildMembers.id, existingId));
  }
  if (match.unmatched.length === 0) return;
  await tx
    .insert(guildMembers)
    .values(match.unmatched.map((m) => insertValues(guildId, m, now)));
}

/** Step 10 — mass-removal guard, keyed by stored member id, actor system. */
async function measure(
  tx: AddonImportTx,
  guildId: number,
  match: ReturnType<typeof matchRosterMembers>,
  members: number,
) {
  const ids = new Set(match.matched.map((m) => m.existingId));
  return checkRosterChange(tx, {
    guildId,
    presence: { by: 'id', ids, members },
    order: 'newer',
    actor: BLIZZARD_ACTOR,
  });
}

/** Step 9 — dings by member id against the levels loaded in step 5. */
async function logDings(
  tx: AddonImportTx,
  guildId: number,
  existing: readonly ExistingRosterRow[],
  match: ReturnType<typeof matchRosterMembers>,
  now: Date,
): Promise<void> {
  const next = match.matched.map((m) => ({
    id: m.existingId,
    level: m.member.level,
  }));
  await insertDings({ tx }, guildId, levelUpsById(existing, next), now);
}

/**
 * Codex P2-2 + ROK-2139 P2b — why the roster may not be applied, read under
 * the guild lock BEFORE any write: the stored slug changed (`superseded`) or
 * a newer snapshot already landed (`stale`). Null when it may be applied.
 */
async function applyBlocker(
  tx: AddonImportTx,
  guildId: number,
  slug: string,
  now: Date,
): Promise<'superseded' | 'stale' | null> {
  const [row] = await tx
    .select({ guildSlug: guilds.guildSlug, snapshot: guilds.lastSnapshotAt })
    .from(guilds)
    .where(eq(guilds.id, guildId));
  if (row === undefined || row.guildSlug !== slug) return 'superseded';
  return row.snapshot !== null && row.snapshot > now ? 'stale' : null;
}

/** A result that wrote nothing. */
function nothingWritten(
  over: Partial<Pick<RosterApplyResult, 'stale' | 'superseded' | 'mismatch'>>,
): RosterApplyResult {
  return {
    stale: false,
    superseded: false,
    mismatch: null,
    updated: 0,
    inserted: 0,
    flag: null,
    warnings: [],
    ...over,
  };
}

/** ROK-2139 — what one sync will write, decided before any write. */
interface RosterApplyPlan {
  merges: JunkMerge[];
  /** Stored rows as they will be once the merges are written. */
  existing: ExistingRosterRow[];
  match: RosterMatchResult;
  /** The guard's refusal reason, or null. */
  mismatch: string | null;
}

/** ROK-2139 — merge plan, rows as they will be, match, and guard verdict. */
function planApply(
  loaded: readonly ExistingRosterRow[],
  members: readonly ForeverGuildMember[],
): RosterApplyPlan {
  const merges = planJunkMerges(loaded, members);
  const existing = withMergesApplied(loaded, merges);
  const match = matchRosterMembers(existing, members);
  const ids = new Set(match.matched.map((m) => m.existingId));
  const mismatch = identityMismatch(existing, ids, match.unmatched.length);
  return { merges, existing, match, mismatch };
}

/**
 * Write a planned roster. Every check ran before this, under the guild lock,
 * so a failed stamp means the lock was bypassed: throw, rolling back the
 * merges too, rather than commit a half-applied sync.
 */
async function writePlan(
  tx: AddonImportTx,
  guildId: number,
  plan: RosterApplyPlan,
  members: number,
  now: Date,
): Promise<RosterApplyResult> {
  const { existing, match } = plan;
  await writeJunkMerges(tx, guildId, plan.merges);
  const { delta, flag } = await measure(tx, guildId, match, members);
  if (!(await stampGuild(tx, guildId, members, now))) {
    throw new Error(`Forever roster sync: guild ${guildId} snapshot moved`);
  }
  await writeMembers(tx, guildId, existing, match, now);
  await logDings(tx, guildId, existing, match, now);
  const counts = { members, newMembers: match.unmatched.length, delta };
  await auditRosterChange(tx, guildId, BLIZZARD_ACTOR, counts);
  return appliedResult(match, flag);
}

/**
 * Steps 4–10. The caller has already ruled out 404 / error / empty. Junk
 * rows from an earlier sync are merged first; a roster that replaces the
 * GUID roster writes nothing and returns `mismatch` (ROK-2139).
 * @param tx - The sync transaction.
 * @param guild - The Forever guild being synced.
 * @param slug - The Blizzard slug the roster was fetched for; a different
 *   stored slug (changed/cleared mid-fetch) aborts with `superseded`.
 * @param members - Mapped, non-empty API roster.
 * @param now - Sync instant T (guild + member stamps share it).
 */
export async function applyForeverRoster(
  tx: AddonImportTx,
  guild: SyncGuild,
  slug: string,
  members: readonly ForeverGuildMember[],
  now: Date,
): Promise<RosterApplyResult> {
  await lockGuildName(tx, guild.gameId, guild.region, guild.nameKey);
  const blocker = await applyBlocker(tx, guild.id, slug, now);
  if (blocker === 'stale') return nothingWritten({ stale: true });
  if (blocker === 'superseded') return nothingWritten({ superseded: true });
  const plan = planApply(await loadExisting(tx, guild.id), members);
  if (plan.mismatch !== null) {
    return nothingWritten({ mismatch: plan.mismatch });
  }
  return writePlan(tx, guild.id, plan, members.length, now);
}

/** The result of a roster that was written (neither stale nor superseded). */
function appliedResult(
  match: RosterMatchResult,
  flag: RosterApplyResult['flag'],
): RosterApplyResult {
  return {
    stale: false,
    superseded: false,
    mismatch: null,
    updated: match.matched.length,
    inserted: match.unmatched.length,
    flag,
    warnings: match.warnings,
  };
}
