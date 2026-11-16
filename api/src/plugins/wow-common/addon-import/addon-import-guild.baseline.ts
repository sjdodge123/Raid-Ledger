import { eq } from 'drizzle-orm';
import * as schema from '../../../drizzle/schema';
import type { AddonImportTx } from './addon-import-apply.types';

/**
 * ROK-2225 — the rows a roster source measures churn against. The Blizzard
 * sync and LedgerLink imports both replace the guild's latest snapshot, so
 * "live" alone is the OTHER source's view half the time: each counted the
 * other's unpaired rows as removed, then as added again, every alternation.
 * Each source measures against its own previous snapshot instead:
 * - Blizzard: the rows its last sync listed — those whose `blizzard_seen_at`
 *   (stamped only by the sync) equals the newest one — plus live rows it
 *   cannot see (LedgerLink-only GUID rows), which it may pair but never
 *   removes. A paired row an import keeps live after the sync dropped it is
 *   not re-counted. With no sync on record (slug reset): every live row.
 * - LedgerLink: the GUID rows its last import listed — those whose
 *   `ledgerlink_seen_at` (stamped only by imports) equals the newest one —
 *   plus live GUID-less rows, which it may adopt but never removes. A paired
 *   row the Blizzard sync keeps live after LedgerLink dropped it is not
 *   re-counted, and a departed member counts as removed once.
 */

const { guilds, guildMembers, guildEditors } = schema;

/** A roster row as the guard reads it. */
export interface LiveRosterRow {
  id: number;
  /** In-game GUID; null for Blizzard-only rows. */
  guid: string | null;
  blizzardId: number | null;
  name: string;
  grantId: number | null;
}

/** A stored row with the facts that decide which baseline holds it. */
export interface StoredRosterRow extends LiveRosterRow {
  live: boolean;
  lastSeenAt: Date | null;
  /** Stamped only by LedgerLink imports (ROK-2225). */
  ledgerlinkSeenAt: Date | null;
  /** Stamped only by the Blizzard roster sync (ROK-2225). */
  blizzardSeenAt: Date | null;
}

/** The guild's snapshot clocks. */
export interface RosterClock {
  lastSnapshotAt: Date | null;
  blizzardSyncedAt: Date | null;
}

/** Blizzard can see a row it matched by id, or one it inserted (no GUID). */
export const blizzardCanSee = (r: LiveRosterRow): boolean =>
  r.blizzardId !== null || r.guid === null;

/** LedgerLink can see a row only by its GUID. */
export const ledgerLinkCanSee = (r: LiveRosterRow): boolean => r.guid !== null;

const seenSince = (seen: Date | null, t: Date): boolean =>
  seen !== null && seen.getTime() >= t.getTime();

/** The newest stamp of `key` across the rows, or null when none has one. */
function newest(
  rows: readonly StoredRosterRow[],
  key: 'ledgerlinkSeenAt' | 'blizzardSeenAt',
): Date | null {
  const times = rows.flatMap((r) => {
    const t = r[key];
    return t === null ? [] : [t.getTime()];
  });
  return times.length === 0 ? null : new Date(Math.max(...times));
}

/**
 * The instant of the guild's latest LedgerLink import: the newest
 * `ledgerlink_seen_at` (every row an import lists gets the same stamp).
 * Null when no import ever listed a member.
 */
export function previousImportAt(
  rows: readonly StoredRosterRow[],
): Date | null {
  return newest(rows, 'ledgerlinkSeenAt');
}

/**
 * The instant of the guild's latest Blizzard sync: the newest
 * `blizzard_seen_at` (every row a sync lists gets the same stamp).
 * Null when no sync ever listed a member.
 */
export function previousSyncAt(rows: readonly StoredRosterRow[]): Date | null {
  return newest(rows, 'blizzardSeenAt');
}

/** By id: the rows the last sync listed, plus live rows it cannot see. */
function blizzardBaseline(
  rows: readonly StoredRosterRow[],
  clock: RosterClock,
): StoredRosterRow[] {
  if (clock.blizzardSyncedAt === null) return rows.filter((r) => r.live);
  const t = previousSyncAt(rows);
  return rows.filter(
    (r) =>
      (r.live && !blizzardCanSee(r)) ||
      (t !== null && seenSince(r.blizzardSeenAt, t)),
  );
}

/**
 * Pure. The rows a source's previous snapshot held. By id: see
 * {@link blizzardBaseline}. By GUID: the GUID rows
 * the previous import listed, plus live GUID-less rows (adoption only).
 */
export function sourceBaseline(
  rows: readonly StoredRosterRow[],
  by: 'id' | 'guid',
  clock: RosterClock,
): StoredRosterRow[] {
  if (by === 'id') return blizzardBaseline(rows, clock);
  const t = previousImportAt(rows);
  return rows.filter((r) =>
    r.guid === null ? r.live : t !== null && seenSince(r.ledgerlinkSeenAt, t),
  );
}

/** `inLatestSnapshot()` in TS: seen at or after the guild's latest snapshot. */
const isLive = (seen: Date | null, clock: RosterClock): boolean =>
  clock.lastSnapshotAt === null ||
  (seen !== null && seen.getTime() >= clock.lastSnapshotAt.getTime());

/** Every stored row of a guild plus its snapshot clocks. */
async function storedRoster(tx: AddonImportTx, guildId: number) {
  return tx
    .select({
      id: guildMembers.id,
      guid: guildMembers.guid,
      blizzardId: guildMembers.blizzardCharacterId,
      name: guildMembers.characterName,
      grantId: guildEditors.id,
      lastSeenAt: guildMembers.lastSeenAt,
      ledgerlinkSeenAt: guildMembers.ledgerlinkSeenAt,
      blizzardSeenAt: guildMembers.blizzardSeenAt,
      lastSnapshotAt: guilds.lastSnapshotAt,
      blizzardSyncedAt: guilds.blizzardRosterSyncedAt,
    })
    .from(guildMembers)
    .innerJoin(guilds, eq(guilds.id, guildMembers.guildId))
    .leftJoin(guildEditors, eq(guildEditors.guildMemberId, guildMembers.id))
    .where(eq(guildMembers.guildId, guildId));
}

/** A source's baseline plus every GUID the guild stores (live or not). */
export interface SourceBaseline {
  rows: LiveRosterRow[];
  storedGuids: Set<string>;
}

const toLive = ({ id, guid, blizzardId, name, grantId }: LiveRosterRow) => ({
  id,
  guid,
  blizzardId,
  name,
  grantId,
});

/** The baseline a source's snapshot of this guild is measured against. */
export async function loadBaseline(
  tx: AddonImportTx,
  guildId: number,
  by: 'id' | 'guid',
): Promise<SourceBaseline> {
  const rows = await storedRoster(tx, guildId);
  const storedGuids = new Set(rows.flatMap((r) => r.guid ?? []));
  const first = rows[0];
  if (first === undefined) return { rows: [], storedGuids };
  const clock = {
    lastSnapshotAt: first.lastSnapshotAt,
    blizzardSyncedAt: first.blizzardSyncedAt,
  };
  const stored = rows.map((r) => ({ ...r, live: isLive(r.lastSeenAt, clock) }));
  return {
    rows: sourceBaseline(stored, by, clock).map(toLive),
    storedGuids,
  };
}
