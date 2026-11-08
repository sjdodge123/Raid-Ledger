-- ROK-2120: one-off merge of the duplicate `games` pairs the IGDB/ITAD unique-key
-- collisions left behind (an IGDB-first row and an ITAD/Steam-first twin of the
-- same game). Lane A's code fix stops new pairs; this folds the existing ones.
--
-- Self-contained (STRICT migration rule): pairs are computed here in SQL from
-- `games` alone — no dependence on games_dedup_audit, cron jobs or admin runs.
--
-- PAIR RULE (deliberately conservative — a wrong merge loses a game):
--   * Group non-banned rows by a SQL normalisation of `name` that mirrors
--     contract `normalizeForDedup` minus the Roman-numeral rewrite (lower-case,
--     drop ™/®/©, ":" and " - " subtitle separators -> space, collapse spaces).
--   * Only groups of EXACTLY two rows are considered (ambiguous groups skipped).
--   * Skip when both rows hold an igdb_id (distinct IGDB games), both hold a
--     steam_app_id, or both hold an itad_game_id (both unique -> the values
--     differ -> different storefront products), when `hidden` differs (merging
--     would change moderation visibility), or when both release dates are set
--     and more than a year apart (remake/original).
--   * igdb pair: exactly one row holds igdb_id -> it is the KEEPER; the other
--     (the dup) must carry steam_app_id or itad_game_id (ITAD/Steam-first shape).
--   * itad pair: neither holds igdb_id and exactly one holds itad_game_id ->
--     KEEPER = the lower id.
--
-- PER PAIR, in order:
--   1. game_activity_rollups: additive merge of colliding periods (0140 1a).
--   2. characters: demote the dup's main where the keeper already has one for
--      that user (idx_one_main_per_game) — demote, never delete.
--   3. games_dedup_audit: delete rows naming the dup (a regenerable snapshot;
--      its canonical_game_id FK has no ON DELETE and would block step 7).
--   4. EVERY single-column FK to games(id), discovered from pg_constraint at
--      run time (so tables added after 0140 are covered automatically), is
--      repointed dup -> keeper. On a unique collision the statement is retried
--      row by row. A row that still collides is DELETED (keeper wins) ONLY when
--      its table is a LEAF — no FK anywhere references that table (computed
--      from pg_constraint at run time), so the delete cannot cascade into or
--      null out anything else. Every such delete RAISEs a NOTICE carrying the
--      deleted row as jsonb (no silent deletes). A collision on a NON-leaf table
--      (characters, guilds, ... — anything another table points at) SKIPS THE
--      WHOLE PAIR instead.
--   5. jsonb game-id arrays (community_lineups.tie_game_ids,
--      community_lineup_tiebreakers.tied_game_ids,
--      discovery_category_suggestions.candidate_game_ids): dup -> keeper,
--      de-duplicated, original order kept.
--   6. Identity: the dup's steam_app_id / itad_game_id are cleared first, then
--      copied onto the keeper where the keeper's is NULL (with the steam source
--      and the ITAD price/boxart/tags that belong to that ITAD id), plus
--      cover_url / twitch_game_id fallbacks.
--   7. DELETE the dup row. Every FK was repointed in step 4, so no cascade
--      fires; a multi-column FK we did not handle raises foreign_key_violation.
--
-- PAIR ISOLATION: each pair runs in its own sub-block (a plpgsql savepoint).
-- A non-leaf collision, or any unique/exclusion/foreign-key violation left over,
-- rolls back THAT pair's steps 1-7 only and RAISEs
-- 'ROK-2120 pair skipped keep=% dup=% reason=%'; the other pairs still merge.
-- A leaf-delete NOTICE already emitted for a skipped pair announces a delete
-- that was rolled back with the pair (NOTICEs themselves are not transactional).
--
-- No audit rows are written to games_dedup_audit: it is TRUNCATE+INSERTed on
-- every boot, so a row would not survive, and a group pointing at a deleted id
-- would mislead the admin merge tool. Each merge RAISEs a NOTICE instead; the
-- ops lane's pair-count query (planning-artifacts/ROK-2120-pair-count.sql)
-- is the before/after record.
--
-- IDEMPOTENT: after a merge the name group has one row, so a re-run finds no
-- pairs. Zero pairs -> the loop body never runs.
DO $rok2120$
DECLARE
  p record;
  fk record;
  r record;
  jc record;
  dup_row games%ROWTYPE;
  gone jsonb;
  merged integer := 0;
  skipped integer := 0;
BEGIN
  FOR p IN
    WITH norm AS (
      SELECT g.id, g.igdb_id, g.steam_app_id, g.itad_game_id, g.hidden,
             g.first_release_date,
             trim(regexp_replace(regexp_replace(regexp_replace(
               lower(regexp_replace(g.name, '[™®©]', '', 'g')),
               '\s*:\s*', ' ', 'g'), '\s+-\s+', ' ', 'g'), '\s+', ' ', 'g')) AS nkey
        FROM games g
       WHERE g.banned = false
    ),
    grp AS (
      SELECT nkey FROM norm WHERE nkey <> '' GROUP BY nkey HAVING count(*) = 2
    ),
    pair AS (
      SELECT a.*, b.id AS b_id, b.igdb_id AS b_igdb, b.steam_app_id AS b_steam,
             b.itad_game_id AS b_itad, b.hidden AS b_hidden,
             b.first_release_date AS b_frd
        FROM norm a
        JOIN grp USING (nkey)
        JOIN norm b ON b.nkey = a.nkey AND b.id > a.id
       WHERE NOT (a.igdb_id IS NOT NULL AND b.igdb_id IS NOT NULL)
         AND NOT (a.steam_app_id IS NOT NULL AND b.steam_app_id IS NOT NULL)
         AND NOT (a.itad_game_id IS NOT NULL AND b.itad_game_id IS NOT NULL)
         AND a.hidden = b.hidden
         AND (a.first_release_date IS NULL OR b.first_release_date IS NULL
              OR abs(extract(epoch FROM a.first_release_date - b.first_release_date))
                 <= 366 * 86400)
    )
    SELECT CASE WHEN b_igdb IS NOT NULL THEN b_id ELSE id END AS keeper_id,
           CASE WHEN b_igdb IS NOT NULL THEN id ELSE b_id END AS dup_id,
           CASE WHEN igdb_id IS NULL AND b_igdb IS NULL THEN 'itad' ELSE 'igdb' END AS kind
      FROM pair
     WHERE (igdb_id IS NOT NULL AND (b_steam IS NOT NULL OR b_itad IS NOT NULL))
        OR (b_igdb IS NOT NULL AND (steam_app_id IS NOT NULL OR itad_game_id IS NOT NULL))
        OR (igdb_id IS NULL AND b_igdb IS NULL
            AND (itad_game_id IS NOT NULL OR b_itad IS NOT NULL))
     ORDER BY 1, 2
  LOOP
    BEGIN
      -- 1. Additive rollup merge (the colliding dup rows are dropped in step 4).
      UPDATE game_activity_rollups w
         SET total_seconds = w.total_seconds + l.total_seconds
        FROM game_activity_rollups l
       WHERE w.game_id = p.keeper_id AND l.game_id = p.dup_id
         AND l.user_id = w.user_id AND l.period = w.period
         AND l.period_start = w.period_start;

      -- 2. Demote the dup's main where the keeper already has one.
      UPDATE characters l SET is_main = false
       WHERE l.game_id = p.dup_id AND l.is_main = true
         AND EXISTS (SELECT 1 FROM characters w
                      WHERE w.game_id = p.keeper_id AND w.user_id = l.user_id
                        AND w.is_main = true);

      -- 3. Stale dedup-audit rows naming the dup.
      DELETE FROM games_dedup_audit
       WHERE canonical_game_id = p.dup_id OR p.dup_id = ANY(dup_game_ids);

      -- 4. Repoint every single-column FK to games(id); leaf-only deletes.
      FOR fk IN
        SELECT c.conrelid::regclass AS tbl, a.attname AS col,
               NOT EXISTS (SELECT 1 FROM pg_constraint x
                            WHERE x.contype = 'f'
                              AND x.confrelid = c.conrelid) AS is_leaf
          FROM pg_constraint c
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
         WHERE c.contype = 'f' AND c.confrelid = 'public.games'::regclass
           AND array_length(c.conkey, 1) = 1
           AND c.conrelid <> 'public.games_dedup_audit'::regclass
         ORDER BY c.conrelid::regclass::text, a.attname
      LOOP
        BEGIN
          EXECUTE format('UPDATE %s SET %I = $1 WHERE %I = $2', fk.tbl, fk.col, fk.col)
            USING p.keeper_id, p.dup_id;
        EXCEPTION WHEN unique_violation OR exclusion_violation THEN
          FOR r IN EXECUTE format('SELECT ctid AS t FROM %s WHERE %I = $1', fk.tbl, fk.col)
                     USING p.dup_id
          LOOP
            BEGIN
              EXECUTE format('UPDATE %s SET %I = $1 WHERE ctid = $2', fk.tbl, fk.col)
                USING p.keeper_id, r.t;
            EXCEPTION WHEN unique_violation OR exclusion_violation THEN
              IF NOT fk.is_leaf THEN
                RAISE EXCEPTION 'non-leaf %.% row collides with the keeper',
                  fk.tbl, fk.col USING ERRCODE = 'RL120';
              END IF;
              EXECUTE format(
                'DELETE FROM %s AS d WHERE d.ctid = $1 RETURNING to_jsonb(d.*)',
                fk.tbl) INTO gone USING r.t;
              RAISE NOTICE 'ROK-2120 leaf row deleted keep=% dup=% table=% row=%',
                p.keeper_id, p.dup_id, fk.tbl, gone;
            END;
          END LOOP;
        END;
      END LOOP;

      -- 5. jsonb game-id arrays.
      FOR jc IN
        SELECT * FROM (VALUES
          ('community_lineups', 'tie_game_ids'),
          ('community_lineup_tiebreakers', 'tied_game_ids'),
          ('discovery_category_suggestions', 'candidate_game_ids')
        ) AS v(tbl, col)
        WHERE to_regclass('public.' || v.tbl) IS NOT NULL
      LOOP
        EXECUTE format(
          'UPDATE %I SET %I = (
             SELECT jsonb_agg(v ORDER BY o) FROM (
               SELECT v, min(o) AS o FROM (
                 SELECT CASE WHEN e = to_jsonb($2::int) THEN to_jsonb($1::int) ELSE e END AS v, o
                   FROM jsonb_array_elements(%I) WITH ORDINALITY AS t(e, o)
               ) x GROUP BY v
             ) y)
           WHERE jsonb_typeof(%I) = ''array'' AND %I @> to_jsonb($2::int)',
          jc.tbl, jc.col, jc.col, jc.col, jc.col)
          USING p.keeper_id, p.dup_id;
      END LOOP;

      -- 6. Identity: clear the dup's unique keys, then fill the keeper's gaps.
      SELECT g.* INTO dup_row FROM games g WHERE g.id = p.dup_id;
      UPDATE games SET steam_app_id = NULL, itad_game_id = NULL WHERE id = p.dup_id;
      UPDATE games k SET
        steam_app_id = COALESCE(k.steam_app_id, dup_row.steam_app_id),
        steam_app_id_source = CASE WHEN k.steam_app_id IS NULL AND dup_row.steam_app_id IS NOT NULL
                                   THEN dup_row.steam_app_id_source ELSE k.steam_app_id_source END,
        itad_game_id = COALESCE(k.itad_game_id, dup_row.itad_game_id),
        itad_boxart_url = CASE WHEN k.itad_game_id IS NULL THEN dup_row.itad_boxart_url ELSE k.itad_boxart_url END,
        itad_tags = CASE WHEN k.itad_game_id IS NULL THEN dup_row.itad_tags ELSE k.itad_tags END,
        itad_current_price = CASE WHEN k.itad_game_id IS NULL THEN dup_row.itad_current_price ELSE k.itad_current_price END,
        itad_current_cut = CASE WHEN k.itad_game_id IS NULL THEN dup_row.itad_current_cut ELSE k.itad_current_cut END,
        itad_current_shop = CASE WHEN k.itad_game_id IS NULL THEN dup_row.itad_current_shop ELSE k.itad_current_shop END,
        itad_current_url = CASE WHEN k.itad_game_id IS NULL THEN dup_row.itad_current_url ELSE k.itad_current_url END,
        itad_lowest_price = CASE WHEN k.itad_game_id IS NULL THEN dup_row.itad_lowest_price ELSE k.itad_lowest_price END,
        itad_lowest_cut = CASE WHEN k.itad_game_id IS NULL THEN dup_row.itad_lowest_cut ELSE k.itad_lowest_cut END,
        itad_price_updated_at = CASE WHEN k.itad_game_id IS NULL THEN dup_row.itad_price_updated_at ELSE k.itad_price_updated_at END,
        cover_url = COALESCE(k.cover_url, dup_row.cover_url),
        twitch_game_id = COALESCE(k.twitch_game_id, dup_row.twitch_game_id)
       WHERE k.id = p.keeper_id;

      -- 7. Drop the dup.
      DELETE FROM games WHERE id = p.dup_id;
      merged := merged + 1;
      RAISE NOTICE 'ROK-2120 merged % pair: keep=% dup=%', p.kind, p.keeper_id, p.dup_id;
    EXCEPTION WHEN SQLSTATE 'RL120' OR unique_violation OR exclusion_violation
                   OR foreign_key_violation THEN
      skipped := skipped + 1;
      RAISE NOTICE 'ROK-2120 pair skipped keep=% dup=% reason=%',
        p.keeper_id, p.dup_id, SQLERRM;
    END;
  END LOOP;
  RAISE NOTICE 'ROK-2120 merged % duplicate games pair(s), skipped %', merged, skipped;
END
$rok2120$;
