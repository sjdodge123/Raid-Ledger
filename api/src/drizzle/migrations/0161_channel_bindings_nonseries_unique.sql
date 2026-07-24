-- ROK-1419: restore non-series duplicate protection dropped by migration 0067.
-- RUN_ID for this migration's dedupe: '003d4c02-de37-4c64-81e0-cc878714d1a0'
--
-- ATOMICITY: under drizzle migrate() (deploy boot) ALL pending migrations run
--   inside ONE transaction, so this file is atomic and the audit/UPDATE/DELETE
--   row locks serialise it against any writer. Under
--   scripts/reconcile-migrations.mjs AND scripts/validate-migrations.sh each
--   breakpoint-delimited statement below runs in AUTOCOMMIT, so every statement
--   is individually idempotent (run-scoped by RUN_ID; ON CONFLICT DO NOTHING
--   audit insert; IF NOT EXISTS indexes). NO explicit LOCK TABLE: a bare LOCK is
--   rejected outside a transaction block (the autocommit path), and the boot
--   transaction already provides atomicity — so the spec's LOCK step is omitted
--   here to keep the file runnable under both migrators.
--   NOTE: the breakpoint marker literal must never appear inside a comment —
--   drizzle's migrate() splits on it even in comments (would corrupt this SQL).
--
-- ROLLBACK (indexes only, no data change):
--   DROP INDEX IF EXISTS channel_bindings_nonseries_game_unique;
--   DROP INDEX IF EXISTS channel_bindings_nonseries_nullgame_unique;
--
-- INSPECT what was removed:
--   SELECT * FROM channel_bindings_dedup_audit WHERE run_id = '003d4c02-de37-4c64-81e0-cc878714d1a0';
--
-- RESTORE removed bindings (DROP the two indexes first; valid only against the
--   channel_bindings row shape as of schema_version '0161'):
--   INSERT INTO channel_bindings
--   SELECT (jsonb_populate_record(NULL::channel_bindings, a.loser_row)).*
--   FROM channel_bindings_dedup_audit a
--   WHERE a.run_id = '003d4c02-de37-4c64-81e0-cc878714d1a0' AND a.reason = 'nonseries-dedupe';
--
-- RESTORE event linkage (re-point each moved live event back to its loser):
--   UPDATE events e SET channel_binding_id = a.loser_binding_id
--   FROM channel_bindings_dedup_audit a, jsonb_array_elements(a.moved_events) m
--   WHERE a.run_id = '003d4c02-de37-4c64-81e0-cc878714d1a0' AND e.id = (m->>'event_id')::int;
--
INSERT INTO channel_bindings_dedup_audit
  (run_id, schema_version, reason, guild_id, channel_id, binding_purpose,
   game_id, survivor_id, loser_binding_id, loser_row)
SELECT '003d4c02-de37-4c64-81e0-cc878714d1a0'::uuid, '0161', 'nonseries-dedupe',
       g.guild_id, g.channel_id, g.binding_purpose, g.game_id,
       g.ids[1], g.ids[i], g.rows -> (i - 1)
FROM (
  SELECT cb.guild_id, cb.channel_id, cb.binding_purpose, cb.game_id,
         array_agg(cb.id ORDER BY cb.updated_at DESC, cb.id ASC) AS ids,
         jsonb_agg(to_jsonb(cb) ORDER BY cb.updated_at DESC, cb.id ASC) AS rows
  FROM channel_bindings cb
  WHERE cb.recurrence_group_id IS NULL
  GROUP BY cb.guild_id, cb.channel_id, cb.binding_purpose, cb.game_id
  HAVING count(*) > 1
) g
CROSS JOIN LATERAL generate_subscripts(g.ids, 1) AS i
WHERE i > 1
ON CONFLICT (loser_binding_id, reason) DO NOTHING;
--> statement-breakpoint
WITH moved AS (
  UPDATE events e SET channel_binding_id = a.survivor_id
  FROM channel_bindings_dedup_audit a
  WHERE a.run_id = '003d4c02-de37-4c64-81e0-cc878714d1a0'::uuid
    AND e.channel_binding_id = a.loser_binding_id
    AND e.is_ad_hoc = true
    AND COALESCE(e.extended_until, upper(e.duration)) > now()
    AND EXISTS (SELECT 1 FROM channel_bindings s WHERE s.id = a.survivor_id)
  RETURNING a.loser_binding_id AS loser_id, e.id AS event_id
)
UPDATE channel_bindings_dedup_audit x
SET moved_events = COALESCE(
      (SELECT jsonb_agg(jsonb_build_object('event_id', m.event_id))
       FROM moved m WHERE m.loser_id = x.loser_binding_id),
      '[]'::jsonb),
    events_repointed = (
      SELECT count(*) FROM moved m WHERE m.loser_id = x.loser_binding_id)
WHERE x.run_id = '003d4c02-de37-4c64-81e0-cc878714d1a0'::uuid
  -- Re-run guard: a reconcile re-run after the events were already repointed
  -- produces an empty `moved` set — without this EXISTS the re-run would wipe
  -- the recorded rollback payload back to '[]'. First run: rows with no live
  -- events keep the column DEFAULT '[]' untouched.
  AND EXISTS (SELECT 1 FROM moved m WHERE m.loser_id = x.loser_binding_id);
--> statement-breakpoint
UPDATE channel_bindings_dedup_audit a
SET events_nulled = (
      SELECT count(*) FROM events e WHERE e.channel_binding_id = a.loser_binding_id)
WHERE a.run_id = '003d4c02-de37-4c64-81e0-cc878714d1a0'::uuid
  -- Re-run guard: only count while the loser row still exists (first run,
  -- pre-DELETE). A re-run after the DELETE would otherwise reset the recorded
  -- historical-orphan count to 0.
  AND EXISTS (SELECT 1 FROM channel_bindings cb WHERE cb.id = a.loser_binding_id);
--> statement-breakpoint
DELETE FROM channel_bindings
WHERE id IN (
  SELECT loser_binding_id FROM channel_bindings_dedup_audit
  WHERE run_id = '003d4c02-de37-4c64-81e0-cc878714d1a0'::uuid);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channel_bindings_nonseries_game_unique" ON "channel_bindings" USING btree ("guild_id","channel_id","binding_purpose","game_id") WHERE "channel_bindings"."recurrence_group_id" IS NULL AND "channel_bindings"."game_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channel_bindings_nonseries_nullgame_unique" ON "channel_bindings" USING btree ("guild_id","channel_id","binding_purpose") WHERE "channel_bindings"."recurrence_group_id" IS NULL AND "channel_bindings"."game_id" IS NULL;