-- Re-key voter-cohort lineup memory onto the ROSTER definition (ROK-1538).
--
-- HAND-AUTHORED data migration (no drizzle codegen — there is NO schema change
-- here; 0181 created the table, 0182 backfilled it). CLAUDE.md allows
-- hand-written SQL in this directory provided the commit message says so.
--
-- ## What changed and why
--
-- ROK-1309 keyed a cohort on the ENGAGED set —
-- `union(entries.nominated_by, votes.user_id)`. Operator ruling 2026-09-13
-- replaces that with the ROSTER:
--
--   {community_lineups.created_by}
--   ∪ community_lineup_invitees.user_id
--   ∪ community_lineup_entries.nominated_by
--   ∪ community_lineup_votes.user_id
--
-- The engaged definition had two fatal properties for a memory feature:
--   * a lineup with no nominations and no votes had NO signature at all, so
--     the memory could never surface on the one screen it exists for (a
--     freshly created lineup in `building`); and
--   * the signature MUTATED with every nomination, so the same group of
--     friends hashed differently depending on who had clicked so far.
--
-- Every row already in `community_lineup_cohort_memory` was written (live) or
-- backfilled (0182) under the engaged key, so without this migration they are
-- orphaned the moment the read path starts asking for roster hashes: the
-- feature would silently look like it "has no data".
--
-- ## Hash parity (STRICT)
--
-- Byte-identical to the TypeScript writer in
-- `api/src/lineups/cohort-memory-signature.helpers.ts`:
--
--   sha256( distinct participant ids, sorted NUMERICALLY ascending,
--           joined with a single ',', no trailing separator ) -> lowercase hex
--
-- `string_agg(..., ',' ORDER BY user_id)` orders by the INTEGER column, not by
-- its text rendering — {2, 10} must encode as "2,10", never "10,2".
-- `sha256(bytea)` is a Postgres builtin (PG >= 11); pgcrypto is NOT installed
-- in this database and is deliberately not required. Parity vector pinned in
-- the schema header: {10,2,7} ->
-- 90676ccf0f65e9bbe89124e3079b2d96e9cce8304560a6eadd6a2c8ea0befee7.
--
-- The four-way UNION below MUST stay identical to
-- `loadRosterParticipantIds`. `UNION` (not `UNION ALL`) dedupes a creator who
-- is also rowed as an invitee — `addInvitees` does not exclude them, and
-- double-counting would inflate `cohort_size` past anything the live writer
-- can produce (the ROK-1444 participant-count bug, one layer down).
--
-- `nominated_by` is nullable, hence the explicit NOT NULL guard: a NULL would
-- aggregate into the id list and forge a phantom member.
--
-- ## Rows whose source lineup is gone keep their values
--
-- The join to `roster_signature` is an inner one via the UPDATE's FROM clause,
-- so a memory row with no matching `source_lineup_id` is simply not touched.
-- (`cl_cohort_memory_source_lineup_id_fk` is ON DELETE CASCADE so this should
-- be unreachable today; the migration does not rely on that.)
--
-- ## No unique-key collisions
--
-- `uq_cl_cohort_memory_row` is (participant_hash, game_id, source_lineup_id,
-- resolution). Every row of a given `source_lineup_id` is rewritten to the
-- SAME new hash, and (game_id, resolution) is already unique within one source
-- lineup, so the rewrite cannot collide. That is why this is a plain UPDATE
-- and not a delete-and-reinsert.
--
-- ## Idempotency
--
-- Re-running recomputes the same values; the `IS DISTINCT FROM` guard makes a
-- second run a zero-row no-op.
WITH roster AS (
	SELECT DISTINCT lineup_id, user_id
	FROM (
		SELECT l.id AS lineup_id, l.created_by AS user_id
		FROM community_lineups l
		UNION
		SELECT i.lineup_id, i.user_id
		FROM community_lineup_invitees i
		UNION
		SELECT e.lineup_id, e.nominated_by
		FROM community_lineup_entries e
		WHERE e.nominated_by IS NOT NULL
		UNION
		SELECT v.lineup_id, v.user_id
		FROM community_lineup_votes v
	) all_sources
),
roster_signature AS (
	SELECT
		lineup_id,
		array_agg(user_id ORDER BY user_id) AS participant_ids,
		count(*)::smallint AS cohort_size,
		encode(
			sha256(string_agg(user_id::text, ',' ORDER BY user_id)::bytea),
			'hex'
		) AS participant_hash
	FROM roster
	GROUP BY lineup_id
)
UPDATE community_lineup_cohort_memory m
SET
	participant_ids = rs.participant_ids,
	participant_hash = rs.participant_hash,
	cohort_size = rs.cohort_size
FROM roster_signature rs
WHERE rs.lineup_id = m.source_lineup_id
	AND m.participant_hash IS DISTINCT FROM rs.participant_hash;
