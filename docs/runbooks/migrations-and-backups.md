# Migration state recovery + backup restore drill — reference

> Extracted from `CLAUDE.md` on 2026-09-18 to keep the always-loaded project
> instructions small. **The rules still live in CLAUDE.md** ("## Infrastructure
> Changes" → "Migration Generation Rules"): check journal order, validate
> against a real Postgres, never hand-edit migration SQL, one migration per
> schema change, migrations self-contained, boot-time scripts Sentry-instrumented.
> This file is the recovery procedure you reach for after something is already
> stuck. Not independent — do not add rules here.

## Why `db:migrate` uses the programmatic migrator (ROK-1343)

`npm run db:migrate -w api` runs `api/src/scripts/run-migrations.ts`, NOT the `drizzle-kit migrate` CLI. The CLI silently swallows SQL errors (upstream drizzle-team/drizzle-orm#5601, #5521, #5520); the programmatic runner propagates errors loudly via `drizzle-orm/postgres-js/migrator` and Sentry-captures any failure. The same wrapper is used by `validate-migrations.sh` and `backup.helpers::runMigrations`.

If a migration fails partially and you need to reconcile state by hand, use `scripts/recover-stuck-migration.sh <tag>` (idempotent, psql-only).

## Boot-time Sentry instrumentation — the pattern to copy

Any Node script running before NestJS bootstrap (migrations, bootstrap-admin, seed-igdb-games, re-encrypt-settings) must:

1. Import `../src/sentry/instrument` as the first statement (init must happen before any throw).
2. Wrap the script's main path in try/catch.
3. On error: `Sentry.captureException(err, { tags: { context: '<phase>' } })`, then `await Sentry.flush(2000)`, then `process.exit(1)`.

Copy `api/scripts/run-migrations-with-sentry.ts::reportBootFailure`. Boot-time scripts live in `api/scripts/` (not `api/src/scripts/`) because `nest build` compiles them to `api/dist/scripts/`, which the allinone image's docker-entrypoint expects at `/app/dist/scripts/<name>.js`. `process.exit` without `Sentry.flush` kills the event before the HTTP POST completes — invisible to alerting even when Sentry IS initialized.

## Migration state recovery

**Prod** dumps keep the `drizzle` schema, so a restore carries the migration journal (ROK-1160 D4, operator ruling 2026-09-22). The **dev** dump path and the in-app restore still exclude it (migration metadata is code, not data there, and excluding it avoids cross-branch hash drift), so a dev restore lands with zero hash rows. When restoring a dev backup, restoring a pre-D4 prod dump, or unsticking a drifted dev DB:

- **`DATABASE_URL=... node scripts/reconcile-migrations.mjs`** — probes each journal entry, skips any whose effects already exist (treats `column already exists`, `relation already exists`, etc. as idempotent), runs anything truly missing, and records the hash row. Safe to re-run. Add `--dry-run` to preview.
- `deploy_dev.sh` calls reconcile automatically after an auto-restore from `api/backups/daily/`.
- **Symptom that means you need reconcile:** `npm run db:migrate -w api` fails with `column/relation X already exists` on a migration whose hash isn't in `drizzle.__drizzle_migrations`.

## Two PRs claimed the same migration number

Two open PRs each generate "the next" migration on the same main, so both add `0239_*.sql`, journal idx 239 and `meta/0239_snapshot.json`. Whichever lands second collides. **`scripts/check-migration-index-collision.mjs`** catches it: the `Migration index-collision guard` step in `.github/workflows/ci.yml` (vs `HEAD^1`, the main tip on the merge ref) and `validate-ci.sh` → "Migration validation" (vs the `origin/main` tip, so it fires before you push). It fails when a branch-only journal entry's idx is at or below the base's newest, or the journal/folder has a duplicate idx or `NNNN` prefix, and prints the fix:

```bash
git fetch origin && ./scripts/renumber-branch-migrations.sh   # --base <ref>, --no-fetch
```

It takes the branch's **new** migrations (journal tags not on `origin/main`) and, in journal order from main's max idx + 1:

- renames each `NNNN_name.sql` (bytes untouched — it never edits SQL);
- rewrites the journal: main's entries verbatim, then the branch's with the new `idx`/`tag` and a `when` strictly after main's newest (so Drizzle never skips them);
- renames each branch snapshot and repoints its `prevId` — the first at main's last snapshot id, each next at the branch snapshot before it. Only the `"prevId"` line changes;
- writes any main migration file missing from the tree, so the folder matches main + the branch.

It refuses a dirty tree (commit first; never stash) and is idempotent — a branch already numbered after main prints `nothing to renumber`. Then:

1. Commit (`chore(migrations): renumber after origin/main`), then `git merge origin/main`. `_journal.json` **always** conflicts (both sides appended); keep ours, it already holds main's entries plus the branch's: `git checkout --ours api/src/drizzle/migrations/meta/_journal.json && git add` it. Every `.sql` and snapshot merges cleanly.
2. Re-run `./scripts/validate-migrations.sh`. A renumbered migration now runs **after** main's new ones; if its SQL depends on schema main changed, the real-Postgres run shows it.
3. **If both migrations changed `schema.ts`**, the branch's renumbered snapshot predates main's change, so the drift check (`validate-migrations.sh --drift-only`) wants main's DDL again. Rebuild that one snapshot on top of main: move the branch's `.sql` aside, delete its journal entry and snapshot, `npm run db:generate -w api` (`-- --custom --name <name>` for hand-written SQL), put the original SQL body back in the generated file, then `./scripts/fix-migration-order.sh --check`.

## Retention (ROK-1663)

Both kinds of dump live under `BACKUP_DIR` (`/data/backups` in both shipped topologies):

- **Daily dumps** (`daily/raid_ledger_*.dump`, 02:00 cron) are kept **30 days** (`DAILY_RETENTION_DAYS`).
- **Pre-migration snapshots** (`migrations/pre_migration_*.dump`) are written by `api/scripts/docker-entrypoint.sh` on **every** API start, whether or not migrations are pending. `BackupService` keeps only the newest **10** by mtime (`MIGRATION_SNAPSHOT_KEEP`), pruning once at boot and again in the 02:00 cron. `pre_restore_*` and `pre_factory-reset_*` in the same directory are operator-triggered safety nets and are never pruned — delete them by hand in Admin → Backups. A crash loop of more than 10 restarts rotates out the snapshot from before the bad boot; the daily dumps are the rollback floor.
- Both sit on the **same disk as PGDATA**: they are not a disaster-recovery copy, and a full disk stops Postgres. Off-site copies are the operator's job — download them from Admin → Backups.

## Restore drill — proving the backups actually restore

`scripts/backup-restore-drill.sh --dump-file <path> --migrations-dir <dir>` restores a daily dump into a throwaway Postgres container **including its `drizzle` schema** (prod dumps keep the migration journal — ROK-1160 D4, operator ruling 2026-09-22; the dev dump path and the in-app restore still exclude it), verifies the restored journal against the image's migrations (`scripts/restore-drill-journal.mjs`: every journal entry's hash is present in `__drizzle_migrations` — extra historical rows, such as an orphaned draft hash, are noted but do not fail — and the newest restored hash = sha256 of the `<tag>.sql` with the greatest `when`), reconciles the journal with the script above, runs five assertion tiers (A1 archive integrity → A5 sanitization), and with `--boot-check` starts the API on a free ephemeral port against the result and asserts `GET /health` (the root probe — the API sets no `/api` prefix). It writes `restore-drill-report.json` at the repo root (`--report <path>` to relocate): `status`, per-tier `findings`, and the restore/reconcile/boot timings. A backup that does not restore is a backup that does not exist.

- **`--migrations-dir` is required** and must be the migrations of the **image that took the dump**, not this checkout (usually ahead of prod, which would fail the journal check every run). Extract them from the image: `cid=$(docker create <image:tag>) && docker cp "$cid:/app/drizzle/migrations" ./image-migrations && docker rm "$cid"`.
- **It uses `reconcile-migrations.mjs` deliberately, NOT the programmatic migrator.** Against a journal-complete D4 restore reconcile is a no-op; against a partial journal (a pre-D4 dump, a dev dump, or any hash gap) it probes each statement and skips what already exists, where `runMigrations` trusts the hash rows blindly and dies with "relation already exists". The journal check runs BEFORE reconcile, because reconcile inserts missing hashes and would hide the defect. The script header says this at length — do not "fix" it back.
- **On alert:** open the report artefact, read the failing tier. `A1` = the archive itself is bad (the container never started — suspect the backup pipeline, not the DB). `A2`–`A5` = the archive restored but its contents are wrong (missing tables, missing row data, sanitization drift). A `reconcile` exit 2 is a drill-harness bug, not a backup defect. A failed `journal-hashes-present` / `journal-latest-hash` (also tier `reconcile`) means the dump lacks the journal (pre-D4 or dumped on the dev path) or was taken on a different migration set than the `--migrations-dir` the drill ran against. A missing hash for a mid-journal entry whose tables are ALSO absent is a merge-order skip (ROK-1693: the migrator never runs an entry older than the newest applied row); repair it with an idempotent migration that re-applies the DDL and back-fills the hash row in the same file (`0193_repair_skipped_0176_0174.sql` is the template), never a hand-inserted hash. Fix forward, then re-run the drill by hand against the same dump before declaring it clear.
- **To verify the failure path itself,** `POST /admin/test/backup/simulate-corruption` (`{"mode":"truncate"|"garbage"}`, DEMO_MODE + admin only) writes a deliberately bad `corrupt_*.dump` into `daily/` and returns its filename; point the drill at it and the run must fail with an `A1` finding. Those files show up in `GET /admin/backups` like any other dump — delete them when you are done. The endpoint is refused outside DEMO_MODE by design.
