-- ROK-1278: merge duplicate `games` rows (per `games_dedup_audit`) and add a
-- partial UNIQUE constraint on `games.steam_app_id` to prevent the Slay-2/II
-- class of dup from re-appearing.
--
-- Reads dup groups from `games_dedup_audit` (populated by ROK-1277's union-find).
-- For each (canonical_game_id, dup_game_ids) group:
--   1. Pre-merge UNIQUE-constraint collisions across the 9 affected tables
--      (additive merge for game_activity_rollups; canonical-wins delete elsewhere).
--   2. Repoint every FK from any dup id to the canonical id (23 columns across
--      19 tables, mixed CASCADE / SET NULL / NO ACTION).
--   3. Delete the dup `games` rows.
-- Then add the partial UNIQUE INDEX on games.steam_app_id WHERE steam_app_id IS NOT NULL.
-- Finally truncate games_dedup_audit (its rows are now stale; canonical+dup_ids
-- they point at have been collapsed). Audit can be re-run any time.
--
-- Idempotency: the migration runs once per drizzle journal. If somehow re-run
-- against a state where games_dedup_audit is empty, the UPDATEs/DELETEs are
-- no-ops and the CREATE UNIQUE INDEX uses IF NOT EXISTS.

-- ─── 1. Pre-merge UNIQUE collisions ─────────────────────────────────────────

-- 1a. game_activity_rollups: ADDITIVE merge total_seconds when (user_id, period,
-- period_start) collides between canonical and a dup. The dup row's seconds are
-- added to the canonical's, then the dup row is deleted so the later FK repoint
-- has no conflict. game_activity_rollups has a composite key (no `id` column),
-- so we match on (user_id, game_id, period, period_start).
WITH grp AS (
  SELECT canonical_game_id AS cid, unnest(dup_game_ids) AS did
  FROM games_dedup_audit
),
add_seconds AS (
  SELECT
    g.cid AS canon_game_id,
    r_canon.user_id, r_canon.period, r_canon.period_start,
    sum(r_dup.total_seconds) AS extra
  FROM game_activity_rollups r_dup
  JOIN grp g ON r_dup.game_id = g.did
  JOIN game_activity_rollups r_canon
    ON r_canon.game_id = g.cid
   AND r_canon.user_id = r_dup.user_id
   AND r_canon.period = r_dup.period
   AND r_canon.period_start = r_dup.period_start
  GROUP BY g.cid, r_canon.user_id, r_canon.period, r_canon.period_start
)
UPDATE game_activity_rollups r
SET total_seconds = r.total_seconds + s.extra
FROM add_seconds s
WHERE r.game_id = s.canon_game_id
  AND r.user_id = s.user_id
  AND r.period = s.period
  AND r.period_start = s.period_start;

WITH grp AS (
  SELECT canonical_game_id AS cid, unnest(dup_game_ids) AS did
  FROM games_dedup_audit
)
DELETE FROM game_activity_rollups r_dup
USING grp g, game_activity_rollups r_canon
WHERE r_dup.game_id = g.did
  AND r_canon.game_id = g.cid
  AND r_canon.user_id = r_dup.user_id
  AND r_canon.period = r_dup.period
  AND r_canon.period_start = r_dup.period_start;

-- 1b. characters: UNIQUE(user_id, game_id, name, realm). Canonical wins.
WITH grp AS (
  SELECT canonical_game_id AS cid, unnest(dup_game_ids) AS did
  FROM games_dedup_audit
)
DELETE FROM characters d
USING grp g, characters c
WHERE d.game_id = g.did
  AND c.game_id = g.cid
  AND c.user_id = d.user_id
  AND c.name = d.name
  AND c.realm IS NOT DISTINCT FROM d.realm;

-- 1c. community_lineup_entries: UNIQUE(lineup_id, game_id). Canonical wins.
WITH grp AS (
  SELECT canonical_game_id AS cid, unnest(dup_game_ids) AS did
  FROM games_dedup_audit
)
DELETE FROM community_lineup_entries d
USING grp g, community_lineup_entries c
WHERE d.game_id = g.did
  AND c.game_id = g.cid
  AND c.lineup_id = d.lineup_id;

-- 1d. community_lineup_matches: UNIQUE(lineup_id, game_id). Canonical wins.
-- NOTE: community_lineup_match_members FKs to community_lineup_matches.id with
-- ON DELETE CASCADE, so deleting a dup-side match row will also drop its members
-- automatically. The audit's `lineupMatchMembers` counts will go to zero for the
-- dup match's members; this is intentional — the canonical match keeps its own
-- members.
WITH grp AS (
  SELECT canonical_game_id AS cid, unnest(dup_game_ids) AS did
  FROM games_dedup_audit
)
DELETE FROM community_lineup_matches d
USING grp g, community_lineup_matches c
WHERE d.game_id = g.did
  AND c.game_id = g.cid
  AND c.lineup_id = d.lineup_id;

-- 1e. community_lineup_votes: UNIQUE(lineup_id, user_id, game_id). Canonical wins.
WITH grp AS (
  SELECT canonical_game_id AS cid, unnest(dup_game_ids) AS did
  FROM games_dedup_audit
)
DELETE FROM community_lineup_votes d
USING grp g, community_lineup_votes c
WHERE d.game_id = g.did
  AND c.game_id = g.cid
  AND c.lineup_id = d.lineup_id
  AND c.user_id = d.user_id;

-- 1f. event_types: UNIQUE(game_id, slug). Canonical wins.
WITH grp AS (
  SELECT canonical_game_id AS cid, unnest(dup_game_ids) AS did
  FROM games_dedup_audit
)
DELETE FROM event_types d
USING grp g, event_types c
WHERE d.game_id = g.did
  AND c.game_id = g.cid
  AND c.slug = d.slug;

-- 1g. game_interests: UNIQUE(user_id, game_id, source). Canonical wins.
WITH grp AS (
  SELECT canonical_game_id AS cid, unnest(dup_game_ids) AS did
  FROM games_dedup_audit
)
DELETE FROM game_interests d
USING grp g, game_interests c
WHERE d.game_id = g.did
  AND c.game_id = g.cid
  AND c.user_id = d.user_id
  AND c.source = d.source;

-- 1h. game_interest_suppressions: UNIQUE(user_id, game_id). Canonical wins.
WITH grp AS (
  SELECT canonical_game_id AS cid, unnest(dup_game_ids) AS did
  FROM games_dedup_audit
)
DELETE FROM game_interest_suppressions d
USING grp g, game_interest_suppressions c
WHERE d.game_id = g.did
  AND c.game_id = g.cid
  AND c.user_id = d.user_id;

-- 1i. game_taste_vectors: UNIQUE(game_id). Canonical wins; its vector will
-- regenerate on the next vector-recompute cron from the merged activity.
WITH grp AS (
  SELECT canonical_game_id AS cid, unnest(dup_game_ids) AS did
  FROM games_dedup_audit
)
DELETE FROM game_taste_vectors d
USING grp g
WHERE d.game_id = g.did
  AND EXISTS (
    SELECT 1 FROM game_taste_vectors c WHERE c.game_id = g.cid
  );

-- ─── 2. Repoint all 23 FK columns to the canonical id ──────────────────────

UPDATE events SET game_id = a.canonical_game_id
FROM games_dedup_audit a WHERE events.game_id = ANY(a.dup_game_ids);

UPDATE event_plans SET game_id = a.canonical_game_id
FROM games_dedup_audit a WHERE event_plans.game_id = ANY(a.dup_game_ids);

UPDATE community_lineups SET decided_game_id = a.canonical_game_id
FROM games_dedup_audit a WHERE community_lineups.decided_game_id = ANY(a.dup_game_ids);

UPDATE community_lineup_entries SET game_id = a.canonical_game_id
FROM games_dedup_audit a WHERE community_lineup_entries.game_id = ANY(a.dup_game_ids);

UPDATE community_lineup_matches SET game_id = a.canonical_game_id
FROM games_dedup_audit a WHERE community_lineup_matches.game_id = ANY(a.dup_game_ids);

UPDATE community_lineup_tiebreakers SET winner_game_id = a.canonical_game_id
FROM games_dedup_audit a WHERE community_lineup_tiebreakers.winner_game_id = ANY(a.dup_game_ids);

UPDATE community_lineup_tiebreaker_bracket_matchups SET game_a_id = a.canonical_game_id
FROM games_dedup_audit a WHERE community_lineup_tiebreaker_bracket_matchups.game_a_id = ANY(a.dup_game_ids);

UPDATE community_lineup_tiebreaker_bracket_matchups SET game_b_id = a.canonical_game_id
FROM games_dedup_audit a WHERE community_lineup_tiebreaker_bracket_matchups.game_b_id = ANY(a.dup_game_ids);

UPDATE community_lineup_tiebreaker_bracket_matchups SET winner_game_id = a.canonical_game_id
FROM games_dedup_audit a WHERE community_lineup_tiebreaker_bracket_matchups.winner_game_id = ANY(a.dup_game_ids);

UPDATE community_lineup_tiebreaker_bracket_votes SET game_id = a.canonical_game_id
FROM games_dedup_audit a WHERE community_lineup_tiebreaker_bracket_votes.game_id = ANY(a.dup_game_ids);

UPDATE community_lineup_tiebreaker_vetoes SET game_id = a.canonical_game_id
FROM games_dedup_audit a WHERE community_lineup_tiebreaker_vetoes.game_id = ANY(a.dup_game_ids);

UPDATE community_lineup_votes SET game_id = a.canonical_game_id
FROM games_dedup_audit a WHERE community_lineup_votes.game_id = ANY(a.dup_game_ids);

UPDATE characters SET game_id = a.canonical_game_id
FROM games_dedup_audit a WHERE characters.game_id = ANY(a.dup_game_ids);

UPDATE game_taste_vectors SET game_id = a.canonical_game_id
FROM games_dedup_audit a WHERE game_taste_vectors.game_id = ANY(a.dup_game_ids);

UPDATE game_interests SET game_id = a.canonical_game_id
FROM games_dedup_audit a WHERE game_interests.game_id = ANY(a.dup_game_ids);

UPDATE game_activity_rollups SET game_id = a.canonical_game_id
FROM games_dedup_audit a WHERE game_activity_rollups.game_id = ANY(a.dup_game_ids);

UPDATE game_activity_sessions SET game_id = a.canonical_game_id
FROM games_dedup_audit a WHERE game_activity_sessions.game_id = ANY(a.dup_game_ids);

UPDATE availability SET game_id = a.canonical_game_id
FROM games_dedup_audit a WHERE availability.game_id = ANY(a.dup_game_ids);

UPDATE channel_bindings SET game_id = a.canonical_game_id
FROM games_dedup_audit a WHERE channel_bindings.game_id = ANY(a.dup_game_ids);

UPDATE discord_game_mappings SET game_id = a.canonical_game_id
FROM games_dedup_audit a WHERE discord_game_mappings.game_id = ANY(a.dup_game_ids);

UPDATE event_types SET game_id = a.canonical_game_id
FROM games_dedup_audit a WHERE event_types.game_id = ANY(a.dup_game_ids);

UPDATE game_interest_suppressions SET game_id = a.canonical_game_id
FROM games_dedup_audit a WHERE game_interest_suppressions.game_id = ANY(a.dup_game_ids);

UPDATE player_intensity_snapshots SET longest_session_game_id = a.canonical_game_id
FROM games_dedup_audit a WHERE player_intensity_snapshots.longest_session_game_id = ANY(a.dup_game_ids);

-- ─── 3. Delete the dup games rows ──────────────────────────────────────────

DELETE FROM games WHERE id IN (
  SELECT unnest(dup_game_ids) FROM games_dedup_audit
);

-- ─── 4. Clear the audit table (its rows reference now-deleted dup IDs) ────

TRUNCATE TABLE games_dedup_audit;

-- ─── 5. Add partial UNIQUE constraint on games.steam_app_id ───────────────
-- Prevents future Slay-2/II-class dups at the DB layer regardless of which
-- code path attempts the INSERT. Partial because most rows have NULL steam_app_id
-- (IGDB-only games) and we want to allow that.

CREATE UNIQUE INDEX IF NOT EXISTS games_steam_app_id_unique
  ON games (steam_app_id) WHERE steam_app_id IS NOT NULL;
