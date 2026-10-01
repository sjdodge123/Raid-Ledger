# DB Index Audit — 2026 Q3 (ROK-1157)

This audit checks every foreign key in the schema for a supporting index, adds the ten that sit on hot or growing paths, and records why the rest are deferred [ROK-1157](https://linear.app/roknua-projects/issue/ROK-1157). The half that needs production statistics (unused indexes, slow-query plans) is out of scope here and is listed under [Not done: needs prod stats](#7-not-done-needs-prod-stats).

## 1. Scope and method

**Doc location.** The story body asks for the audit under `planning-artifacts/`, but that directory is gitignored (`.gitignore:29`), so a file there could never satisfy the "audit doc committed" AC. This doc lives under `docs/` so it stays tracked, following the precedent of `docs/sentry-audit-2026-Q2.md`.

**Source of truth.** A static scan of the latest drizzle snapshot, `api/src/drizzle/migrations/meta/0195_snapshot.json`. The snapshot chain and the schema-vs-snapshot drift guards (`api/src/drizzle/migration-snapshots.spec.ts`) mean the snapshot matches the schema source. The scan also reads every raw-SQL `CREATE INDEX` in `api/src/drizzle/migrations/*.sql` and drops any index a later migration removes with `DROP INDEX`. The script is in the [appendix](#appendix-scanner).

**What counts as covered.** A foreign-key column is covered when it is the **leading** column of one of the following:

- an index in the snapshot (expression indexes do not count),
- a unique constraint,
- a composite primary key,
- a raw-SQL `CREATE INDEX` that no later migration drops.

A column that is itself the primary key, or has a column-level `UNIQUE`, also counts. A column that appears only in a non-leading position, such as `user_id` in `(lineup_id, user_id)`, is **not** covered. Postgres cannot use that index for `WHERE user_id = $1`, and that is the predicate the referential-integrity trigger issues when a parent row is deleted.

**Spot check.** The scan's output was checked by hand against the schema source (`sessions.ts:9`, `local-credentials.ts:13`, `event-voice-sessions.ts:30`, `characters.ts:33`, `availability.ts:39-41`, all under `api/src/drizzle/schema/`), and the scan agreed every time.

## 2. Headline

**119 foreign keys: 61 covered, 58 uncovered.**

Almost every *read* predicate on the 58 uncovered columns is already served by a composite unique whose leading column is the scope key. For example, `lineups-voting.helpers.ts:31` filters by `(lineup_id, user_id)`, which `uq_lineup_vote_user_game` serves, and the event-reminder inserts conflict on `unique_event_user_reminder (event_id, user_id, reminder_type)`. So the cost of a missing index is not slow reads. It is the **parent-row delete**. Postgres runs an RI trigger per deleted parent row that looks up the children by the FK column. With no index leading on that column, each lookup is a sequential scan of the child table. `CASCADE` and `SET NULL` then rewrite whatever the scan finds, and `NO ACTION` still scans to prove nothing references the parent.

The parent-delete paths that exist today:

| Parent | Delete site |
|---|---|
| `users` | `api/src/users/users-delete.helpers.ts:263`, plus the explicit child deletes before it at `:36`, `:65`, `:70`, `:94`, `:102`, `:106`, `:169` |
| `games` | `api/src/igdb/igdb-dedup-cleanup.helpers.ts:153-156` (reassign the loser's FKs to the winner) and `:243` (delete the loser), run once per loser in a loop; `api/src/discord-bot/services/channel-bindings-invariant.helpers.ts:224` (delete by `inArray`) |
| `events` | `api/src/events/event-lifecycle.helpers.ts:56` (single event); `api/src/events/event-series.helpers.ts:146` (whole series by `inArray`, so one statement fires the trigger once per event) |
| `characters` | `api/src/characters/characters.service.ts:140` |

**One genuine read hot path** has a gap: `api/src/lineups/ai-suggestions/voter-activity.helpers.ts:99-102` selects from `player_co_play` with `or(inArray(userIdA, ids), inArray(userIdB, ids))`. The primary key `(user_id_a, user_id_b)` serves the `user_id_a` arm but not the `user_id_b` arm, so the planner falls back to a sequential scan of the whole table, which grows roughly with the square of the number of users. `idx_player_co_play_user_id_b` lets the planner run a bitmap OR over two index scans instead.

## 3. Findings

All 58 uncovered foreign keys. `ADD` means the index is added by migration `0196_fk_backing_indexes` in this PR; `DEFER` means no index now, for the reason given (section 5 groups the reasons).

| # | table.column | → parent [onDelete] | Recommendation | Impact / why |
|---|---|---|---|---|
| 1 | `activity_log.actor_id` | `users` [set null] | **ADD** | Append-only log with unbounded growth; a user delete rewrites every row the user authored after a full scan. |
| 2 | `admin_actions.actor_id` | `users` [set null] | DEFER | Admin/audit table; operator-driven writes, tiny row count. |
| 3 | `ai_request_logs.user_id` | `users` [set null] | DEFER | Owned by ROK-1148 (which added the 0178 composite index for its read path). Not re-proposed here. |
| 4 | `availability.game_id` | `games` [no action] | **ADD** | Game delete (dedup loser delete, binding-invariant delete) runs an FK check that scans every availability row. |
| 5 | `availability.source_event_id` | `events` [no action] | **ADD** | Event delete runs an FK check per deleted event; a series delete multiplies it by the series length. |
| 6 | `characters.game_id` | `games` [cascade] | **ADD** | Dedup reassign and loser delete scan characters once per loser; the dedup audit counts characters per game (`api/src/admin/games-dedup-audit.helpers.ts:184`). The existing `(user_id, game_id, ...)` uniques lead with `user_id`. |
| 7 | `community_lineup_cohort_memory.game_id` | `games` [cascade] | DEFER | Lineup family; 2nd column of `uq_cl_cohort_memory_row`; bounded by resolved lineups. |
| 8 | `community_lineup_cohort_memory.source_lineup_id` | `community_lineups` [cascade] | DEFER | Lineup family; 3rd column of `uq_cl_cohort_memory_row`; lineups are not deleted in normal operation. |
| 9 | `community_lineup_entries.carried_over_from` | `community_lineups` [no action] | DEFER | Lineup family; nullable provenance pointer, bounded by entries per lineup. |
| 10 | `community_lineup_entries.game_id` | `games` [cascade] | DEFER | Lineup family; reads go through `uq_lineup_entry_game (lineup_id, game_id)`. |
| 11 | `community_lineup_entries.nominated_by` | `users` [cascade] | DEFER | Lineup family; a handful of nominations per user per lineup. |
| 12 | `community_lineup_invitees.invited_by` | `users` [set null] | DEFER | Lineup family; invite rows bounded by lineup size. |
| 13 | `community_lineup_match_members.user_id` | `users` [cascade] | DEFER | Lineup family; 2nd column of `uq_match_member_user (match_id, user_id)`. |
| 14 | `community_lineup_matches.game_id` | `games` [cascade] | DEFER | Lineup family; 2nd column of `uq_lineup_match_game (lineup_id, game_id)`. |
| 15 | `community_lineup_matches.linked_event_id` | `events` [set null] | DEFER | Lineup family; at most one match per linked event, few matches per lineup. |
| 16 | `community_lineup_schedule_slots.match_id` | `community_lineup_matches` [cascade] | DEFER | Lineup family; a few slots per match; matches are not deleted in normal operation. |
| 17 | `community_lineup_schedule_votes.user_id` | `users` [cascade] | DEFER | Lineup family; 2nd column of `uq_schedule_vote_user (slot_id, user_id)`. |
| 18 | `community_lineup_tiebreaker_bracket_matchups.game_a_id` | `games` [no action] | DEFER | Lineup family; only exists for tied lineups. |
| 19 | `community_lineup_tiebreaker_bracket_matchups.game_b_id` | `games` [no action] | DEFER | Lineup family; only exists for tied lineups. |
| 20 | `community_lineup_tiebreaker_bracket_matchups.winner_game_id` | `games` [no action] | DEFER | Lineup family; only exists for tied lineups. |
| 21 | `community_lineup_tiebreaker_bracket_votes.game_id` | `games` [no action] | DEFER | Lineup family; only exists for tied lineups. |
| 22 | `community_lineup_tiebreaker_bracket_votes.user_id` | `users` [cascade] | DEFER | Lineup family; 2nd column of `uq_tiebreaker_bracket_vote (matchup_id, user_id)`. |
| 23 | `community_lineup_tiebreaker_vetoes.game_id` | `games` [no action] | DEFER | Lineup family; only exists for tied lineups. |
| 24 | `community_lineup_tiebreaker_vetoes.user_id` | `users` [cascade] | DEFER | Lineup family; 2nd column of `uq_tiebreaker_veto_user (tiebreaker_id, user_id)`. |
| 25 | `community_lineup_tiebreakers.lineup_id` | `community_lineups` [cascade] | DEFER | Lineup family; at most a few tiebreakers per lineup. |
| 26 | `community_lineup_tiebreakers.winner_game_id` | `games` [no action] | DEFER | Lineup family; only exists for tied lineups. |
| 27 | `community_lineup_user_submissions.user_id` | `users` [cascade] | DEFER | Lineup family; 2nd column of `uq_lineup_user_submission (lineup_id, user_id)`. |
| 28 | `community_lineup_votes.game_id` | `games` [cascade] | DEFER | Lineup family; 3rd column of `uq_lineup_vote_user_game`; bounded by voters × lineups. |
| 29 | `community_lineup_votes.user_id` | `users` [cascade] | DEFER | Lineup family; 2nd column of `uq_lineup_vote_user_game` / `uq_lineup_vote_user_rank`; reads (`lineups-voting.helpers.ts:31`) lead with `lineup_id`. |
| 30 | `community_lineups.created_by` | `users` [no action] | DEFER | Lineup family; one row per lineup, so the table stays small. |
| 31 | `community_lineups.decided_game_id` | `games` [no action] | DEFER | Lineup family; one row per lineup. |
| 32 | `community_lineups.linked_event_id` | `events` [no action] | DEFER | Lineup family; one row per lineup. |
| 33 | `community_lineups.tie_pick_by` | `users` [set null] | DEFER | Lineup family; one row per lineup. |
| 34 | `community_lineups.tie_pick_game_id` | `games` [no action] | DEFER | Lineup family; one row per lineup. |
| 35 | `discord_channel_presence_occupancy.game_id` | `games` [set null] | DEFER | Bounded by voice channels in the guild, not by history. |
| 36 | `discord_game_mappings.game_id` | `games` [cascade] | DEFER | Admin-configured mapping rows; tens of rows. |
| 37 | `discovery_category_suggestions.reviewed_by` | `users` [set null] | DEFER | Admin/audit table; operator-reviewed rows. |
| 38 | `event_plans.created_event_id` | `events` [set null] | DEFER | One plan row per planned event; small and short-lived. |
| 39 | `event_plans.game_id` | `games` [set null] | DEFER | One plan row per planned event; small and short-lived. |
| 40 | `event_reminders_sent.user_id` | `users` [cascade] | **ADD** | Grows as events × signed-up users × reminder types; `unique_event_user_reminder` leads with `event_id`, so a user delete scans the whole table. |
| 41 | `event_signups.character_id` | `characters` [set null] | **ADD** | Core growth table; every character delete (`characters.service.ts:140`) scans all signups. |
| 42 | `event_templates.user_id` | `users` [no action] | DEFER | Small per-user table; a few templates per organiser. |
| 43 | `event_voice_sessions.user_id` | `users` [set null] | **ADD** | One row per voice join per event; grows with attendance; a user delete scans the whole table. |
| 44 | `feedback.user_id` | `users` [cascade] | DEFER | Small per-user table; low write volume. |
| 45 | `game_interest_suppressions.game_id` | `games` [cascade] | DEFER | Small per-user table; 2nd column of `uq_user_game_suppression (user_id, game_id)`. |
| 46 | `games_dedup_audit.canonical_game_id` | `games` [no action] | DEFER | Admin/audit table; written only by the dedup job. |
| 47 | `lfg_intents.converted_to_event_id` | `events` [set null] | **ADD** | Event delete SET NULL scans every intent; also the join key in `api/src/lfg/lfg-playing.helpers.ts:59` and `:113`. |
| 48 | `lfg_intents.converted_to_poll_id` | `community_lineup_matches` [set null] | DEFER | Rare conversion path; match rows are not deleted in normal operation. |
| 49 | `lfg_invites.inviter_user_id` | `users` [cascade] | DEFER | Small per-user table; reads lead with `recipient_user_id` (`idx_lfg_invites_recipient_game_sent_at`). |
| 50 | `local_credentials.user_id` | `users` [no action] | DEFER | Small per-user table; at most one row per local account. |
| 51 | `player_co_play.user_id_b` | `users` [cascade] | **ADD** | The `user_id_b` arm of the voter-activity OR predicate (`voter-activity.helpers.ts:99-102`) forces a scan of an O(users²) table; also user delete cascade. |
| 52 | `player_intensity_snapshots.longest_session_game_id` | `games` [set null] | **ADD** | Weekly per-user snapshot growth; a game dedup delete SET NULL scans the whole table. |
| 53 | `post_event_followup_sent.match_id` | `community_lineup_matches` [set null] | DEFER | At most one row per match. |
| 54 | `post_event_reminders_sent.pug_slot_id` | `pug_slots` [cascade] | DEFER | 2nd column of `unique_post_event_pug_reminder (event_id, pug_slot_id)`; PUG slots are rare. |
| 55 | `pug_slots.claimed_by_user_id` | `users` [no action] | DEFER | Small table; PUG slots are rare. |
| 56 | `pug_slots.created_by` | `users` [no action] | DEFER | Small table; PUG slots are rare. |
| 57 | `sessions.user_id` | `users` [no action] | DEFER | Small per-user table; a few live sessions per user. |
| 58 | `wow_classic_quest_progress.user_id` | `users` [cascade] | DEFER | Small per-user table; 2nd column of `uq_quest_progress_event_user_quest (event_id, user_id, quest_id)`. |

## 4. Added in this PR

One drizzle-kit-generated migration, `0196_fk_backing_indexes.sql`, with its snapshot and journal entry. It contains exactly ten plain btree `CREATE INDEX` statements and no `DROP` or `ALTER`:

| Index | Table (column) | Why |
|---|---|---|
| `idx_event_signups_character_id` | `event_signups (character_id)` | Character delete SET NULL scans the core growth table. |
| `idx_event_reminders_sent_user_id` | `event_reminders_sent (user_id)` | User delete cascade; grows as events × users × reminder types. |
| `idx_event_voice_sessions_user_id` | `event_voice_sessions (user_id)` | User delete SET NULL; growth table. |
| `idx_player_co_play_user_id_b` | `player_co_play (user_id_b)` | Voter-activity OR predicate, plus user delete. |
| `idx_characters_game_id` | `characters (game_id)` | Games dedup reassign/delete loop; dedup audit count. |
| `idx_lfg_intents_converted_to_event_id` | `lfg_intents (converted_to_event_id)` | Event delete SET NULL; LFG "playing now" join. |
| `idx_availability_source_event_id` | `availability (source_event_id)` | Event delete FK check (NO ACTION). |
| `idx_availability_game_id` | `availability (game_id)` | Game delete FK check (NO ACTION). |
| `idx_activity_log_actor_id` | `activity_log (actor_id)` | User delete SET NULL; unbounded growth. |
| `idx_player_intensity_snapshots_longest_session_game_id` | `player_intensity_snapshots (longest_session_game_id)` | Weekly per-user growth; game dedup delete SET NULL. |

The longest name is 54 characters, under Postgres's 63-character identifier limit that `api/src/drizzle/constraint-name-length.spec.ts` enforces.

**Regression guard.** `api/src/drizzle/fk-index-coverage.spec.ts` runs the same leading-column rule against the latest snapshot. It asserts that the uncovered set equals a frozen allowlist of the 48 deferred columns (`DEFERRED_UNINDEXED_FKS`), so any **new** foreign key without a covering index fails CI. Adding a column to the allowlist then has to be a deliberate, reviewed change. The same function reports all ten columns above as uncovered when pointed at `0195_snapshot.json`, which proves the spec would have caught them.

## 5. Deferred long tail (48) and why

- **Lineup family (28 rows: `community_lineups` and every `community_lineup_*` table).** Row counts are bounded by the number of lineups, a community activity that runs a few times a month, not by history × users. Reads go through composite uniques that lead with the scope key (`lineup_id`, `match_id`, `slot_id`, `matchup_id`, `tiebreaker_id`). Lineups and matches are not deleted in normal operation, so the parent-delete cost only shows up on a user or game delete, against small tables.
- **Admin / audit tables (3 rows: `admin_actions.actor_id`, `games_dedup_audit.canonical_game_id`, `discovery_category_suggestions.reviewed_by`).** Operator-driven or job-driven writes with low volume.
- **Small per-user or bounded tables (16 rows).** `sessions`, `local_credentials`, `feedback`, `event_templates`, `pug_slots` (×2), `post_event_reminders_sent`, `post_event_followup_sent`, `wow_classic_quest_progress`, `lfg_invites.inviter_user_id`, `lfg_intents.converted_to_poll_id`, `game_interest_suppressions`, `event_plans` (×2), `discord_game_mappings`, `discord_channel_presence_occupancy`. Each holds a few rows per user, per match or per channel, so a sequential scan on parent delete costs about the same as an index probe.
- **`ai_request_logs.user_id` (1 row): deliberately not proposed.** ROK-1148 owns this table and added its read-path index in migration 0178. Any further index there belongs to that story.

`game_interests` does not appear in the findings at all. Its `game_id` foreign key is already covered by `idx_game_interests_game_id_source_user` (migration 0188, ROK-1109), and its `user_id` leads `uq_user_game_interest_source`. Nothing is proposed for it.

Revisit a deferred row when its table starts growing with history rather than staying bounded, or when prod stats (section 7) show RI-trigger time on a parent delete.

## 6. Deploy-time lock cost

Each `CREATE INDEX` here is a plain (non-concurrent) build. Postgres takes a **SHARE lock** on the table for the build: reads continue, but `INSERT`, `UPDATE` and `DELETE` block until the lock is released. Drizzle's migrator (`runDrizzleMigrate` in `api/scripts/run-migrations-with-sentry.ts:162`) wraps the whole pending-migration run in a single transaction (`drizzle-orm/pg-core/dialect.js`, `session.transaction`). As a result:

- `CREATE INDEX CONCURRENTLY` is impossible, because Postgres refuses it inside a transaction block.
- Each SHARE lock is held until the migration transaction commits, not only for that index's own build.

The largest tables in this set are `event_signups`, `event_reminders_sent`, `activity_log`, `event_voice_sessions` and `player_co_play`. At current prod sizes (a single-community deployment) this is acceptable: each build is one sequential pass over a single integer column, and the write-block window is the length of the migration run at deploy time. If one of these tables later reaches millions of rows, a future index on it should ship as its own migration outside the migrator transaction, built `CONCURRENTLY`. That needs a pre-step in `run-migrations-with-sentry.ts`, not a drizzle migration file.

## 7. Not done: needs prod stats

The other half of ROK-1157 needs production `pg_stat_*` data, which this PR cannot reach. It will come as a **separate PR behind operator review**. This PR contains **no `DROP INDEX`**.

| Item | What it needs | Why it is not here |
|---|---|---|
| Unused indexes | `pg_stat_user_indexes` rows with `idx_scan = 0` over 30+ days (check `pg_stat_database.stats_reset` first) | Dropping an index on a static guess is irreversible in effect; it needs real scan counts and an operator ruling per index. |
| Slow-query plans | Top 20 of `pg_stat_statements` by `total_exec_time` (the extension is installed by migration 0131), each run through `EXPLAIN (ANALYZE, BUFFERS)` | Plans depend on prod row counts and value distributions; standard seed data plans differently. |
| Composite column order | Check existing composite indexes against the predicates prod actually issues | Needs the same `pg_stat_statements` data. |

**Validation gap.** `validate-migrations.sh` ran against standard seed data only, not a clone of prod. Cloning prod needs operator authorization, so the migration has not been exercised against prod-shaped data. The PR body states this gap.

## Appendix: scanner

Run it from anywhere with the repo root as the first argument. An optional second argument names a snapshot file; without it the scanner uses the highest-numbered snapshot. Pointed at `0195_snapshot.json` it reproduces the section 2 numbers (58 uncovered); on the latest snapshot it reports the 48 deferred rows.

```python
import json, sys, re, glob, os

W = sys.argv[1]
meta = W + '/api/src/drizzle/migrations/meta/'
path = sys.argv[2] if len(sys.argv) > 2 else sorted(glob.glob(meta + '*_snapshot.json'))[-1]
tables = json.load(open(path))['tables']

# Raw-SQL CREATE INDEX from migrations (leading column), minus later DROP INDEX.
# Only migrations up to the snapshot's own number count, so an older snapshot
# is not credited with indexes that later migrations add.
upto = os.path.basename(path).split('_')[0]
raw = {}
for f in sorted(glob.glob(W + '/api/src/drizzle/migrations/*.sql')):
    if os.path.basename(f).split('_')[0] > upto:
        continue
    s = open(f).read()
    for m in re.finditer(r'CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF NOT EXISTS\s+)?"?(\w+)"?\s+ON\s+"?(?:public"?\."?)?(\w+)"?\s*(?:USING\s+\w+\s*)?\(\s*"?(\w+)"?', s, re.I):
        raw.setdefault(m.group(2), {})[m.group(1)] = (m.group(3), os.path.basename(f))
    for m in re.finditer(r'DROP\s+INDEX\s+(?:IF EXISTS\s+)?"?(?:public"?\."?)?(\w+)"?', s, re.I):
        for t in raw.values():
            t.pop(m.group(1), None)

missing, covered = [], 0
for t in tables.values():
    name, leads = t['name'], set()
    for ix in t.get('indexes', {}).values():
        cols = ix['columns']
        if cols and not cols[0].get('isExpression'):
            leads.add(cols[0]['expression'])
    for pk in t.get('compositePrimaryKeys', {}).values():
        leads.add(pk['columns'][0])
    for u in t.get('uniqueConstraints', {}).values():
        leads.add(u['columns'][0])
    for c in t['columns'].values():
        if c.get('primaryKey') or c.get('isUnique'):
            leads.add(c['name'])
    rawleads = {v[0]: k for k, v in raw.get(name, {}).items()}
    for fk in t.get('foreignKeys', {}).values():
        col = fk['columnsFrom'][0]
        if col in leads or col in rawleads:
            covered += 1
            continue
        missing.append((name, col, fk['tableTo'], fk['onDelete']))

print(os.path.basename(path), 'FKs', covered + len(missing), 'covered', covered, 'missing', len(missing))
for m in sorted(missing):
    print('MISSING', *m)
```

## References

- Story: [ROK-1157](https://linear.app/roknua-projects/issue/ROK-1157)
- Related: [ROK-1148](https://linear.app/roknua-projects/issue/ROK-1148) (`ai_request_logs`), [ROK-1109](https://linear.app/roknua-projects/issue/ROK-1109) (`game_interests`), [ROK-1156](https://linear.app/roknua-projects/issue/ROK-1156)
- Precedent: `docs/sentry-audit-2026-Q2.md`
