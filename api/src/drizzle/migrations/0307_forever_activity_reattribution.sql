-- ROK-2259: re-credit WoW Classic-family play misattributed to TBC Anniversary.
-- Discord reports every Classic-family client (WoW: Forever included) as
-- "World of Warcraft Classic"; since Forever launched (2026-11-04) that play was
-- credited to TBC Anniversary (voice path) or left unmatched (presence path,
-- game_id NULL). Operator ruling 2026-11-18, per player: a Forever character
-- (game_variant 'wow_forever' or a non-null ruleset) -> Forever; Classic-family
-- characters that are Anniversary-only -> Anniversary; otherwise -> Forever.
-- No double credit: a player in a bound voice channel has two rows for the same
-- play — presence (raw name "World of Warcraft Classic") and voice (the
-- resolved games.name). A raw-name row overlapping a same-user WoW voice row
-- stays uncredited (step 3), exactly like the live path.
-- Pure SQL, games resolved by slug (a DB without either game is a no-op),
-- idempotent: a second run ends in the same rows and recomputes identical
-- rollups. The name match is case-insensitive, as on the live path.
-- discord_activity_name is left unchanged.

-- Step 1: Anniversary-credited or unmatched Classic sessions of players who are
-- not Anniversary-only -> Forever.
UPDATE game_activity_sessions s
SET game_id = f.id
FROM games f, games a
WHERE f.slug = 'world-of-warcraft-forever'
  AND a.slug = 'world-of-warcraft-burning-crusade-classic-anniversary-edition'
  AND s.started_at >= TIMESTAMP '2026-11-04 00:00:00'
  AND (
    s.game_id = a.id
    OR (
      s.game_id IS NULL
      AND lower(s.discord_activity_name) = 'world of warcraft classic'
    )
  )
  AND (
    EXISTS (
      SELECT 1 FROM characters c
      WHERE c.user_id = s.user_id
        AND (c.game_variant = 'wow_forever' OR c.ruleset IS NOT NULL)
    )
    OR NOT EXISTS (
      SELECT 1 FROM characters c
      WHERE c.user_id = s.user_id AND c.game_id = a.id
    )
  );
--> statement-breakpoint

-- Step 2: unmatched Classic sessions left after step 1 belong to Anniversary-only
-- players -> Anniversary.
UPDATE game_activity_sessions s
SET game_id = a.id
FROM games f, games a
WHERE f.slug = 'world-of-warcraft-forever'
  AND a.slug = 'world-of-warcraft-burning-crusade-classic-anniversary-edition'
  AND s.started_at >= TIMESTAMP '2026-11-04 00:00:00'
  AND s.game_id IS NULL
  AND lower(s.discord_activity_name) = 'world of warcraft classic';
--> statement-breakpoint

-- Step 3: a raw-name (presence) row whose time overlaps a same-user voice row
-- credited to either game (any other name, i.e. the resolved games.name) is
-- the same play counted twice -> uncredited; the voice row keeps the credit.
UPDATE game_activity_sessions s
SET game_id = NULL
FROM games f, games a
WHERE f.slug = 'world-of-warcraft-forever'
  AND a.slug = 'world-of-warcraft-burning-crusade-classic-anniversary-edition'
  AND s.started_at >= TIMESTAMP '2026-11-04 00:00:00'
  AND s.game_id IN (f.id, a.id)
  AND lower(s.discord_activity_name) = 'world of warcraft classic'
  AND EXISTS (
    SELECT 1 FROM game_activity_sessions v
    WHERE v.user_id = s.user_id
      AND v.game_id IN (f.id, a.id)
      AND lower(v.discord_activity_name) <> 'world of warcraft classic'
      AND v.started_at < COALESCE(s.ended_at, 'infinity'::timestamp)
      AND COALESCE(v.ended_at, 'infinity'::timestamp) > s.started_at
  );
--> statement-breakpoint

-- Step 4: rollups are upsert-only, so drop every day/week/month bucket of both
-- games from the bucket holding 2026-11-04 onwards ...
DELETE FROM game_activity_rollups r
USING games f, games a
WHERE f.slug = 'world-of-warcraft-forever'
  AND a.slug = 'world-of-warcraft-burning-crusade-classic-anniversary-edition'
  AND r.game_id IN (f.id, a.id)
  AND r.period IN ('day', 'week', 'month')
  AND r.period_start >= date_trunc(r.period, TIMESTAMP '2026-11-04 00:00:00')::date;
--> statement-breakpoint

-- Step 5: ... and recompute them from sessions exactly as the daily rollup job
-- does (closed, game-matched, timed sessions; bucket = date_trunc(started_at)).
INSERT INTO game_activity_rollups
  (user_id, game_id, period, period_start, total_seconds)
SELECT s.user_id, s.game_id, p.period::varchar,
       date_trunc(p.period, s.started_at)::date,
       SUM(s.duration_seconds)::int
FROM game_activity_sessions s
JOIN games f ON f.slug = 'world-of-warcraft-forever'
JOIN games a
  ON a.slug = 'world-of-warcraft-burning-crusade-classic-anniversary-edition'
CROSS JOIN (VALUES ('day'), ('week'), ('month')) AS p(period)
WHERE s.game_id IN (f.id, a.id)
  AND s.ended_at IS NOT NULL
  AND s.duration_seconds IS NOT NULL
  AND date_trunc(p.period, s.started_at)
      >= date_trunc(p.period, TIMESTAMP '2026-11-04 00:00:00')
GROUP BY s.user_id, s.game_id, p.period, date_trunc(p.period, s.started_at)::date
ON CONFLICT (user_id, game_id, period, period_start)
DO UPDATE SET total_seconds = EXCLUDED.total_seconds;
