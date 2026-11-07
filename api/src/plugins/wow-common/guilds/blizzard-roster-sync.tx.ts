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
} from './blizzard-roster-sync.helpers';

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
 * Steps 4–10. The caller has already ruled out 404 / error / empty.
 * @param tx - The sync transaction.
 * @param guild - The Forever guild being synced.
 * @param members - Mapped, non-empty API roster.
 * @param now - Sync instant T (guild + member stamps share it).
 */
export async function applyForeverRoster(
  tx: AddonImportTx,
  guild: SyncGuild,
  members: readonly ForeverGuildMember[],
  now: Date,
): Promise<RosterApplyResult> {
  await lockGuildName(tx, guild.gameId, guild.region, guild.nameKey);
  const existing = await loadExisting(tx, guild.id);
  const match = matchRosterMembers(existing, members);
  const { delta, flag } = await measure(tx, guild.id, match, members.length);
  if (!(await stampGuild(tx, guild.id, members.length, now))) {
    return { stale: true, updated: 0, inserted: 0, flag: null, warnings: [] };
  }
  await writeMembers(tx, guild.id, existing, match, now);
  await logDings(tx, guild.id, existing, match, now);
  const inserted = match.unmatched.length;
  const counts = { members: members.length, newMembers: inserted, delta };
  await auditRosterChange(tx, guild.id, BLIZZARD_ACTOR, counts);
  const updated = match.matched.length;
  return { stale: false, updated, inserted, flag, warnings: match.warnings };
}
