import { Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { AddonGuildExport } from '@raid-ledger/contract';
import * as schema from '../../../drizzle/schema';
import { inLatestSnapshot } from '../guilds/guild-membership.helpers';
import { exportClock } from './addon-import.clock';
import { AddonImportError } from './addon-import.errors';
import { fromUnix, type AddonApplyContext } from './addon-import-apply.types';

/**
 * SECURITY (ROK-1794, 2026-10-18 review) — guild exports are unsigned, so
 * the roster a snapshot carries proves nothing about who sent it. An existing
 * guild's roster is replaced only by staff or by an importer whose character
 * is already a live member of the STORED roster, and never wholesale.
 */

const { guilds, guildMembers, guildEditors, characters, users, activityLog } =
  schema;
const logger = new Logger('AddonImportGuildGuard');

/** A snapshot dropping at least this many live members… */
export const MASS_REMOVAL_MIN = 5;
/** …and more than this share of them is held for staff. */
export const MASS_REMOVAL_SHARE = 0.25;
/**
 * Removals are summed over this rolling window (review r1): per-import
 * counting let a live member drop 4 members an import, 80 an hour.
 */
export const REMOVAL_WINDOW_HOURS = 24;
const WINDOW = sql.raw(`interval '${REMOVAL_WINDOW_HOURS} hours'`);

export const NOT_A_MEMBER_MESSAGE =
  'Only a current member of this guild can update its roster.';
export const ROSTER_HELD_MESSAGE =
  'This roster would remove many members, or a member with editor rights, at once — ask an admin to import it.';

/** min(snapshotAt, server now): a post-dated snapshot can't outrank later ones. */
export function receivedSnapshotAt(
  snapshotAt: number,
  nowMs: number = exportClock.nowMs(),
): Date {
  return new Date(Math.min(fromUnix(snapshotAt).getTime(), nowMs));
}

/**
 * AC4 — a held snapshot. The wire body is the plain `INVALID_PAYLOAD` one
 * (no contract change); the extra facts drive the admin flag, written after
 * the import transaction has rolled back (`addon-import-guild.flag.ts`).
 */
export class RosterHeldError extends AddonImportError {
  constructor(
    readonly guildId: number,
    readonly removed: number,
    readonly live: number,
    readonly dropsEditor: boolean,
  ) {
    super('INVALID_PAYLOAD', ROSTER_HELD_MESSAGE);
  }
}

export function isMassRemoval(live: number, removed: number): boolean {
  return removed >= MASS_REMOVAL_MIN && removed > live * MASS_REMOVAL_SHARE;
}

async function importerIsStaff(ctx: AddonApplyContext): Promise<boolean> {
  const [row] = await ctx.tx
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, ctx.userId));
  return row?.role === 'admin' || row?.role === 'operator';
}

/** The importing character's STORED GUID is a live row of the guild. */
async function importerIsLiveMember(
  ctx: AddonApplyContext,
  guildId: number,
): Promise<boolean> {
  const rows = await ctx.tx
    .select({ id: guildMembers.id })
    .from(guildMembers)
    .innerJoin(guilds, eq(guilds.id, guildMembers.guildId))
    .innerJoin(characters, eq(characters.addonGuid, guildMembers.guid))
    .where(
      and(
        eq(characters.id, ctx.characterId),
        eq(guildMembers.guildId, guildId),
        inLatestSnapshot(),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Live roster GUIDs, each flagged when it holds a member-kind grant. */
async function liveRoster(ctx: AddonApplyContext, guildId: number) {
  return ctx.tx
    .select({ guid: guildMembers.guid, grantId: guildEditors.id })
    .from(guildMembers)
    .innerJoin(guilds, eq(guilds.id, guildMembers.guildId))
    .leftJoin(guildEditors, eq(guildEditors.guildMemberId, guildMembers.id))
    .where(and(eq(guildMembers.guildId, guildId), inLatestSnapshot()));
}

export const ROSTER_AUDIT_ENTITY = 'guild';
export const ROSTER_AUDIT_ACTION = 'guild_roster_replaced';

/**
 * Members this guild's non-staff imports removed inside the window, read
 * from the AC6 audit rows (`metadata.removed`; staff imports record 0).
 * Uses the DB clock — `created_at` is stamped by the DB, not the export clock.
 */
export async function recentRemovals(
  ctx: AddonApplyContext,
  guildId: number,
): Promise<number> {
  const removed = sql<number>`coalesce(sum((${activityLog.metadata}->>'removed')::int), 0)::int`;
  const [row] = await ctx.tx
    .select({ n: removed })
    .from(activityLog)
    .where(
      and(
        eq(activityLog.entityType, ROSTER_AUDIT_ENTITY),
        eq(activityLog.entityId, guildId),
        eq(activityLog.action, ROSTER_AUDIT_ACTION),
        sql`${activityLog.createdAt} >= now() - ${WINDOW}`,
      ),
    );
  return Number(row?.n ?? 0);
}

/** Held when this import plus the window's earlier removals is wholesale. */
async function assertNoWholesaleRemoval(
  ctx: AddonApplyContext,
  guildId: number,
  payload: AddonGuildExport,
): Promise<number> {
  const incoming = new Set(payload.data.members.map((m) => m.guid));
  const live = await liveRoster(ctx, guildId);
  const removed = live.filter((r) => r.guid === null || !incoming.has(r.guid));
  const dropsEditor = removed.some((r) => r.grantId !== null);
  const prior = await recentRemovals(ctx, guildId);
  const total = prior + removed.length;
  const base = prior + live.length;
  if (!dropsEditor && !isMassRemoval(base, total)) return removed.length;
  logger.warn(
    `Held guild snapshot: guild=${guildId} user=${ctx.userId} removes ${removed.length}/${live.length} (${total}/${base} in ${REMOVAL_WINDOW_HOURS}h)${dropsEditor ? ' incl. an editor' : ''}`,
  );
  throw new RosterHeldError(guildId, total, base, dropsEditor);
}

/**
 * Gate a snapshot of an EXISTING guild (a brand-new guild has no roster to
 * protect). Staff pass; anyone else must be a live member, and a fresh
 * snapshot may not drop members wholesale. `fresh` = not stale (a stale
 * snapshot writes nothing, so only membership is checked). Returns how many
 * live members this snapshot removes (0 for staff — they never count).
 */
export async function assertMayReplaceRoster(
  ctx: AddonApplyContext,
  guildId: number,
  payload: AddonGuildExport,
  fresh: boolean,
): Promise<number> {
  if (await importerIsStaff(ctx)) return 0;
  if (!(await importerIsLiveMember(ctx, guildId))) {
    throw new AddonImportError('NOT_IN_GUILD', NOT_A_MEMBER_MESSAGE);
  }
  return fresh ? assertNoWholesaleRemoval(ctx, guildId, payload) : 0;
}

/** AC6 — which user's import replaced a guild's roster (shared activity_log). */
export async function auditRosterReplaced(
  ctx: AddonApplyContext,
  guildId: number,
  members: number,
  newMembers: number,
  removed: number,
): Promise<void> {
  await ctx.tx.insert(schema.activityLog).values({
    entityType: ROSTER_AUDIT_ENTITY,
    entityId: guildId,
    action: ROSTER_AUDIT_ACTION,
    actorId: ctx.userId,
    metadata: {
      characterId: ctx.characterId,
      members,
      newMembers,
      removed,
    },
  });
}
