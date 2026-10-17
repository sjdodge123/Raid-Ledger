-- TDB:1489 — `proposed_time` was a zone-less `timestamp`. Drizzle writes a
-- Date as `toISOString()` and Postgres dropped the `Z`, so every stored value
-- is a UTC wall-clock. Drizzle's generated `SET DATA TYPE` has no USING
-- clause, which would reinterpret those values in the session TimeZone and
-- shift them by its offset on any non-UTC database; `AT TIME ZONE 'UTC'`
-- pins the conversion to the zone the values were actually written in.
ALTER TABLE "community_lineup_schedule_slots" ALTER COLUMN "proposed_time" SET DATA TYPE timestamp with time zone USING "proposed_time" AT TIME ZONE 'UTC';
