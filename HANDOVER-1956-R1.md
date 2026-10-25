# ROK-1956 — R1 handover (review fix round 1)

Branch `feat/rok-1956-companion-ingest`. Nothing is red on the laptop. Commits: `163f9c911` (lock + ingest + registry), `75c92704e` (blobs service/repo/cleanup/module), `a58bdf765` (cleanup unit spec + integration cases), `387dbbd30` (+ amend) tech-debt.

## Findings
1. MAJOR fixed — `CompanionBlobService.alreadyStored`: row AND `companionBlobFileExists`; a row without its file → `repo.removeStale` (delete under the user lock) → normal upload (201).
2. MINOR fixed — `companion-blob-lock.ts`: ONE key per user, `pg_advisory_xact_lock(hashtext('companion-blobs:<uid>'))`. Taken by: blob `insert` (after the device `FOR SHARE`), `removeStale`, the messages tx in 11b (after the 11a device hold, only when the message has refs), every cleanup delete/unlink (per user, `repo.withUserLock`, predicates re-checked inside; files unlinked inside the lock window). Order: device row → blob lock; no tx takes two users' locks; cleanup takes no device rows. `insert` re-reads refs after the lock → `ref_mismatch` → 409. Cleanup SQL moved to `companion-blob-cleanup.queries.ts`. No catch-and-retry.
3. MINOR fixed — session blob PUTs need `registry.acceptsSessionBlobs()` (an active handler with `session` in `sources` AND `blobRefs`), else 401 `unauthorized`. `COMPANION_BLOB_TOTAL_MAX_BYTES` (default 10 GiB) pre-checked before streaming → 413 `blob_quota_exceeded` ("Blob storage is full"); pre-check only (no global lock), overshoot bounded by concurrent uploads × 4 MiB.
4. Backup note appended to `TECH-DEBT-BACKLOG.md`. Still needs a line in the PR body.
5. NIT skipped on purpose — device budget first means a runaway device spends only its own budget; charging the user budget first would let it drain the budget its sibling devices share.

## Evidence (laptop)
`npx jest src/companion` 232 pass; `tsc --noEmit -p api/tsconfig.json` clean; eslint 0 errors. Red first: 6 service-spec cases, ingest lock-order case (`Expected: {}, 7` not called). Cleanup spec mutation (unlink after release) fails: `"release:7:A=true:B=true"`.

## Specs to run on the fleet
- `api/src/companion/blobs/companion-blob.integration.spec.ts` (new: "R1 a row whose file is gone", "R1 session uploads need a handler opt-in"; I-21 re-proves the per-user cleanup SQL — `make_interval` typing, DISTINCT candidate queries still unverified on Postgres)
- `api/src/companion/ingest/companion-ingest.integration.spec.ts` (11b now takes the blob lock)
- unit: `src/companion/blobs/*.spec.ts`, `src/companion/ingest/companion-ingest.service.spec.ts`, `companion-handler.registry.spec.ts`
- Nest DI probe: `CompanionBlobsModule` now imports `CompanionIngestModule` (registry).

## Not done
No concurrency integration case for the shared lock (unit order + mutation only).
