/**
 * ROK-1941 SQL B: a console death merges into the nearest `discord` death
 * inferred from a death post (same server, name case-insensitive, within
 * the D7 window) or is inserted once per `(server, character, loggedAt)`.
 * Runs under `withDeathNameLock`; ONE statement that cannot violate
 * `valheim_player_deaths_log_uq` (the merge is skipped when the log row
 * exists, and the lock stops a concurrent writer creating it).
 */
import { sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';
import type { LogDeathInput } from './valheim-deaths.repository';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Merge-or-insert a log death; true only when a NEW row was inserted (a
 * merge is a death already counted, a replay is a no-op).
 */
export async function mergeOrInsertLogDeath(
  tx: Db,
  pelicanServerId: number,
  death: LogDeathInput,
  windowSec: number,
): Promise<boolean> {
  const rows = await tx.execute(mergeSql(pelicanServerId, death, windowSec));
  return rows.length > 0;
}

/** SQL B's `existing`: the exact log row (replay) — blocks the merge. */
function existingLogSql(s: SQL, death: LogDeathInput): SQL {
  return sql`
  SELECT 1 FROM valheim_player_deaths e
  WHERE e.source = 'log' AND e.pelican_server_id = ${s}
    AND e.character_name = ${death.characterName} AND e.logged_at = ${death.loggedAt}`;
}

/** SQL B's single statement (spec "Correlation SQL" B). */
function mergeSql(
  pelicanServerId: number,
  death: LogDeathInput,
  windowSec: number,
): SQL {
  const s = sql`${pelicanServerId}::int`;
  const o = sql`${death.occurredAt.toISOString()}::timestamptz`;
  return sql`
WITH existing AS (${existingLogSql(s, death)}),
cand AS (
  SELECT d.id FROM valheim_player_deaths d
  WHERE d.pelican_server_id = ${s} AND d.source = 'discord'
    AND lower(d.character_name) = lower(${death.characterName})
    AND d.occurred_at BETWEEN ${o} - make_interval(secs => ${windowSec}::int)
                          AND ${o} + make_interval(secs => ${windowSec}::int)
    AND NOT EXISTS (SELECT 1 FROM existing)
  ORDER BY abs(extract(epoch FROM d.occurred_at - ${o})), d.id LIMIT 1 FOR UPDATE),
merged AS (
  UPDATE valheim_player_deaths d
  SET source = 'log', character_name = ${death.characterName}, logged_at = ${death.loggedAt},
      occurred_at = ${o}, steam_id = coalesce(d.steam_id, ${death.steamId}::text)
  FROM cand WHERE d.id = cand.id RETURNING d.id)
INSERT INTO valheim_player_deaths
  (pelican_server_id, character_name, steam_id, source, logged_at, occurred_at)
SELECT ${s}, ${death.characterName}, ${death.steamId}::text, 'log', ${death.loggedAt}, ${o}
WHERE NOT EXISTS (SELECT 1 FROM merged)
ON CONFLICT (pelican_server_id, character_name, logged_at) WHERE source = 'log' DO NOTHING
RETURNING id`;
}
