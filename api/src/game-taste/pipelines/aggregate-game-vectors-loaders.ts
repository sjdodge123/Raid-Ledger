import { sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { CorpusStats, GameSignals } from '../game-vector.helpers';
import { hashList } from '../signal-hash.helpers';

type Db = PostgresJsDatabase<typeof schema>;

type PlaytimeRow = {
  game_id: number;
  total: string;
  last_period: string | null;
};
type InterestRow = { game_id: number; count: string };

/**
 * Per-game aggregated signals: rolling 4-week playtime sum +
 * all-time interest count. Skipping a game here is equivalent to
 * zero signals — the pipeline still emits a stub row.
 *
 * Matches the ROK-1082 plan §Risks line 336 — `period = 'week'`
 * with a 4-week lookback; interests are never windowed.
 */
export async function loadGameSignals(
  db: Db,
): Promise<Map<number, GameSignals>> {
  return querySignals(db);
}

/**
 * Narrow per-game variant of {@link loadGameSignals} (ROK-1102 #2).
 *
 * Same two aggregates, scoped with `game_id IN (...)`. Used by the
 * event-driven recompute path so the target game's signals are always
 * read fresh even when the corpus batch is served from the 60s cache.
 */
export async function loadGameSignalsForIds(
  db: Db,
  gameIds: number[],
): Promise<Map<number, GameSignals>> {
  if (gameIds.length === 0) return new Map();
  const ids = sql.join(
    gameIds.map((id) => sql`${id}`),
    sql`, `,
  );
  return querySignals(
    db,
    sql`AND game_id IN (${ids})`,
    sql`WHERE game_id IN (${ids})`,
  );
}

function fetchPlaytimeRows(db: Db, filter?: SQL): Promise<PlaytimeRow[]> {
  return db.execute(sql`
    SELECT
      game_id,
      COALESCE(SUM(total_seconds), 0)::text AS total,
      MAX(period_start::text) AS last_period
    FROM ${schema.gameActivityRollups}
    WHERE period = 'week'
      AND period_start >= (NOW() - INTERVAL '4 weeks')::date
      ${filter ?? sql``}
    GROUP BY game_id
  `) as unknown as Promise<PlaytimeRow[]>;
}

function fetchInterestRows(db: Db, filter?: SQL): Promise<InterestRow[]> {
  return db.execute(sql`
    SELECT game_id, COUNT(*)::text AS count
    FROM ${schema.gameInterests}
    ${filter ?? sql``}
    GROUP BY game_id
  `) as unknown as Promise<InterestRow[]>;
}

async function querySignals(
  db: Db,
  playtimeFilter?: SQL,
  interestFilter?: SQL,
): Promise<Map<number, GameSignals>> {
  const [playtime, interests] = await Promise.all([
    fetchPlaytimeRows(db, playtimeFilter),
    fetchInterestRows(db, interestFilter),
  ]);
  return foldSignalRows(playtime, interests);
}

function foldSignalRows(
  playtime: PlaytimeRow[],
  interests: InterestRow[],
): Map<number, GameSignals> {
  const map = new Map<number, GameSignals>();
  const touch = (gameId: number): GameSignals => {
    const existing = map.get(gameId);
    if (existing) return existing;
    const fresh: GameSignals = {
      gameId,
      playtimeSeconds: 0,
      interestCount: 0,
      lastPeriodStart: null,
    };
    map.set(gameId, fresh);
    return fresh;
  };

  for (const row of playtime) {
    const entry = touch(Number(row.game_id));
    entry.playtimeSeconds = Number(row.total);
    entry.lastPeriodStart = row.last_period ? new Date(row.last_period) : null;
  }
  for (const row of interests) {
    touch(Number(row.game_id)).interestCount = Number(row.count);
  }
  return map;
}

/**
 * Library-wide maxima used to normalize per-game play signal into
 * a comparable 0..1 range. Computed once per pipeline run.
 */
export function computeCorpusStats(
  signals: Map<number, GameSignals>,
): CorpusStats {
  let maxPlaytimeSeconds = 0;
  let maxInterestCount = 0;
  for (const s of signals.values()) {
    if (s.playtimeSeconds > maxPlaytimeSeconds)
      maxPlaytimeSeconds = s.playtimeSeconds;
    if (s.interestCount > maxInterestCount) maxInterestCount = s.interestCount;
  }
  return { maxPlaytimeSeconds, maxInterestCount };
}

/**
 * Load existing `(game_id → signal_hash)` so the aggregate loop can
 * skip recomputing unchanged games.
 */
export async function loadExistingVectorHashes(
  db: Db,
): Promise<Map<number, string>> {
  const rows = await db
    .select({
      gameId: schema.gameTasteVectors.gameId,
      signalHash: schema.gameTasteVectors.signalHash,
    })
    .from(schema.gameTasteVectors);
  const map = new Map<number, string>();
  for (const r of rows) map.set(r.gameId, r.signalHash);
  return map;
}

/**
 * Helper exposed for the aggregate loop: hash a game's metadata
 * slice so upstream pipeline code can build a `GameSignalSummary`
 * without duplicating the sort-then-sha logic.
 */
export function hashMetadataArrays(metadata: {
  tags: string[];
  genres: number[];
  gameModes: number[];
  themes: number[];
}): {
  tagsHash: string;
  genresHash: string;
  modesHash: string;
  themesHash: string;
} {
  return {
    tagsHash: hashList(metadata.tags),
    genresHash: hashList(metadata.genres),
    modesHash: hashList(metadata.gameModes),
    themesHash: hashList(metadata.themes),
  };
}
