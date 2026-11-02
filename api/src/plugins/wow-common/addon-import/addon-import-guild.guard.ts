import { Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { AddonGuildExport } from '@raid-ledger/contract';
import * as schema from '../../../drizzle/schema';
import { inLatestSnapshot } from '../guilds/guild-membership.helpers';
import { exportClock } from './addon-import.clock';
import { lockGuildName } from './addon-import.locks';
import {
  fromUnix,
  type AddonApplyContext,
  type RosterFlag,
} from './addon-import-apply.types';

/**
 * ROK-1794, relaxed by ROK-2066 (operator ruling 2026-11-02: "accept the
 * updated data if [the member's] data set is newer … worst case the hub
 * displays weird data until staff log in and update it"). Guild exports are
 * unsigned, so a roster proves nothing about who sent it. Any importer listed
 * in a NEWER snapshot replaces the roster — no grant needed (the exporter
 * check and the stale rule live in `addon-import-guild.apply.ts`). A
 * wholesale change applies too, and is flagged to staff after commit
 * (`addon-import-guild.flag.ts`); every non-staff replace is audited.
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

/** min(snapshotAt, server now): a post-dated snapshot can't outrank later ones. */
export function receivedSnapshotAt(
  snapshotAt: number,
  nowMs: number = exportClock.nowMs(),
): Date {
  return new Date(Math.min(fromUnix(snapshotAt).getTime(), nowMs));
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
 * roster and removes nothing). Released at commit/rollback. On apply the
 * run already holds it, taken AFTER the GUID lock (`addon-import.locks.ts`,
 * ROK-1794 lock order); this re-entry never blocks.
 */
export async function lockGuildImport(
  ctx: AddonApplyContext,
  nameKey: string,
): Promise<void> {
  await lockGuildName(ctx.tx, ctx.gameId, ctx.region, nameKey);
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

/** A roster check's result: the audited delta and any staff flag. */
export interface RosterCheck {
  delta: RosterDelta;
  flag: RosterFlag | null;
}
const UNCHECKED: RosterCheck = { delta: NO_DELTA, flag: null };

/**
 * ROK-2066 — the staff flag for a wholesale window (or a dropped member who
 * held editor rights), else null. It no longer blocks the import.
 */
export function wholesaleFlag(
  guildId: number,
  v: ReturnType<typeof windowVerdict>,
  dropsEditor: boolean,
): RosterFlag | null {
  if (!dropsEditor && !v.held) return null;
  const { removed, added, base: live } = v;
  return { guildId, removed, added, live, dropsEditor };
}

/** This import's delta plus the flag its window earns (never throws). */
async function measureRosterChange(
  ctx: AddonApplyContext,
  guildId: number,
  payload: AddonGuildExport,
): Promise<RosterCheck> {
  const incoming = new Set(payload.data.members.map((m) => m.guid));
  // Legacy rows without a GUID can't be matched to a snapshot: not counted.
  const live = (await liveRoster(ctx, guildId)).filter((r) => r.guid !== null);
  const liveGuids = new Set(live.map((r) => r.guid));
  const gone = live.filter((r) => r.guid !== null && !incoming.has(r.guid));
  const added = [...incoming].filter((g) => !liveGuids.has(g)).length;
  const delta = { removed: gone.length, added };
  const dropsEditor = gone.some((r) => r.grantId !== null);
  const v = windowVerdict(
    live.length,
    await recentChanges(ctx, guildId),
    delta,
  );
  const flag = wholesaleFlag(guildId, v, dropsEditor);
  if (flag) {
    logger.warn(
      `Wholesale guild snapshot applied: guild=${guildId} user=${ctx.userId} removes ${delta.removed}, adds ${added} of ${live.length} (${v.removed}/${v.added} of ${v.base} in ${REMOVAL_WINDOW_HOURS}h)${dropsEditor ? ' incl. an editor' : ''}`,
    );
  }
  return { delta, flag };
}

/**
 * Measure a snapshot of an EXISTING guild (a brand-new guild has no roster
 * to protect). Staff count 0/0 and are never flagged; anyone else's FRESH
 * snapshot returns its delta and any wholesale flag. A stale snapshot writes
 * nothing, so it measures nothing. Never refuses (ROK-2066).
 */
export async function checkRosterReplace(
  ctx: AddonApplyContext,
  guildId: number,
  payload: AddonGuildExport,
  fresh: boolean,
): Promise<RosterCheck> {
  if (!fresh || (await importerIsStaff(ctx))) return UNCHECKED;
  return measureRosterChange(ctx, guildId, payload);
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
