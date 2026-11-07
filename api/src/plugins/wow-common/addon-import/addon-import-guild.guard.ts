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
  type AddonImportTx,
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

/**
 * Strictly newer than the stored snapshot (compared at its received instant).
 * An equal-instant import demotes nobody (every stored row keeps its seenAt),
 * so it counts no removals — but the GUIDs it adds still go live, so those
 * are measured, audited and flagged like any other (Codex P2).
 */
export function isNewerGuildSnapshot(
  lastSnapshotAt: Date | null | undefined,
  snapshotAt: number,
): boolean {
  if (!lastSnapshotAt) return true;
  return receivedSnapshotAt(snapshotAt).getTime() > lastSnapshotAt.getTime();
}

/** Where a snapshot sits against the stored one. */
export type SnapshotOrder = 'stale' | 'equal' | 'newer';

export function snapshotOrder(stale: boolean, newer: boolean): SnapshotOrder {
  if (stale) return 'stale';
  return newer ? 'newer' : 'equal';
}

export function isMassRemoval(live: number, removed: number): boolean {
  return removed >= MASS_REMOVAL_MIN && removed > live * MASS_REMOVAL_SHARE;
}

/** Who replaced a roster: an importing user, or the Blizzard sync (ROK-1928). */
export type RosterActor =
  | { kind: 'user'; userId: number; characterId: string }
  | { kind: 'system'; source: 'blizzard' };

/** The addon importer as a roster actor. */
export function userActor(ctx: AddonApplyContext): RosterActor {
  return { kind: 'user', userId: ctx.userId, characterId: ctx.characterId };
}

/** Staff (admin/operator) imports are never measured; the system never is staff. */
async function actorIsStaff(
  tx: AddonImportTx,
  actor: RosterActor,
): Promise<boolean> {
  if (actor.kind === 'system') return false;
  const [row] = await tx
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, actor.userId));
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

/** A live roster row: its id, GUID (null for Blizzard-only rows) and any member grant. */
export interface LiveRosterRow {
  id: number;
  guid: string | null;
  grantId: number | null;
}

/** Live roster rows, each flagged when it holds a member-kind grant. */
async function liveRoster(
  tx: AddonImportTx,
  guildId: number,
): Promise<LiveRosterRow[]> {
  return tx
    .select({
      id: guildMembers.id,
      guid: guildMembers.guid,
      grantId: guildEditors.id,
    })
    .from(guildMembers)
    .innerJoin(guilds, eq(guilds.id, guildMembers.guildId))
    .leftJoin(guildEditors, eq(guildEditors.guildMemberId, guildMembers.id))
    .where(and(eq(guildMembers.guildId, guildId), inLatestSnapshot()));
}

/**
 * Which live rows a snapshot keeps: by GUID (addon) or by stored member id
 * (Blizzard sync, whose rows may carry no GUID; `members` = roster size).
 */
export type RosterPresence =
  | { by: 'guid'; guids: ReadonlySet<string> }
  | { by: 'id'; ids: ReadonlySet<number>; members: number };

/** Everything a roster check needs (ROK-1928: payload-free). */
export interface RosterChangeInput {
  guildId: number;
  presence: RosterPresence;
  order: SnapshotOrder;
  actor: RosterActor;
}

/** The rows a snapshot is measured against, those it drops, and how many it adds. */
export interface RosterMovement {
  counted: LiveRosterRow[];
  gone: LiveRosterRow[];
  added: number;
}

/**
 * Pure. By GUID, legacy rows without one can't be matched to a snapshot and
 * are not counted; by id, every live row counts and a member matched to a
 * not-live row counts as added.
 */
export function rosterMovement(
  live: LiveRosterRow[],
  presence: RosterPresence,
): RosterMovement {
  if (presence.by === 'id') {
    const kept = live.filter((r) => presence.ids.has(r.id)).length;
    const gone = live.filter((r) => !presence.ids.has(r.id));
    return { counted: live, gone, added: presence.members - kept };
  }
  const counted = live.filter((r) => r.guid !== null);
  const liveGuids = new Set(counted.map((r) => r.guid));
  const gone = counted.filter(
    (r) => r.guid !== null && !presence.guids.has(r.guid),
  );
  const added = [...presence.guids].filter((g) => !liveGuids.has(g)).length;
  return { counted, gone, added };
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
  tx: AddonImportTx,
  guildId: number,
): Promise<RosterDelta> {
  const [row] = await tx
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

const actorLabel = (a: RosterActor): string =>
  a.kind === 'user' ? `user=${a.userId}` : `source=${a.source}`;

/**
 * This import's delta plus the flag its window earns (never throws). Staff
 * are notified only when THIS import moves someone (Codex P2): once a
 * wholesale change applies, the window totals stay over the line for 24h,
 * and every later logout export of the unchanged roster must not re-alarm.
 */
async function measureRosterChange(
  tx: AddonImportTx,
  input: RosterChangeInput,
  countRemovals: boolean,
): Promise<RosterCheck> {
  const { guildId } = input;
  const m = rosterMovement(await liveRoster(tx, guildId), input.presence);
  const gone = countRemovals ? m.gone : [];
  const delta = { removed: gone.length, added: m.added };
  const dropsEditor = gone.some((r) => r.grantId !== null);
  const live = m.counted.length;
  const v = windowVerdict(live, await recentChanges(tx, guildId), delta);
  const moved = delta.removed + delta.added > 0;
  const flag = moved ? wholesaleFlag(guildId, v, dropsEditor) : null;
  if (flag) {
    logger.warn(
      `Wholesale guild snapshot applied: guild=${guildId} ${actorLabel(input.actor)} removes ${delta.removed}, adds ${m.added} of ${live} (${v.removed}/${v.added} of ${v.base} in ${REMOVAL_WINDOW_HOURS}h)${dropsEditor ? ' incl. an editor' : ''}`,
    );
  }
  return { delta, flag };
}

/**
 * Measure a snapshot of an EXISTING guild (a brand-new guild has no roster
 * to protect). Staff count 0/0 and are never flagged; a stale snapshot
 * writes nothing, so it measures nothing. Anyone else's NEWER snapshot
 * returns its delta and any wholesale flag; an EQUAL-instant one counts its
 * additions only (it demotes nobody). Never refuses (ROK-2066).
 */
export async function checkRosterChange(
  tx: AddonImportTx,
  input: RosterChangeInput,
): Promise<RosterCheck> {
  if (input.order === 'stale' || (await actorIsStaff(tx, input.actor))) {
    return UNCHECKED;
  }
  return measureRosterChange(tx, input, input.order === 'newer');
}

/** The addon payload's form of {@link checkRosterChange}. */
export async function checkRosterReplace(
  ctx: AddonApplyContext,
  guildId: number,
  payload: AddonGuildExport,
  order: SnapshotOrder,
): Promise<RosterCheck> {
  const guids = new Set(payload.data.members.map((m) => m.guid));
  return checkRosterChange(ctx.tx, {
    guildId,
    order,
    presence: { by: 'guid', guids },
    actor: userActor(ctx),
  });
}

/** Roster sizes an audit row records. */
export interface RosterAuditCounts {
  members: number;
  newMembers: number;
  delta: RosterDelta;
}

/** AC6 — who replaced a guild's roster (shared activity_log); system = null actor. */
export async function auditRosterChange(
  tx: AddonImportTx,
  guildId: number,
  actor: RosterActor,
  counts: RosterAuditCounts,
): Promise<void> {
  const who =
    actor.kind === 'user'
      ? { characterId: actor.characterId }
      : { source: actor.source };
  await tx.insert(schema.activityLog).values({
    entityType: ROSTER_AUDIT_ENTITY,
    entityId: guildId,
    action: ROSTER_AUDIT_ACTION,
    actorId: actor.kind === 'user' ? actor.userId : null,
    metadata: {
      ...who,
      members: counts.members,
      newMembers: counts.newMembers,
      removed: counts.delta.removed,
      added: counts.delta.added,
    },
  });
}

/** AC6 — which user's import replaced a guild's roster (shared activity_log). */
export async function auditRosterReplaced(
  ctx: AddonApplyContext,
  guildId: number,
  members: number,
  newMembers: number,
  delta: RosterDelta,
): Promise<void> {
  await auditRosterChange(ctx.tx, guildId, userActor(ctx), {
    members,
    newMembers,
    delta,
  });
}
