/**
 * ROK-1931 SQL R: a death the mod reported (`character.deaths[]`) merges
 * into the nearest same-character death with no position (`log` or
 * `discord`, `reported_at IS NULL`) within the window, filling its
 * position + character key, or is inserted once as `source = 'mod'`.
 * Runs under `withDeathNameLock`; ONE statement per entry that cannot
 * violate `valheim_player_deaths_reported_uq` (`existing` blocks the merge
 * on a replay; the insert's ON CONFLICT covers the rest). Every column is
 * written out qualified by hand — no drizzle column interpolation.
 */
import { sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { ValheimDeathRecord } from '@raid-ledger/contract';
import * as schema from '../../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** The character a reported death belongs to (from the upserted profile). */
export interface ReportedDeathOwner {
  pelicanServerId: number;
  steamId: string;
  playerId: string;
  /** Profile name — the log/discord rows' `character_name` match key. */
  name: string;
}

/**
 * Merge-or-insert one reported death; true only when a NEW row was
 * inserted (a merge is a death already counted, a replay is a no-op).
 */
export async function mergeOrInsertReportedDeath(
  tx: Db,
  owner: ReportedDeathOwner,
  death: ValheimDeathRecord,
  windowSec: number,
): Promise<boolean> {
  const rows = await tx.execute(reportedDeathSql(owner, death, windowSec));
  return rows.length > 0;
}

/** SQL R's `existing`: this character's row for this exact `at` (replay). */
function existingReportedSql(o: Bound): SQL {
  return sql`
  SELECT 1 FROM valheim_player_deaths e
  WHERE e.pelican_server_id = ${o.s} AND e.steam_id = ${o.steam}
    AND e.player_id = ${o.pid} AND e.reported_at = ${o.at}`;
}

/** SQL R's `cand`: the nearest unpositioned same-character death in the window. */
function candidateSql(o: Bound, name: string, windowSec: number): SQL {
  const w = sql`make_interval(secs => ${windowSec}::int)`;
  return sql`
  SELECT d.id FROM valheim_player_deaths d
  WHERE d.pelican_server_id = ${o.s} AND d.source IN ('log', 'discord')
    AND d.reported_at IS NULL
    AND (d.steam_id = ${o.steam}
         OR (d.steam_id IS NULL AND lower(d.character_name) = lower(${name}::text)))
    AND d.occurred_at BETWEEN ${o.at} - ${w} AND ${o.at} + ${w}
    AND NOT EXISTS (SELECT 1 FROM existing)
  ORDER BY abs(extract(epoch FROM d.occurred_at - ${o.at})), d.id LIMIT 1 FOR UPDATE`;
}

/** The bound, cast parameters every CTE shares. */
interface Bound {
  s: SQL;
  steam: SQL;
  pid: SQL;
  at: SQL;
}

/** SQL R's single statement (spec §5 "SQL R"); exported for the unit spec. */
export function reportedDeathSql(
  owner: ReportedDeathOwner,
  death: ValheimDeathRecord,
  windowSec: number,
): SQL {
  const o: Bound = {
    s: sql`${owner.pelicanServerId}::int`,
    steam: sql`${owner.steamId}::text`,
    pid: sql`${owner.playerId}::text`,
    at: sql`${death.at}::timestamptz`,
  };
  const w = sql`${death.worldUid}::text`;
  const x = sql`${death.x}::double precision`;
  const z = sql`${death.z}::double precision`;
  return sql`
WITH existing AS (${existingReportedSql(o)}),
cand AS (${candidateSql(o, owner.name, windowSec)}),
merged AS (
  UPDATE valheim_player_deaths d
  SET x = ${x}, z = ${z}, world_uid = ${w}, player_id = ${o.pid},
      reported_at = ${o.at}, steam_id = coalesce(d.steam_id, ${o.steam})
  FROM cand WHERE d.id = cand.id RETURNING d.id)
INSERT INTO valheim_player_deaths
  (pelican_server_id, character_name, steam_id, player_id, world_uid, source,
   occurred_at, reported_at, x, z)
SELECT ${o.s}, ${owner.name}::text, ${o.steam}, ${o.pid}, ${w}, 'mod',
       ${o.at}, ${o.at}, ${x}, ${z}
WHERE NOT EXISTS (SELECT 1 FROM merged) AND NOT EXISTS (SELECT 1 FROM existing)
ON CONFLICT (pelican_server_id, steam_id, player_id, reported_at)
  WHERE reported_at IS NOT NULL DO NOTHING
RETURNING id`;
}
