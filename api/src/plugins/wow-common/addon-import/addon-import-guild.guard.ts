import { Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { AddonGuildExport } from '@raid-ledger/contract';
import * as schema from '../../../drizzle/schema';
import { hasConfirmedMemberGrant } from '../guilds/guild-delegation.helpers';
import {
  findLinkedMemberRows,
  inLatestSnapshot,
} from '../guilds/guild-membership.helpers';
import { exportClock } from './addon-import.clock';
import { AddonImportError } from './addon-import.errors';
import { fromUnix, type AddonApplyContext } from './addon-import-apply.types';

/**
 * SECURITY (ROK-1794, 2026-10-18 review) — guild exports are unsigned, so
 * the roster a snapshot carries proves nothing about who sent it. After a
 * guild's first import its roster is replaced only by staff or by the holder
 * of an explicit, staff-made member grant ("explicit grants only", operator
 * ruling 2026-10-19), and never wholesale.
 */

const { guilds, guildMembers, guildEditors, users, activityLog } = schema;
const logger = new Logger('AddonImportGuildGuard');

/** A snapshot dropping at least this many live members… */
export const MASS_REMOVAL_MIN = 5;
/** …and more than this share of them is held for staff. */
export const MASS_REMOVAL_SHARE = 0.25;
/**
 * Removals and additions are summed over this rolling window (review r1/r2):
 * per-import counting let a live member drop 4 members an import, 80 an hour.
 */
export const REMOVAL_WINDOW_HOURS = 24;
const WINDOW = sql.raw(`interval '${REMOVAL_WINDOW_HOURS} hours'`);

export const NOT_AN_EDITOR_MESSAGE =
  'Only an admin, or a member an admin has made a guild editor, can update this roster.';
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
    readonly added: number = 0,
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

/**
 * ROK-1794 Codex P2 — serialise applies of one guild (keyed by game, region
 * and name key, so two first snapshots of a NEW guild serialise too): read
 * roster → count removals → write audit can't interleave, so two identical
 * concurrent imports count a removal once (the second reads the first's
 * roster and removes nothing). Released at commit/rollback.
 */
export async function lockGuildImport(
  ctx: AddonApplyContext,
  nameKey: string,
): Promise<void> {
  const key = `guild-import:${ctx.gameId}:${ctx.region}:${nameKey}`;
  await ctx.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
}

/**
 * ROK-1794 "explicit grants only" (operator ruling 2026-10-19): being on the
 * stored roster proves nothing — the importer may have claimed that GUID with
 * a forged character export. Only a staff-made `kind='member'` grant on a
 * CONFIRMED link counts (the linking character existed at grant time and has
 * claimed no GUID since). That includes the guild's own creator. Rank grants
 * never count here: their `rank_index` is self-reported by unsigned exports.
 */
export async function importerHoldsMemberGrant(
  ctx: AddonApplyContext,
  guildId: number,
): Promise<boolean> {
  const rows = await findLinkedMemberRows(ctx.tx, ctx.userId, guildId);
  if (rows.length === 0) return false;
  return hasConfirmedMemberGrant(ctx.tx, guildId, rows);
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

/** Live members a snapshot drops and GUIDs it adds (counted for the window). */
export interface RosterDelta {
  removed: number;
  added: number;
}
const NO_DELTA: RosterDelta = { removed: 0, added: 0 };

const windowSum = (key: keyof RosterDelta) =>
  sql<number>`coalesce(sum((${activityLog.metadata}->>${key})::int), 0)::int`;

/**
 * Members this guild's non-staff imports removed and added inside the
 * window, read from the AC6 audit rows (`metadata.removed` / `.added`; staff
 * imports and the guild-creating import record 0, older rows sum as 0).
 * Uses the DB clock — `created_at` is stamped by the DB, not the export clock.
 */
export async function recentChanges(
  ctx: AddonApplyContext,
  guildId: number,
): Promise<RosterDelta> {
  const [row] = await ctx.tx
    .select({ removed: windowSum('removed'), added: windowSum('added') })
    .from(activityLog)
    .where(
      and(
        eq(activityLog.entityType, ROSTER_AUDIT_ENTITY),
        eq(activityLog.entityId, guildId),
        eq(activityLog.action, ROSTER_AUDIT_ACTION),
        sql`${activityLog.createdAt} >= now() - ${WINDOW}`,
      ),
    );
  return { removed: Number(row?.removed ?? 0), added: Number(row?.added ?? 0) };
}

/**
 * The window's totals against the roster the guild had at the window's
 * start (live + removed - added). Members added inside the window never
 * grow that baseline (review r2: pad with fakes, then strip real members).
 */
export function windowVerdict(
  live: number,
  prior: RosterDelta,
  now: RosterDelta,
) {
  const base = Math.max(0, live + prior.removed - prior.added);
  const removed = prior.removed + now.removed;
  const added = prior.added + now.added;
  const held = isMassRemoval(base, removed) || isMassRemoval(base, added);
  return { base, removed, added, held };
}

/** Held when this import plus the window's earlier changes is wholesale. */
async function assertNoWholesaleChange(
  ctx: AddonApplyContext,
  guildId: number,
  payload: AddonGuildExport,
): Promise<RosterDelta> {
  const incoming = new Set(payload.data.members.map((m) => m.guid));
  // Legacy rows without a GUID can't be matched to a snapshot: not counted.
  const live = (await liveRoster(ctx, guildId)).filter((r) => r.guid !== null);
  const liveGuids = new Set(live.map((r) => r.guid));
  const gone = live.filter((r) => r.guid !== null && !incoming.has(r.guid));
  const added = [...incoming].filter((g) => !liveGuids.has(g)).length;
  const now = { removed: gone.length, added };
  const dropsEditor = gone.some((r) => r.grantId !== null);
  const v = windowVerdict(live.length, await recentChanges(ctx, guildId), now);
  if (!dropsEditor && !v.held) return now;
  logger.warn(
    `Held guild snapshot: guild=${guildId} user=${ctx.userId} removes ${now.removed}, adds ${added} of ${live.length} (${v.removed}/${v.added} of ${v.base} in ${REMOVAL_WINDOW_HOURS}h)${dropsEditor ? ' incl. an editor' : ''}`,
  );
  throw new RosterHeldError(guildId, v.removed, v.base, dropsEditor, v.added);
}

/**
 * Gate a snapshot of an EXISTING guild (a brand-new guild has no roster to
 * protect). Staff pass; anyone else must hold a confirmed member grant
 * (`importerHoldsMemberGrant`), and a fresh snapshot may not change the
 * roster wholesale. `fresh` = not stale (a stale
 * snapshot writes nothing, so only membership is checked). Returns the
 * members this snapshot removes and adds (0/0 for staff — they never count).
 */
export async function assertMayReplaceRoster(
  ctx: AddonApplyContext,
  guildId: number,
  payload: AddonGuildExport,
  fresh: boolean,
): Promise<RosterDelta> {
  if (await importerIsStaff(ctx)) return NO_DELTA;
  if (!(await importerHoldsMemberGrant(ctx, guildId))) {
    throw new AddonImportError('NOT_IN_GUILD', NOT_AN_EDITOR_MESSAGE);
  }
  return fresh ? assertNoWholesaleChange(ctx, guildId, payload) : NO_DELTA;
}

/** AC6 — which user's import replaced a guild's roster (shared activity_log). */
export async function auditRosterReplaced(
  ctx: AddonApplyContext,
  guildId: number,
  members: number,
  newMembers: number,
  delta: RosterDelta,
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
      removed: delta.removed,
      added: delta.added,
    },
  });
}
