import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import {
  deathPostWindowSec,
  withDeathNameLock,
} from './valheim-death-name-lock';

type Db = PostgresJsDatabase<typeof schema>;

/** A death post's first stored picture, ready to correlate (SQL A). */
export interface DeathPostInput {
  pelicanServerId: number;
  /** Parsed from the post — free game text, never logged. */
  characterName: string;
  /** The Discord message time (snowflake, UTC). */
  postedAt: Date;
  hubMediaId: number;
  /** D15 tie-breaker: capture filename `mm*60+ss`, or null. */
  captureSecondOfHour: number | null;
}

/**
 * `linked` an existing death, `inferred` a new `discord` one, or `already`
 * linked (also: the message's death moved here from a sibling picture).
 */
export type DeathLinkOutcome = 'linked' | 'inferred' | 'already';

/** `gone`: the picture is a tombstone (or missing), so nothing links to it. */
export type DeathLinkResult =
  | {
      outcome: DeathLinkOutcome;
      deathId: number;
      /** Seconds from the post to the linked death (`linked` only). */
      deltaSec: number | null;
    }
  | { outcome: 'gone'; deathId: null; deltaSec: null };

/** D7: how far around an inferred death a recorded one is a `window_miss`. */
const WINDOW_MISS_HORIZON_SEC = 6 * 3600;

interface LinkRow extends Record<string, unknown> {
  id: string | number;
  outcome: string;
  delta: string | number | null;
}

const OUTCOMES: readonly string[] = ['linked', 'inferred', 'already', 'moved'];
type SqlOutcome = DeathLinkOutcome | 'moved';
const isOutcome = (v: string): v is SqlOutcome => OUTCOMES.includes(v);

/** SQL A's `cand`: the nearest unlinked death in the window (D15 order). */
function candidateSql(p: DeathPostInput, t: SQL, windowSec: number): SQL {
  const ms = sql`${p.captureSecondOfHour}::int`;
  return sql`
  SELECT d.id, extract(epoch FROM d.occurred_at - ${t}) AS delta
  FROM valheim_player_deaths d
  WHERE d.pelican_server_id = ${p.pelicanServerId}::int
    AND lower(d.character_name) = lower(${p.characterName})
    AND d.occurred_at BETWEEN ${t} - make_interval(secs => ${windowSec}::int)
                          AND ${t} + make_interval(secs => ${windowSec}::int)
    AND d.hub_media_id IS NULL AND NOT EXISTS (SELECT 1 FROM already)
    AND NOT EXISTS (SELECT 1 FROM sibling) AND EXISTS (SELECT 1 FROM target)
  ORDER BY abs(extract(epoch FROM d.occurred_at - ${t})),
    CASE WHEN ${ms} IS NULL THEN 0
         ELSE abs(extract(epoch FROM d.occurred_at - date_trunc('hour', d.occurred_at)) - ${ms}) END,
    d.id
  LIMIT 1 FOR UPDATE`;
}

/**
 * Codex P2 (edit vs backfill): this name's death already linked to ANOTHER
 * picture of the same Discord message is the message's death (D6 links one
 * per post), so it moves here instead of SQL A inferring a second one.
 */
function siblingSql(p: DeathPostInput): SQL {
  return sql`
  SELECT d.id FROM valheim_player_deaths d
  JOIN hub_media s ON s.id = d.hub_media_id
  JOIN target ON s.guild_id = target.guild_id
             AND s.discord_message_id = target.discord_message_id
  WHERE d.pelican_server_id = ${p.pelicanServerId}::int
    AND lower(d.character_name) = lower(${p.characterName})
    AND s.id <> ${p.hubMediaId}::bigint AND NOT EXISTS (SELECT 1 FROM already)
  ORDER BY d.id LIMIT 1 FOR UPDATE OF d`;
}

/**
 * SQL A (D8/D9/D15): a live picture takes its message's death from a
 * sibling picture, else links the nearest unlinked death, else infers one.
 * A tombstoned picture (`target` empty) touches nothing and returns no row.
 */
function linkSql(p: DeathPostInput, windowSec: number): SQL {
  const t = sql`${p.postedAt.toISOString()}::timestamptz`;
  return sql`
WITH target AS (
  SELECT m.guild_id, m.discord_message_id FROM hub_media m
  WHERE m.id = ${p.hubMediaId}::bigint AND m.removed_at IS NULL),
already AS (
  SELECT d.id FROM valheim_player_deaths d WHERE d.hub_media_id = ${p.hubMediaId}::bigint),
sibling AS (${siblingSql(p)}),
moved AS (
  UPDATE valheim_player_deaths d SET hub_media_id = ${p.hubMediaId}::bigint
  FROM sibling WHERE d.id = sibling.id RETURNING d.id),
cand AS (${candidateSql(p, t, windowSec)}),
linked AS (
  UPDATE valheim_player_deaths d SET hub_media_id = ${p.hubMediaId}::bigint
  FROM cand WHERE d.id = cand.id RETURNING d.id, cand.delta),
inferred AS (
  INSERT INTO valheim_player_deaths
    (pelican_server_id, character_name, source, logged_at, occurred_at, hub_media_id)
  SELECT ${p.pelicanServerId}::int, ${p.characterName}, 'discord',
    to_char(${t} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS'), ${t}, ${p.hubMediaId}::bigint
  WHERE NOT EXISTS (SELECT 1 FROM linked) AND NOT EXISTS (SELECT 1 FROM already)
    AND NOT EXISTS (SELECT 1 FROM sibling) AND EXISTS (SELECT 1 FROM target)
  RETURNING id)
SELECT id, 'linked' AS outcome, delta::float8 AS delta FROM linked
UNION ALL SELECT id, 'inferred', NULL FROM inferred
UNION ALL SELECT id, 'already', NULL FROM already
UNION ALL SELECT id, 'moved', NULL FROM moved`;
}

/**
 * ROK-1941: correlates a Valheim death post with the recorded deaths.
 * Logs `delta_sec` on every link and a `window_miss` warning when an
 * inferred death has a recorded one for that name within ±6 h (D7).
 */
@Injectable()
export class ValheimDeathLinkRepository {
  private readonly logger = new Logger(ValheimDeathLinkRepository.name);

  constructor(@Inject(DrizzleAsyncProvider) private readonly db: Db) {}

  /**
   * SQL A under the D9 lock; idempotent per `hubMediaId`. Live ingest,
   * backfill and an edit's first-picture re-link all come through here, so
   * the one-statement move of a message's death serialises with them.
   */
  async linkOrInferDeath(input: DeathPostInput): Promise<DeathLinkResult> {
    const windowSec = deathPostWindowSec();
    const rows = await withDeathNameLock(
      this.db,
      input.pelicanServerId,
      input.characterName,
      (tx) => tx.execute<LinkRow>(linkSql(input, windowSec)),
    );
    const result = toResult(rows[0], input.hubMediaId, this.logger);
    if (result.outcome === 'linked')
      this.logger.log(
        `death post linked media=${input.hubMediaId} delta_sec=${result.deltaSec}`,
      );
    if (result.outcome === 'inferred') await this.warnWindowMiss(input);
    return result;
  }

  private async warnWindowMiss(input: DeathPostInput): Promise<void> {
    const t = sql`${input.postedAt.toISOString()}::timestamptz`;
    const rows = await this.db.execute<{ delta: string | number }>(sql`
      SELECT min(abs(extract(epoch FROM d.occurred_at - ${t})))::float8 AS delta
      FROM valheim_player_deaths d
      WHERE d.pelican_server_id = ${input.pelicanServerId}::int
        AND lower(d.character_name) = lower(${input.characterName})
        AND d.source <> 'discord'
        AND d.occurred_at BETWEEN ${t} - make_interval(secs => ${WINDOW_MISS_HORIZON_SEC}::int)
                              AND ${t} + make_interval(secs => ${WINDOW_MISS_HORIZON_SEC}::int)
      HAVING count(*) > 0`);
    const nearest = rows[0];
    if (nearest)
      this.logger.warn(
        `window_miss media=${input.hubMediaId} nearest_sec=${Number(nearest.delta)}`,
      );
  }
}

function toResult(
  row: LinkRow | undefined,
  mediaId: number,
  logger: Logger,
): DeathLinkResult {
  if (!row) return { outcome: 'gone', deathId: null, deltaSec: null };
  if (!isOutcome(row.outcome))
    throw new Error('death link statement returned no outcome');
  const deathId = Number(row.id);
  if (row.outcome === 'moved') {
    logger.log(`death post moved to media=${mediaId} death=${deathId}`);
    return { outcome: 'already', deathId, deltaSec: null };
  }
  const delta = row.delta === null ? null : Number(row.delta);
  return { outcome: row.outcome, deathId, deltaSec: delta };
}
