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

## Restore drill — proving the backups actually restore

`scripts/backup-restore-drill.sh --dump-file <path> --migrations-dir <dir>` restores a daily dump into a throwaway Postgres container **including its `drizzle` schema** (prod dumps keep the migration journal — ROK-1160 D4, operator ruling 2026-09-22; the dev dump path and the in-app restore still exclude it), verifies the restored journal against the image's migrations (`scripts/restore-drill-journal.mjs`: every journal entry's hash is present in `__drizzle_migrations` — extra historical rows, such as an orphaned draft hash, are noted but do not fail — and the newest restored hash = sha256 of the `<tag>.sql` with the greatest `when`), reconciles the journal with the script above, runs five assertion tiers (A1 archive integrity → A5 sanitization), and with `--boot-check` starts the API on a free ephemeral port against the result and asserts `GET /health` (the root probe — the API sets no `/api` prefix). It writes `restore-drill-report.json` at the repo root (`--report <path>` to relocate): `status`, per-tier `findings`, and the restore/reconcile/boot timings. A backup that does not restore is a backup that does not exist.

- **`--migrations-dir` is required** and must be the migrations of the **image that took the dump**, not this checkout (usually ahead of prod, which would fail the journal check every run). Extract them from the image: `cid=$(docker create <image:tag>) && docker cp "$cid:/app/drizzle/migrations" ./image-migrations && docker rm "$cid"`.
- **It uses `reconcile-migrations.mjs` deliberately, NOT the programmatic migrator.** Against a journal-complete D4 restore reconcile is a no-op; against a partial journal (a pre-D4 dump, a dev dump, or any hash gap) it probes each statement and skips what already exists, where `runMigrations` trusts the hash rows blindly and dies with "relation already exists". The journal check runs BEFORE reconcile, because reconcile inserts missing hashes and would hide the defect. The script header says this at length — do not "fix" it back.
- **On alert:** open the report artefact, read the failing tier. `A1` = the archive itself is bad (the container never started — suspect the backup pipeline, not the DB). `A2`–`A5` = the archive restored but its contents are wrong (missing tables, missing row data, sanitization drift). A `reconcile` exit 2 is a drill-harness bug, not a backup defect. A failed `journal-hashes-present` / `journal-latest-hash` (also tier `reconcile`) means the dump lacks the journal (pre-D4 or dumped on the dev path) or was taken on a different migration set than the `--migrations-dir` the drill ran against. Fix forward, then re-run the drill by hand against the same dump before declaring it clear.
- **To verify the failure path itself,** `POST /admin/test/backup/simulate-corruption` (`{"mode":"truncate"|"garbage"}`, DEMO_MODE + admin only) writes a deliberately bad `corrupt_*.dump` into `daily/` and returns its filename; point the drill at it and the run must fail with an `A1` finding. Those files show up in `GET /admin/backups` like any other dump — delete them when you are done. The endpoint is refused outside DEMO_MODE by design.
