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

Backups exclude the `drizzle` schema (migration metadata is code, not data) to prevent cross-branch hash drift. When restoring a backup or unsticking a drifted dev DB:

- **`DATABASE_URL=... node scripts/reconcile-migrations.mjs`** — probes each journal entry, skips any whose effects already exist (treats `column already exists`, `relation already exists`, etc. as idempotent), runs anything truly missing, and records the hash row. Safe to re-run. Add `--dry-run` to preview.
- `deploy_dev.sh` calls reconcile automatically after an auto-restore from `api/backups/daily/`.
- **Symptom that means you need reconcile:** `npm run db:migrate -w api` fails with `column/relation X already exists` on a migration whose hash isn't in `drizzle.__drizzle_migrations`.

## Restore drill — proving the backups actually restore

`scripts/backup-restore-drill.sh --dump-file <path>` restores a daily dump into a throwaway Postgres container **including its `drizzle` schema** (prod dumps keep the migration journal — ROK-1160 D4, operator ruling 2026-09-22; the dev dump path and the in-app restore still exclude it), verifies the restored journal against the image's migrations (`scripts/restore-drill-journal.mjs`: row count = journal entry count, newest hash = sha256 of the last `<tag>.sql`; `--migrations-dir` points it at the image's folder), reconciles the journal with the script above, runs five assertion tiers (A1 archive integrity → A5 sanitization), and with `--boot-check` starts the API on a free ephemeral port against the result and asserts `GET /health` (the root probe — the API sets no `/api` prefix). It writes `restore-drill-report.json` at the repo root (`--report <path>` to relocate): `status`, per-tier `findings`, and the restore/reconcile/boot timings. A backup that does not restore is a backup that does not exist.

- **It uses `reconcile-migrations.mjs` deliberately, NOT the programmatic migrator.** Dumps exclude the `drizzle` schema, so a restored DB has zero hash rows and `runMigrations` would replay from `0001` against a populated `public` schema and fail every week. The script header says this at length — do not "fix" it back.
- **On alert:** open the report artefact, read the failing tier. `A1` = the archive itself is bad (the container never started — suspect the backup pipeline, not the DB). `A2`–`A5` = the archive restored but its contents are wrong (missing tables, missing row data, sanitization drift). A `reconcile` exit 2 is a drill-harness bug, not a backup defect. A failed `journal-row-count` / `journal-latest-hash` (also tier `reconcile`) means the dump lacks the journal (pre-D4 or dumped on the dev path) or was taken on a different migration set than the image the drill ran against. Fix forward, then re-run the drill by hand against the same dump before declaring it clear.
- **To verify the failure path itself,** `POST /admin/test/backup/simulate-corruption` (`{"mode":"truncate"|"garbage"}`, DEMO_MODE + admin only) writes a deliberately bad `corrupt_*.dump` into `daily/` and returns its filename; point the drill at it and the run must fail with an `A1` finding. Those files show up in `GET /admin/backups` like any other dump — delete them when you are done. The endpoint is refused outside DEMO_MODE by design.
