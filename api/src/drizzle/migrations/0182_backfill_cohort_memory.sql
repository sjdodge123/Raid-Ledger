-- Backfill voter-cohort lineup memory from history (ROK-1309 S3).
--
-- HAND-AUTHORED data migration (no drizzle codegen — there is no schema change
-- here; 0181 created the table). CLAUDE.md allows hand-written SQL in this
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
-- ## `created_at` is the HISTORICAL resolution time, never now()
--
-- The read path publishes `created_at` as `lastResolvedAt` AND orders on it
-- (`DISTINCT ON (game_id) ... ORDER BY game_id, created_at DESC`). Letting the
-- column fall to `defaultNow()` would stamp every backfilled row with the
-- deploy timestamp: every historical card would read "resolved today" and a
-- cohort that landed on one game twice would pick its winner by the
-- resolution-rank tiebreak instead of by real chronology. So each outcome
-- branch supplies the best timestamp the source row actually has:
--
--   decided    -> the decided game's own match row (`created_at`, written by
--                 the same `voting -> decided` transition), falling back to
--                 `community_lineups.updated_at` when the decided game never
--                 produced a match row. Pairing it with the match row's
--                 timestamp reproduces the live writer exactly, where both
--                 rows share one `now()` and the rank tiebreak elects
--                 `decided`.
--   match      -> `community_lineup_matches.created_at`.
--   veto_won / veto_lost
--              -> `community_lineup_tiebreakers.resolved_at`, falling back to
--                 `updated_at` for a legacy resolved row that never stamped it.
--
-- ## `match` means MATCH-TIER, not "got at least one vote"
--
-- `runMatchingAlgorithm` inserts a `community_lineup_matches` row for EVERY
-- game with `vote_count > 0` and records the tier separately in
-- `threshold_met`. ROK-1309's AC says "one row per **match-tier** game", so
-- this migration filters on `m.threshold_met` — without it a 10-nomination
-- lineup where every game drew a single vote would backfill 10 rows badged
-- "Match" in the UI. `cohort-memory-write.helpers.ts::buildDecidedOutcomes`
-- applies the IDENTICAL predicate; the two MUST change together or backfilled
-- and live-written rows stop meaning the same thing.
--
-- ## A vetoed-out game is NEVER also a `match` (ROK-1309)
--
-- A game can clear the match tier AND then lose the tiebreaker the cohort ran
-- over the tied set. Emitting both rows made the read path contradict itself:
-- `queryCohortMemory` filters only rows whose OWN resolution is `veto_lost`,
-- so the surviving `match` row re-surfaced a rejected game badged "Match".
-- The rule, applied on BOTH sides: **the veto is the later and more specific
-- resolution — for a given (source lineup, game) a `veto_lost` outcome
-- SUPPRESSES the `match` row; nothing else is suppressed.** The `decided` +
-- `match` pair for the winning game is deliberate and unchanged. The NOT
-- EXISTS below is the `veto_lost` branch's own predicate, negated, so the two
-- branches cannot drift apart.
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
	(participant_ids, participant_hash, cohort_size, game_id, source_lineup_id, resolution, created_at)
WITH resolved AS (
	SELECT id, decided_game_id, updated_at
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
	-- The lineup's own decision, timestamped from the match row the same
	-- transition wrote (or the lineup itself when there is none).
	SELECT
		r.id AS lineup_id,
		r.decided_game_id AS game_id,
		'decided' AS resolution,
		COALESCE(dm.created_at, r.updated_at) AS resolved_at
	FROM resolved r
	LEFT JOIN community_lineup_matches dm
		ON dm.lineup_id = r.id AND dm.game_id = r.decided_game_id
	WHERE r.decided_game_id IS NOT NULL
	UNION ALL
	-- Every MATCH-TIER game produced by the voting pass (threshold_met only),
	-- minus any game the cohort later vetoed out - see the header.
	SELECT m.lineup_id, m.game_id, 'match', m.created_at
	FROM community_lineup_matches m
	JOIN resolved r ON r.id = m.lineup_id
	WHERE m.threshold_met
		AND NOT EXISTS (
			SELECT 1
			FROM community_lineup_tiebreakers vt
			CROSS JOIN LATERAL (
				SELECT DISTINCT jsonb_array_elements_text(vt.tied_game_ids)::int AS game_id
			) vetoed
			WHERE vt.lineup_id = m.lineup_id
				AND vt.status = 'resolved'
				AND vt.winner_game_id IS NOT NULL
				AND vetoed.game_id = m.game_id
				AND vetoed.game_id <> vt.winner_game_id
		)
	UNION ALL
	-- Tiebreaker survivor.
	SELECT t.lineup_id, t.winner_game_id, 'veto_won', COALESCE(t.resolved_at, t.updated_at)
	FROM community_lineup_tiebreakers t
	JOIN resolved r ON r.id = t.lineup_id
	WHERE t.status = 'resolved' AND t.winner_game_id IS NOT NULL
	UNION ALL
	-- Every game vetoed out of that tiebreaker.
	SELECT t.lineup_id, tied.game_id, 'veto_lost', COALESCE(t.resolved_at, t.updated_at)
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
	o.resolution,
	o.resolved_at
FROM outcome o
JOIN signature s ON s.lineup_id = o.lineup_id
JOIN games g ON g.id = o.game_id
ON CONFLICT (participant_hash, game_id, source_lineup_id, resolution) DO NOTHING;
