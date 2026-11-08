/**
 * Unique-key collision guard for the IGDB upsert paths (ROK-2120).
 *
 * A merge target picked by steamAppId / normalized name can be the ITAD copy
 * of a title whose IGDB-first twin already holds the incoming igdb_id, slug or
 * steam_app_id. Writing it would violate a unique constraint and — because a
 * refresh batch is one transaction (ROK-1438) — roll back every other row in
 * the batch. So the owners of every incoming key are read up front and each
 * write is classified before it is issued; a colliding one is never issued.
 */
import { inArray, or, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { mapApiGameToDbRow } from './igdb.mappers';
import { reportDuplicatePair } from './games-key-owner.helpers';
import { SEED_OWNED_GAME_SLUGS } from '../games-lookup/seed-owned-games.helpers';

type GameRow = ReturnType<typeof mapApiGameToDbRow>;

/** Current holder (games.id) of each incoming unique key. */
export interface KeyOwners {
  igdb: Map<number, number>;
  slug: Map<string, number>;
  steam: Map<number, number>;
}

interface OwnedKeys {
  igdbId: number | null;
  slug: string | null;
  steamAppId: number | null;
}

/** Drop every claim `id` holds in `map` (a row has ONE value per column). */
function releaseHeld<K>(map: Map<K, number>, id: number): void {
  for (const [key, owner] of map) if (owner === id) map.delete(key);
}

/** True when `id` is known to hold a seed-owned slug (writes keep it). */
function holdsSeedSlug(owners: KeyOwners, id: number): boolean {
  for (const [slug, owner] of owners.slug) {
    if (owner === id && SEED_OWNED_GAME_SLUGS.includes(slug)) return true;
  }
  return false;
}

/**
 * Record `id` as the holder of every non-null key in `keys` — the values a
 * write just put on that row. A key the write REPLACED is released (r3: a
 * merge that moves row A from slug `old` to `new` frees `old` for a new row
 * in the same batch). Mirrors the SET clauses: a null steam id keeps the
 * stored one (COALESCE), and a seed-owned slug is never overwritten.
 */
export function recordOwner(owners: KeyOwners, id: number, keys: OwnedKeys) {
  if (keys.igdbId != null) {
    releaseHeld(owners.igdb, id);
    owners.igdb.set(keys.igdbId, id);
  }
  if (keys.slug != null && !holdsSeedSlug(owners, id)) {
    releaseHeld(owners.slug, id);
    owners.slug.set(keys.slug, id);
  }
  if (keys.steamAppId != null) {
    releaseHeld(owners.steam, id);
    owners.steam.set(keys.steamAppId, id);
  }
}

/** OR-able conditions matching any row holding an incoming key. */
function keyOwnerConds(rows: GameRow[]): SQL[] {
  const steamIds = rows.flatMap((r) =>
    r.steamAppId == null ? [] : [r.steamAppId],
  );
  const conds: SQL[] = [
    inArray(
      schema.games.igdbId,
      rows.map((r) => r.igdbId),
    ),
    inArray(
      schema.games.slug,
      rows.map((r) => r.slug),
    ),
  ];
  if (steamIds.length > 0)
    conds.push(inArray(schema.games.steamAppId, steamIds));
  return conds;
}

/** ONE SELECT for the rows holding any incoming igdb_id, slug or steam id. */
export async function loadKeyOwners(
  db: PostgresJsDatabase<typeof schema>,
  rows: GameRow[],
): Promise<KeyOwners> {
  const owners: KeyOwners = {
    igdb: new Map(),
    slug: new Map(),
    steam: new Map(),
  };
  if (rows.length === 0) return owners;
  const found = await db
    .select({
      id: schema.games.id,
      igdbId: schema.games.igdbId,
      slug: schema.games.slug,
      steamAppId: schema.games.steamAppId,
    })
    .from(schema.games)
    .where(or(...keyOwnerConds(rows)));
  for (const f of found) recordOwner(owners, f.id, f);
  return owners;
}

/** What to do with a planned merge of `row` into an existing row. */
export type MergeVerdict = 'merge' | 'reroute' | 'skip';

/** First key `row` would write that a row other than `targetId` holds. */
function contestedKey(
  targetId: number,
  row: GameRow,
  owners: KeyOwners,
): { key: 'igdb_id' | 'slug' | 'steam_app_id'; owner: number } | null {
  const checks: Array<
    ['igdb_id' | 'slug' | 'steam_app_id', number | undefined]
  > = [
    ['igdb_id', owners.igdb.get(row.igdbId)],
    ['slug', owners.slug.get(row.slug)],
    [
      'steam_app_id',
      row.steamAppId == null ? undefined : owners.steam.get(row.steamAppId),
    ],
  ];
  for (const [key, owner] of checks) {
    if (owner != null && owner !== targetId) return { key, owner };
  }
  return null;
}

/**
 * Classify a merge and report any skipped duplicate pair. `reroute` = another
 * row owns the igdb_id, so the row goes to the ON CONFLICT (igdb_id) insert
 * and refreshes that owner instead; `skip` = a slug/steam id clash, no write.
 */
export function classifyMerge(
  targetId: number,
  row: GameRow,
  owners: KeyOwners,
): MergeVerdict {
  const clash = contestedKey(targetId, row, owners);
  if (clash == null) return 'merge';
  reportDuplicatePair(clash.owner, targetId, clash.key);
  return clash.key === 'igdb_id' ? 'reroute' : 'skip';
}

/**
 * Guard one insert row: `null` = drop it (slug clash), otherwise the row to
 * insert (steam id stripped on a steam clash). `landing` = the existing igdb
 * owner it will upsert onto, or a negative placeholder for a fresh insert.
 */
function guardOne(row: GameRow, owners: KeyOwners): GameRow | null {
  const existing = owners.igdb.get(row.igdbId);
  const landing = existing ?? -row.igdbId;
  const dup = existing ?? `igdb:${row.igdbId}`;
  const slugOwner = owners.slug.get(row.slug);
  if (slugOwner != null && slugOwner !== landing) {
    reportDuplicatePair(slugOwner, dup, 'slug');
    return null;
  }
  const steamOwner =
    row.steamAppId == null ? undefined : owners.steam.get(row.steamAppId);
  if (steamOwner == null || steamOwner === landing) return row;
  reportDuplicatePair(steamOwner, dup, 'steam_app_id');
  return { ...row, steamAppId: null, steamAppIdSource: null };
}

/**
 * Drop insert rows whose slug a row other than their igdb_id owner holds, and
 * strip a steam id held elsewhere, so the batch INSERT ... ON CONFLICT
 * (igdb_id) cannot violate games_slug_unique / games_steam_app_id_unique.
 * Each kept row's keys are recorded (a fresh insert under the placeholder id
 * `-igdbId`), so two rows in ONE batch can't claim the same slug / steam id.
 */
export function guardInsertRows(rows: GameRow[], owners: KeyOwners): GameRow[] {
  const kept: GameRow[] = [];
  for (const row of rows) {
    const guarded = guardOne(row, owners);
    if (guarded == null) continue;
    const landing = owners.igdb.get(row.igdbId) ?? -row.igdbId;
    recordOwner(owners, landing, guarded);
    kept.push(guarded);
  }
  return kept;
}
