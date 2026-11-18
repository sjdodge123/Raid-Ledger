-- ROK-2259: re-credit WoW Classic-family play misattributed to TBC Anniversary.
-- Discord reports every Classic-family client (WoW: Forever included) as
-- "World of Warcraft Classic"; since Forever launched (2026-11-04) that play was
-- credited to TBC Anniversary (voice path) or left unmatched (presence path,
-- game_id NULL). Operator ruling 2026-11-18, per player: a Forever character
-- (game_variant 'wow_forever' or a non-null ruleset) -> Forever; Classic-family
-- characters that are Anniversary-only -> Anniversary; otherwise -> Forever.
-- Pure SQL, games resolved by slug (a DB without either game is a no-op),
-- idempotent: a second run matches nothing and recomputes identical rollups.
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
    OR (s.game_id IS NULL AND s.discord_activity_name = 'World of Warcraft Classic')
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
  AND s.discord_activity_name = 'World of Warcraft Classic';
--> statement-breakpoint

-- Step 3: rollups are upsert-only, so drop every day/week/month bucket of both
-- games from the bucket holding 2026-11-04 onwards ...
DELETE FROM game_activity_rollups r
USING games g
WHERE g.slug IN (
    'world-of-warcraft-forever',
    'world-of-warcraft-burning-crusade-classic-anniversary-edition'
  )
  AND r.game_id = g.id
  AND r.period IN ('day', 'week', 'month')
  AND r.period_start >= date_trunc(r.period, TIMESTAMP '2026-11-04 00:00:00')::date;
--> statement-breakpoint

-- Step 4: ... and recompute them from sessions exactly as the daily rollup job
-- does (closed, game-matched, timed sessions; bucket = date_trunc(started_at)).
INSERT INTO game_activity_rollups
  (user_id, game_id, period, period_start, total_seconds)
SELECT s.user_id, s.game_id, p.period::varchar,
       date_trunc(p.period, s.started_at)::date,
       SUM(s.duration_seconds)::int
FROM game_activity_sessions s
JOIN games g ON g.id = s.game_id
CROSS JOIN (VALUES ('day'), ('week'), ('month')) AS p(period)
WHERE g.slug IN (
    'world-of-warcraft-forever',
    'world-of-warcraft-burning-crusade-classic-anniversary-edition'
  )
  AND s.ended_at IS NOT NULL
  AND s.game_id IS NOT NULL
  AND s.duration_seconds IS NOT NULL
  AND date_trunc(p.period, s.started_at)
      >= date_trunc(p.period, TIMESTAMP '2026-11-04 00:00:00')
GROUP BY s.user_id, s.game_id, p.period, date_trunc(p.period, s.started_at)::date
ON CONFLICT (user_id, game_id, period, period_start)
DO UPDATE SET total_seconds = EXCLUDED.total_seconds;
