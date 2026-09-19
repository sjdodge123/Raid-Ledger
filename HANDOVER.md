# ROK-1109 — `loadCommunityOwnership` seqscan (covering index)

**Status: done.** Premise held. Migration `0188_marvelous_jean_grey.sql` shipped
on branch `perf/rok-1109`. Option A was taken (index only) — option B
(denormalised `games.community_owner_count`) is **not** needed, see below.

## The premise held — but not for the reason the story gives

The story says "add a covering index on `game_interests(game_id, source)` **if
one doesn't already exist**". One partly did: `idx_game_interests_game_id`
(migration 0108, "L-4") already indexes `game_id`. That index is enough to
*find* the joined rows and it is still not enough to avoid the seq scan,
because every one of these queries counts rows FILTERed by `source` (and three
of them by `user_id`), which the narrow index does not carry. The planner has
to visit the heap for those columns, the heap is not clustered by `game_id`,
and ~120 bitmap-heap lookups touch more blocks than the whole table — so it
picks the seq scan. Measured: 1348 heap blocks for **10** candidate ids
(`q3_meta` BEFORE) versus 810 blocks for the entire table.

So the fix is real, but `(game_id, source)` as literally proposed only fixes
**one** of the three helpers. `loadCandidateContext` and `loadSuggestionMeta`
also need `gi.user_id` inside the FILTER, and stayed on the seq scan when I
tested `(game_id, source)` in isolation:

| index under test | q1 ownership | q2 candidate context |
| --- | --- | --- |
| `(game_id)` — main today | 8.28 ms seq scan | 11.95 ms seq scan |
| `(game_id, source)` — as proposed | 1.37 ms index-only | **12.48 ms still seq scan** |
| `(game_id, source, user_id)` — shipped | 1.23 ms index-only | 5.19 ms index-only |

## What shipped

`api/src/drizzle/schema/game-interests.ts` — `idx_game_interests_game_id`
replaced by `idx_game_interests_game_id_source_user` on
`(game_id, source, user_id)`.

The old index is **dropped, not kept**: `(game_id)` is a strict prefix of the
new key, so every read it served is still served by the new one, and keeping
both would pay two index writes per Steam-sync row insert. Index count on the
table is unchanged (3 → 3); size goes 1456 kB → 3856 kB at 97,759 rows.

## Why option B is not needed

Option B (materialise `games.community_owner_count`, updated by the Steam
refresh cron) buys ~1 ms more on the cold path and costs a denormalised column,
a backfill, a cron integration and a permanent staleness window. The index puts
all four readers on index-only scans; there is no remaining `game_interests`
hot spot to materialise away. Worth revisiting only if the corpus grows an
order of magnitude beyond the seed below.

## Not touched on purpose

`wildcard.helpers.ts::loadPopularByHours` aggregates `SUM(playtime_forever)`
across the *whole* corpus with no id restriction. A seq scan is the correct
plan there, and covering it would mean carrying `playtime_forever` in the index
for no benefit. Left alone.

## Evidence

Seeded corpus, `pgvector/pgvector:pg16` in Docker, warm cache, best of 3 runs:
20,000 games · 200 users · **97,759 `game_interests` rows, 80,789 of them
`steam_library`** (story asked for ≥ 50K) · 16 MB table · skewed ownership
(popular games owned by many) · 119-id candidate pool, 5 voter ids.

| query | before | after | plan change |
| --- | --- | --- | --- |
| `loadCommunityOwnership` (q1) | 7.99 ms | **0.95 ms** | seq scan → index-only scan |
| `loadCandidateContext` (q2) | 11.43 ms | **3.76 ms** | seq scan → index-only scan |
| `loadSuggestionMeta` (q3) | 1.04 ms | **0.31 ms** | bitmap heap → index-only scan |
| `queryCommonGroundByGameIds` (q4) | 8.31 ms | **1.16 ms** | seq scan → index-only scan |
| Common Ground filtered pool (q5) | 45.65 ms | **25.94 ms** | seq scan → index-only scan |

AC 3 ("no regression on existing Common Ground query performance") is satisfied
with room to spare — **both** Common Ground paths got faster, the by-id cohort
lookup by 7×.

## Commands run

- `npm run db:generate -w api` → `0188_marvelous_jean_grey.sql` (not hand-edited)
- `bash scripts/fix-migration-order.sh --check` → `✓ 188 entries in order`
- `./scripts/validate-migrations.sh` → `Applied 188 migration(s) cleanly` / `PASSED`
- `npx tsc --noEmit -p api/tsconfig.json`, `npm run build -w api`, `npm run lint -w api`

## Tests

No new test. The diff is one index definition plus a generated migration — no
behaviour changes, no query text changes, no rendered flow. Per CLAUDE.md
"behaviour-neutral diff → no new test is required". The migration itself is
covered by `validate-migrations.sh` in the CI gate.

## Reproducing the measurement

The seed/query SQL lived in a session scratchpad and is gone with the session.
To redo it: create `games`, `game_interests` (with `uq_user_game_interest_source`
+ the `game_id` index), `game_taste_vectors`; insert 20K games and ~98K
interests with `1 + floor(20000 * power(random(), 2.2))` for skew; `VACUUM
ANALYZE`; then `EXPLAIN (ANALYZE, BUFFERS)` the five query bodies above with a
119-id `IN` list. Full plan text is reproduced below.

---

## Full `EXPLAIN (ANALYZE, BUFFERS)` output

<details><summary>BEFORE — origin/main index set</summary>

```
############ BEFORE — origin/main index set ############
         indexrelname         |   sz    
------------------------------+---------
 game_interests_pkey          | 2152 kB
 idx_game_interests_game_id   | 1128 kB
 uq_user_game_interest_source | 6344 kB
(3 rows)

===== q1_ownership =====
                                                                                                                                                                                                                                                                                     QUERY PLAN                                                                                                                                                                                                                                                                                      
-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 HashAggregate (actual time=7.926..7.936 rows=119 loops=1)
   Group Key: g.id
   Batches: 1  Memory Usage: 40kB
   Buffers: shared hit=1052
   ->  Hash Right Join (actual time=0.106..7.588 rows=4705 loops=1)
         Hash Cond: (gi.game_id = g.id)
         Buffers: shared hit=1052
         ->  Seq Scan on game_interests gi (actual time=0.001..3.433 rows=97759 loops=1)
               Buffers: shared hit=810
         ->  Hash (actual time=0.099..0.099 rows=119 loops=1)
               Buckets: 1024  Batches: 1  Memory Usage: 13kB
               Buffers: shared hit=242
               ->  Index Only Scan using games_pkey on games g (actual time=0.008..0.091 rows=119 loops=1)
                     Index Cond: (id = ANY ('{1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,45,47,48,49,50,51,52,53,56,58,59,60,67,71,77,94,113,555,877,1395,1526,1761,1817,2538,2810,3094,4520,4783,4985,5191,5223,6533,6764,7162,7258,7667,9182,10060,10912,11119,11209,11447,11532,11993,12083,12156,12815,12891,13065,13553,13611,14325,14401,14576,14608,15533,15676,15992,16056,16466,16676,16759,16831,17050,17555,17736,17756,17968,18034,18318,18348,18789,18947,19317,19368,19671}'::integer[]))
                     Heap Fetches: 0
                     Buffers: shared hit=242
 Planning:
   Buffers: shared hit=152
 Planning Time: 0.243 ms
 Execution Time: 7.992 ms
(20 rows)

===== q2_context =====
                                                                                                                                                                                                                                                                                           QUERY PLAN                                                                                                                                                                                                                                                                                            
-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 GroupAggregate (actual time=10.299..11.348 rows=119 loops=1)
   Group Key: g.id, gtv.dimensions
   Buffers: shared hit=1471
   ->  Sort (actual time=10.237..10.367 rows=4705 loops=1)
         Sort Key: g.id, gtv.dimensions
         Sort Method: quicksort  Memory: 1047kB
         Buffers: shared hit=1471
         ->  Nested Loop Left Join (actual time=0.143..8.658 rows=4705 loops=1)
               Buffers: shared hit=1463
               ->  Hash Right Join (actual time=0.139..7.681 rows=4705 loops=1)
                     Hash Cond: (gi.game_id = g.id)
                     Buffers: shared hit=1106
                     ->  Seq Scan on game_interests gi (actual time=0.001..3.384 rows=97759 loops=1)
                           Buffers: shared hit=810
                     ->  Hash (actual time=0.133..0.134 rows=119 loops=1)
                           Buckets: 1024  Batches: 1  Memory Usage: 18kB
                           Buffers: shared hit=296
                           ->  Index Scan using games_pkey on games g (actual time=0.009..0.123 rows=119 loops=1)
                                 Index Cond: (id = ANY ('{1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,45,47,48,49,50,51,52,53,56,58,59,60,67,71,77,94,113,555,877,1395,1526,1761,1817,2538,2810,3094,4520,4783,4985,5191,5223,6533,6764,7162,7258,7667,9182,10060,10912,11119,11209,11447,11532,11993,12083,12156,12815,12891,13065,13553,13611,14325,14401,14576,14608,15533,15676,15992,16056,16466,16676,16759,16831,17050,17555,17736,17756,17968,18034,18318,18348,18789,18947,19317,19368,19671}'::integer[]))
                                 Buffers: shared hit=296
               ->  Memoize (actual time=0.000..0.000 rows=1 loops=4705)
                     Cache Key: g.id
                     Cache Mode: logical
                     Hits: 4586  Misses: 119  Evictions: 0  Overflows: 0  Memory Usage: 23kB
                     Buffers: shared hit=357
                     ->  Index Scan using game_taste_vectors_pkey on game_taste_vectors gtv (actual time=0.002..0.002 rows=1 loops=119)
                           Index Cond: (game_id = g.id)
                           Buffers: shared hit=357
 Planning:
   Buffers: shared hit=227
 Planning Time: 0.342 ms
 Execution Time: 11.434 ms
(32 rows)

===== q3_meta =====
                                                   QUERY PLAN                                                   
----------------------------------------------------------------------------------------------------------------
 GroupAggregate (actual time=0.400..1.003 rows=10 loops=1)
   Group Key: g.id
   Buffers: shared hit=1392
   ->  Nested Loop Left Join (actual time=0.035..0.874 rows=1352 loops=1)
         Buffers: shared hit=1392
         ->  Index Scan using games_pkey on games g (actual time=0.008..0.014 rows=10 loops=1)
               Index Cond: (id = ANY ('{1,2,3,4,5,6,7,8,9,10}'::integer[]))
               Buffers: shared hit=24
         ->  Bitmap Heap Scan on game_interests gi (actual time=0.013..0.078 rows=135 loops=10)
               Recheck Cond: (game_id = g.id)
               Heap Blocks: exact=1348
               Buffers: shared hit=1368
               ->  Bitmap Index Scan on idx_game_interests_game_id (actual time=0.005..0.005 rows=135 loops=10)
                     Index Cond: (game_id = g.id)
                     Buffers: shared hit=20
 Planning:
   Buffers: shared hit=167
 Planning Time: 0.297 ms
 Execution Time: 1.040 ms
(19 rows)

===== q4_cg_byids =====
                                                                                                                                                                                                                                                                                     QUERY PLAN                                                                                                                                                                                                                                                                                      
-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 HashAggregate (actual time=8.239..8.277 rows=119 loops=1)
   Group Key: g.id
   Batches: 1  Memory Usage: 160kB
   Buffers: shared hit=1106
   ->  Hash Right Join (actual time=0.150..7.714 rows=4705 loops=1)
         Hash Cond: (gi.game_id = g.id)
         Buffers: shared hit=1106
         ->  Seq Scan on game_interests gi (actual time=0.001..3.305 rows=97759 loops=1)
               Buffers: shared hit=810
         ->  Hash (actual time=0.143..0.144 rows=119 loops=1)
               Buckets: 1024  Batches: 1  Memory Usage: 14kB
               Buffers: shared hit=296
               ->  Index Scan using games_pkey on games g (actual time=0.008..0.134 rows=119 loops=1)
                     Index Cond: (id = ANY ('{1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,45,47,48,49,50,51,52,53,56,58,59,60,67,71,77,94,113,555,877,1395,1526,1761,1817,2538,2810,3094,4520,4783,4985,5191,5223,6533,6764,7162,7258,7667,9182,10060,10912,11119,11209,11447,11532,11993,12083,12156,12815,12891,13065,13553,13611,14325,14401,14576,14608,15533,15676,15992,16056,16466,16676,16759,16831,17050,17555,17736,17756,17968,18034,18318,18348,18789,18947,19317,19368,19671}'::integer[]))
                     Buffers: shared hit=296
 Planning:
   Buffers: shared hit=164
 Planning Time: 0.263 ms
 Execution Time: 8.311 ms
(19 rows)

===== q5_cg_pool =====
                                                           QUERY PLAN                                                            
---------------------------------------------------------------------------------------------------------------------------------
 Limit (actual time=45.388..45.395 rows=60 loops=1)
   Buffers: shared hit=1084, temp read=452 written=453
   ->  Sort (actual time=45.386..45.391 rows=60 loops=1)
         Sort Key: ((COALESCE(count(*) FILTER (WHERE (gi.source = 'steam_library'::text)), '0'::bigint))::integer) DESC
         Sort Method: top-N heapsort  Memory: 60kB
         Buffers: shared hit=1084, temp read=452 written=453
         ->  GroupAggregate (actual time=29.372..44.293 rows=13610 loops=1)
               Group Key: g.id
               Filter: (count(*) FILTER (WHERE (gi.source = 'steam_library'::text)) >= 2)
               Rows Removed by Filter: 3890
               Buffers: shared hit=1081, temp read=452 written=453
               ->  Sort (actual time=29.335..33.017 rows=85945 loops=1)
                     Sort Key: g.id
                     Sort Method: external merge  Disk: 3616kB
                     Buffers: shared hit=1081, temp read=452 written=453
                     ->  Hash Right Join (actual time=3.703..17.478 rows=85945 loops=1)
                           Hash Cond: (gi.game_id = g.id)
                           Buffers: shared hit=1081
                           ->  Seq Scan on game_interests gi (actual time=0.006..3.450 rows=97759 loops=1)
                                 Buffers: shared hit=810
                           ->  Hash (actual time=3.681..3.682 rows=17500 loops=1)
                                 Buckets: 32768 (originally 8192)  Batches: 1 (originally 1)  Memory Usage: 1050kB
                                 Buffers: shared hit=271
                                 ->  Seq Scan on games g (actual time=0.005..2.434 rows=17500 loops=1)
                                       Filter: ((player_count IS NOT NULL) AND (((player_count ->> 'max'::text))::integer >= 4))
                                       Rows Removed by Filter: 2500
                                       Buffers: shared hit=271
 Planning:
   Buffers: shared hit=174
 Planning Time: 0.270 ms
 Execution Time: 45.650 ms
(31 rows)

```

</details>

<details><summary>AFTER — migration 0188 index set</summary>

```
############ AFTER — migration 0188 index set ############
              indexrelname              |   sz    
----------------------------------------+---------
 game_interests_pkey                    | 2152 kB
 idx_game_interests_game_id_source_user | 3856 kB
 uq_user_game_interest_source           | 6344 kB
(3 rows)

===== q1_ownership =====
                                                                                                                                                                                                                                                                                  QUERY PLAN                                                                                                                                                                                                                                                                                   
-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 GroupAggregate (actual time=0.048..0.929 rows=119 loops=1)
   Group Key: g.id
   Buffers: shared hit=622
   ->  Nested Loop Left Join (actual time=0.012..0.699 rows=4705 loops=1)
         Buffers: shared hit=622
         ->  Index Only Scan using games_pkey on games g (actual time=0.007..0.102 rows=119 loops=1)
               Index Cond: (id = ANY ('{1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,45,47,48,49,50,51,52,53,56,58,59,60,67,71,77,94,113,555,877,1395,1526,1761,1817,2538,2810,3094,4520,4783,4985,5191,5223,6533,6764,7162,7258,7667,9182,10060,10912,11119,11209,11447,11532,11993,12083,12156,12815,12891,13065,13553,13611,14325,14401,14576,14608,15533,15676,15992,16056,16466,16676,16759,16831,17050,17555,17736,17756,17968,18034,18318,18348,18789,18947,19317,19368,19671}'::integer[]))
               Heap Fetches: 0
               Buffers: shared hit=242
         ->  Index Only Scan using idx_game_interests_game_id_source_user on game_interests gi (actual time=0.001..0.003 rows=40 loops=119)
               Index Cond: (game_id = g.id)
               Heap Fetches: 0
               Buffers: shared hit=380
 Planning:
   Buffers: shared hit=171
 Planning Time: 0.258 ms
 Execution Time: 0.948 ms
(17 rows)

===== q2_context =====
                                                                                                                                                                                                                                                                                        QUERY PLAN                                                                                                                                                                                                                                                                                         
-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 HashAggregate (actual time=3.697..3.716 rows=119 loops=1)
   Group Key: g.id, gtv.dimensions
   Batches: 1  Memory Usage: 105kB
   Buffers: shared hit=984
   ->  Nested Loop Left Join (actual time=0.141..2.260 rows=4705 loops=1)
         Buffers: shared hit=984
         ->  Hash Right Join (actual time=0.136..1.635 rows=119 loops=1)
               Hash Cond: (gtv.game_id = g.id)
               Buffers: shared hit=604
               ->  Seq Scan on game_taste_vectors gtv (actual time=0.001..0.679 rows=20000 loops=1)
                     Buffers: shared hit=308
               ->  Hash (actual time=0.130..0.131 rows=119 loops=1)
                     Buckets: 1024  Batches: 1  Memory Usage: 18kB
                     Buffers: shared hit=296
                     ->  Index Scan using games_pkey on games g (actual time=0.008..0.118 rows=119 loops=1)
                           Index Cond: (id = ANY ('{1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,45,47,48,49,50,51,52,53,56,58,59,60,67,71,77,94,113,555,877,1395,1526,1761,1817,2538,2810,3094,4520,4783,4985,5191,5223,6533,6764,7162,7258,7667,9182,10060,10912,11119,11209,11447,11532,11993,12083,12156,12815,12891,13065,13553,13611,14325,14401,14576,14608,15533,15676,15992,16056,16466,16676,16759,16831,17050,17555,17736,17756,17968,18034,18318,18348,18789,18947,19317,19368,19671}'::integer[]))
                           Buffers: shared hit=296
         ->  Index Only Scan using idx_game_interests_game_id_source_user on game_interests gi (actual time=0.001..0.003 rows=40 loops=119)
               Index Cond: (game_id = g.id)
               Heap Fetches: 0
               Buffers: shared hit=380
 Planning:
   Buffers: shared hit=246
 Planning Time: 0.366 ms
 Execution Time: 3.756 ms
(25 rows)

===== q3_meta =====
                                                                 QUERY PLAN                                                                 
--------------------------------------------------------------------------------------------------------------------------------------------
 GroupAggregate (actual time=0.063..0.284 rows=10 loops=1)
   Group Key: g.id
   Buffers: shared hit=60
   ->  Nested Loop Left Join (actual time=0.014..0.157 rows=1352 loops=1)
         Buffers: shared hit=60
         ->  Index Scan using games_pkey on games g (actual time=0.007..0.012 rows=10 loops=1)
               Index Cond: (id = ANY ('{1,2,3,4,5,6,7,8,9,10}'::integer[]))
               Buffers: shared hit=24
         ->  Index Only Scan using idx_game_interests_game_id_source_user on game_interests gi (actual time=0.002..0.008 rows=135 loops=10)
               Index Cond: (game_id = g.id)
               Heap Fetches: 0
               Buffers: shared hit=36
 Planning:
   Buffers: shared hit=186
 Planning Time: 0.356 ms
 Execution Time: 0.312 ms
(16 rows)

===== q4_cg_byids =====
                                                                                                                                                                                                                                                                                  QUERY PLAN                                                                                                                                                                                                                                                                                   
-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 GroupAggregate (actual time=0.058..1.132 rows=119 loops=1)
   Group Key: g.id
   Buffers: shared hit=676
   ->  Nested Loop Left Join (actual time=0.013..0.726 rows=4705 loops=1)
         Buffers: shared hit=676
         ->  Index Scan using games_pkey on games g (actual time=0.008..0.127 rows=119 loops=1)
               Index Cond: (id = ANY ('{1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,45,47,48,49,50,51,52,53,56,58,59,60,67,71,77,94,113,555,877,1395,1526,1761,1817,2538,2810,3094,4520,4783,4985,5191,5223,6533,6764,7162,7258,7667,9182,10060,10912,11119,11209,11447,11532,11993,12083,12156,12815,12891,13065,13553,13611,14325,14401,14576,14608,15533,15676,15992,16056,16466,16676,16759,16831,17050,17555,17736,17756,17968,18034,18318,18348,18789,18947,19317,19368,19671}'::integer[]))
               Buffers: shared hit=296
         ->  Index Only Scan using idx_game_interests_game_id_source_user on game_interests gi (actual time=0.001..0.003 rows=40 loops=119)
               Index Cond: (game_id = g.id)
               Heap Fetches: 0
               Buffers: shared hit=380
 Planning:
   Buffers: shared hit=183
 Planning Time: 0.267 ms
 Execution Time: 1.161 ms
(16 rows)

===== q5_cg_pool =====
                                                                       QUERY PLAN                                                                        
---------------------------------------------------------------------------------------------------------------------------------------------------------
 Limit (actual time=25.902..25.908 rows=60 loops=1)
   Buffers: shared hit=807
   ->  Sort (actual time=25.901..25.905 rows=60 loops=1)
         Sort Key: ((COALESCE(count(*) FILTER (WHERE (gi.source = 'steam_library'::text)), '0'::bigint))::integer) DESC
         Sort Method: top-N heapsort  Memory: 60kB
         Buffers: shared hit=807
         ->  GroupAggregate (actual time=0.070..24.787 rows=13610 loops=1)
               Group Key: g.id
               Filter: (count(*) FILTER (WHERE (gi.source = 'steam_library'::text)) >= 2)
               Rows Removed by Filter: 3890
               Buffers: shared hit=807
               ->  Merge Left Join (actual time=0.029..13.560 rows=85945 loops=1)
                     Merge Cond: (g.id = gi.game_id)
                     Buffers: shared hit=807
                     ->  Index Scan using games_pkey on games g (actual time=0.007..2.999 rows=17500 loops=1)
                           Filter: ((player_count IS NOT NULL) AND (((player_count ->> 'max'::text))::integer >= 4))
                           Rows Removed by Filter: 2500
                           Buffers: shared hit=327
                     ->  Index Only Scan using idx_game_interests_game_id_source_user on game_interests gi (actual time=0.004..4.644 rows=97755 loops=1)
                           Heap Fetches: 0
                           Buffers: shared hit=480
 Planning:
   Buffers: shared hit=193
 Planning Time: 0.260 ms
 Execution Time: 25.941 ms
(25 rows)

```

</details>
