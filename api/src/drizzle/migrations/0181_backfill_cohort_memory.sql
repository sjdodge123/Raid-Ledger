-- Backfill voter-cohort lineup memory from history (ROK-1309 S3).
--
-- HAND-AUTHORED data migration (no drizzle codegen — there is no schema change
-- here; 0180 created the table). CLAUDE.md allows hand-written SQL in this
-- directory provided the commit message says so, which it does.
--
-- Self-contained by design: no cron, no admin endpoint, no boot-time pre-step.
-- `sha256()` is a Postgres builtin (PG >= 11), so the canonical participant
-- hash is reproducible in pure SQL and pgcrypto — which this database does NOT
-- have installed — is never needed. That is also why the hash is sha256 rather
-- than the sha1 named in the ticket text.
--
-- ## Hash parity (STRICT)
--
-- The encoding MUST stay byte-identical to the TypeScript writer in
-- `api/src/lineups/cohort-memory-signature.helpers.ts`:
--
--   sha256( distinct participant ids, sorted NUMERICALLY ascending,
--           joined with a single ',', no trailing separator ) -> lowercase hex
--
-- `string_agg(..., ',' ORDER BY user_id)` orders by the INTEGER column, not its
-- text rendering — {2, 10} must encode as "2,10", never "10,2". If the two
-- sides ever drift, backfilled cohorts stop matching live-written ones and the
-- feature silently looks like it "has no data"; that is exactly what
-- `cohort-memory-backfill.integration.spec.ts` pins.
--
-- ## Idempotency
--
-- Every row lands through the natural key `uq_cl_cohort_memory_row`
-- (participant_hash, game_id, source_lineup_id, resolution) with a conflict
-- guard, so re-running this migration — or replaying it after a restore — is a
-- no-op. Never catch-and-retry instead: under postgres.js a failed statement
-- poisons the whole transaction, savepoints included (ROK-1437).
--
-- ## Scope
--
-- Source lineups: status 'decided' or 'archived' only. The cohort is the
-- ENGAGED PARTICIPANT SET — union(entries.nominated_by, votes.user_id) — not
-- the invitee list and not the linked event's signup roster, matching the live
-- writers exactly. A lineup with zero nominators AND zero voters has no
-- signature and contributes nothing (the inner join to `signature` drops it).
-- The join to `games` guards the FK for tied_game_ids entries whose game has
-- since been deleted.
INSERT INTO community_lineup_cohort_memory
	(participant_ids, participant_hash, cohort_size, game_id, source_lineup_id, resolution)
WITH resolved AS (
	SELECT id, decided_game_id
	FROM community_lineups
	WHERE status IN ('decided', 'archived')
),
engaged AS (
	SELECT DISTINCT lineup_id, user_id
	FROM (
		SELECT e.lineup_id, e.nominated_by AS user_id
		FROM community_lineup_entries e
		JOIN resolved r ON r.id = e.lineup_id
		UNION
		SELECT v.lineup_id, v.user_id
		FROM community_lineup_votes v
		JOIN resolved r ON r.id = v.lineup_id
	) both_sources
),
signature AS (
	SELECT
		lineup_id,
		array_agg(user_id ORDER BY user_id) AS participant_ids,
		count(*)::smallint AS cohort_size,
		encode(
			sha256(string_agg(user_id::text, ',' ORDER BY user_id)::bytea),
			'hex'
		) AS participant_hash
	FROM engaged
	GROUP BY lineup_id
),
outcome AS (
	-- The lineup's own decision.
	SELECT r.id AS lineup_id, r.decided_game_id AS game_id, 'decided' AS resolution
	FROM resolved r
	WHERE r.decided_game_id IS NOT NULL
	UNION ALL
	-- Every match-tier game produced by the voting pass.
	SELECT m.lineup_id, m.game_id, 'match'
	FROM community_lineup_matches m
	JOIN resolved r ON r.id = m.lineup_id
	UNION ALL
	-- Tiebreaker survivor.
	SELECT t.lineup_id, t.winner_game_id, 'veto_won'
	FROM community_lineup_tiebreakers t
	JOIN resolved r ON r.id = t.lineup_id
	WHERE t.status = 'resolved' AND t.winner_game_id IS NOT NULL
	UNION ALL
	-- Every game vetoed out of that tiebreaker.
	SELECT t.lineup_id, tied.game_id, 'veto_lost'
	FROM community_lineup_tiebreakers t
	JOIN resolved r ON r.id = t.lineup_id
	CROSS JOIN LATERAL (
		SELECT DISTINCT jsonb_array_elements_text(t.tied_game_ids)::int AS game_id
	) tied
	WHERE t.status = 'resolved'
		AND t.winner_game_id IS NOT NULL
		AND tied.game_id <> t.winner_game_id
)
SELECT DISTINCT
	s.participant_ids,
	s.participant_hash,
	s.cohort_size,
	o.game_id,
	o.lineup_id,
	o.resolution
FROM outcome o
JOIN signature s ON s.lineup_id = o.lineup_id
JOIN games g ON g.id = o.game_id
ON CONFLICT (participant_hash, game_id, source_lineup_id, resolution) DO NOTHING;
