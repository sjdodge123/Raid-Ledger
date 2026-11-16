import { eq } from 'drizzle-orm';
import * as schema from '../../../drizzle/schema';
import type { AddonImportTx } from './addon-import-apply.types';

/**
 * ROK-2225 — the rows a roster source measures churn against. The Blizzard
 * sync and LedgerLink imports both replace the guild's latest snapshot, so
 * "live" alone is the OTHER source's view half the time: each counted the
 * other's unpaired rows as removed, then as added again, every alternation.
 * A source's baseline is the live roster PLUS the rows its own previous
 * snapshot held that the other source has since demoted. No per-source
 * column is needed: `guilds.blizzard_roster_synced_at` dates the last sync,
 * and a GUID row without a Blizzard id is only ever stamped by an import.
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

const seenSince = (r: StoredRosterRow, t: Date): boolean =>
  r.lastSeenAt !== null && r.lastSeenAt.getTime() >= t.getTime();

/** GUID rows Blizzard cannot pair: only an import ever stamps them. */
const importOnly = (r: StoredRosterRow): boolean =>
  r.guid !== null && r.blizzardId === null;

/**
 * When the latest snapshot is a Blizzard sync, the instant of the import
 * before it: the newest import-only row older than the sync. Null when the
 * latest snapshot is an import's own (live already is its view).
 */
export function previousImportAt(
  rows: readonly StoredRosterRow[],
  clock: RosterClock,
): Date | null {
  const synced = clock.blizzardSyncedAt;
  const latest = clock.lastSnapshotAt;
  if (synced === null || latest === null || latest > synced) return null;
  const times = rows
    .filter(importOnly)
    .flatMap((r) => (r.lastSeenAt === null ? [] : [r.lastSeenAt.getTime()]))
    .filter((ms) => ms < synced.getTime());
  return times.length === 0 ? null : new Date(Math.max(...times));
}

/**
 * Pure. The rows a source's previous snapshot held: every live row, plus
 * (by id) the rows the previous Blizzard sync stamped, or (by GUID) the
 * import-only rows the previous import listed.
 */
export function sourceBaseline(
  rows: readonly StoredRosterRow[],
  by: 'id' | 'guid',
  clock: RosterClock,
): StoredRosterRow[] {
  if (by === 'id') {
    const t = clock.blizzardSyncedAt;
    return rows.filter(
      (r) => r.live || (t !== null && blizzardCanSee(r) && seenSince(r, t)),
    );
  }
  const t = previousImportAt(rows, clock);
  return rows.filter(
    (r) => r.live || (t !== null && importOnly(r) && seenSince(r, t)),
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
      lastSnapshotAt: guilds.lastSnapshotAt,
      blizzardSyncedAt: guilds.blizzardRosterSyncedAt,
    })
    .from(guildMembers)
    .innerJoin(guilds, eq(guilds.id, guildMembers.guildId))
    .leftJoin(guildEditors, eq(guildEditors.guildMemberId, guildMembers.id))
    .where(eq(guildMembers.guildId, guildId));
}

/** The baseline a source's snapshot of this guild is measured against. */
export async function loadBaseline(
  tx: AddonImportTx,
  guildId: number,
  by: 'id' | 'guid',
): Promise<LiveRosterRow[]> {
  const rows = await storedRoster(tx, guildId);
  const first = rows[0];
  if (first === undefined) return [];
  const clock = {
    lastSnapshotAt: first.lastSnapshotAt,
    blizzardSyncedAt: first.blizzardSyncedAt,
  };
  const stored = rows.map((r) => ({ ...r, live: isLive(r.lastSeenAt, clock) }));
  return sourceBaseline(stored, by, clock).map(
    ({ id, guid, blizzardId, name, grantId }) => ({
      id,
      guid,
      blizzardId,
      name,
      grantId,
    }),
  );
}
