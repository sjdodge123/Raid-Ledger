# ROK-1956 — L5 handover (blobs implementation)

Branch `feat/rok-1956-companion-ingest`. L5 is DONE; nothing is red. Next: L6 (`api/src/companion/blobs/companion-blob.integration.spec.ts`, I-14..I-21).

## Commits
- `76f7370f5` paths, streaming reader, repository
- `2728a50a8` upload service + verify-order unit spec
- `5cbd6e18e` controller, `CompanionBlobStore`, cleanup cron, module
- `a8e57742d` ingest 11b/11d wiring + `CompanionModule` import
- (last) store uses `FileHandle.createReadStream`, this handover

Evidence: `npx jest src/companion` (from `api/`) 203/203; `tsc --noEmit -p api/tsconfig.json` (repo root) clean; eslint 0 errors; Nest DI preview probe `DI_GRAPH_OK`.
Mutations, each failing its own assertion: quota pre-check removed; sha param check removed; 11b stored-blob check removed.

## Files (`api/src/companion/blobs/`)
- `companion-blob.paths.ts`: root `COMPANION_BLOB_DIR` else `/data/uploads/companion/blobs` (prod) or `<cwd>/uploads/companion/blobs`. Layout `<root>/<userId>/<sha256>.webp`, temps `<root>/<userId>/.upload-<16hex>.tmp` (`wx`), atomic `rename`. Builders throw on a non-positive-int user id or non-hex sha (no traversal).
- `companion-blob.reader.ts`: `assertBlobRequestHeaders` (415 encoding ≠ identity / type ≠ image/webp, 413 declared length > `COMPANION_WEBP_MAX_BYTES`), `readCompanionBlobToFile` (sha256 over every chunk, streamed cap 413, header refused on the first bad prefix byte or at 30 bytes BEFORE any write, RIFF length at EOF), `assertSharpAgrees` (`metadata()` only, `limitInputPixels` 4096²).
- `companion-blob.service.ts`: verify order 1 sha param (400 `hash_mismatch`) → 2 exists (200, body unread) → 3/4 headers → 5 quota pre-check (stored + declared > quota → 413 `blob_quota_exceeded`) → 6–8 stream → 9 server hash == path → 10 refs agree (409) → 11 sharp → 12 tx insert → 13 rename (fail: delete row + temp, generic 500) → 14 temp removed in `finally`.
- Quota: per user, bytes only, `COMPANION_BLOB_QUOTA_BYTES_PER_USER` (default 64 MiB). Authoritative re-check in the insert tx under `pg_advisory_xact_lock(hashtext('companion-blobs:<userId>'))`. Rate limits (per device + per user) are L2's guard, bucket `blobs`.
- `companion-blobs.repository.ts`: `find`, `usage`, `findRefs`, `insert(auth,row,quota)` → `stored|exists|revoked|quota_exceeded` (device path holds the device row first), `remove`, `releaseRefs`, cleanup deletes (raw SQL with aliases), `storedShas`. Pure tx helpers `storedBlobsIn` / `upsertBlobRefsIn` (ON CONFLICT (user, sha, contract) DO UPDATE dims + `referenced_at = now()`).
- `companion-blob-refs.helpers.ts`: `refsAgree`, `uniqueBlobRefs` (dedupe by sha; disagreeing duplicates → 409), `assertRefsMatchStored`.
- `companion-blob.store.ts`: exported `CompanionBlobStore.open(userId, sha)` → `{sha256, byteLength, width, height, contentType, stream}` or null (bad sha / no row / ENOENT); `releaseRefs(userId, contract, shas)`.
- `companion-blob.controller.ts`: `PUT /companion/v1/blobs/:sha256`, same guards/filter as messages + `@CompanionIngestRateBucket('blobs')`; `exists` sets `Connection: close`.
- `companion-blob-cleanup.service.ts`: `@Cron('0 35 4 * * *')` daily 04:35 inside `executeWithTracking('CompanionBlobCleanupService_purgeOrphans')`; `runOnce(now?)` is public for L6. Phases: unreferenced blobs > 24 h (row then file), dangling refs > 7 d, files/temps with mtime > 24 h and no row. Batches of 500, max 20 per phase.
- `companion-blobs.module.ts`: imports `CompanionDevicesModule`, `CronJobModule`; lists the ingest guards as its own providers; exports `CompanionBlobStore`, `CompanionBlobsRepository`. `CompanionModule` imports it.

## Ingest wiring (L3 files)
`CompanionIngestService.commit`: 11a device → **11b** `checkBlobRefs` (handler `blobRefs`, deduped; stored blob disagreeing → 409, before the advance) → 11c advance (stale returns, no refs) → **11d** `repo.recordBlobRefs` → handler. `CompanionIngestLatestRepository` gained `storedBlobs` / `recordBlobRefs` (delegate to the pure tx helpers; no module import between ingest and blobs).

## For L6 (prove on a real DB)
- I-14..I-21 per spec. Use `COMPANION_BLOB_DIR` = tmpdir; quota env for I-20; `app.get(CompanionBlobCleanupService).runOnce()` for I-21 (age rows with `UPDATE … created_at = now() - interval '25 hours'`, files with `utimes`).
- UNVERIFIED on Postgres: `make_interval(hours => $1)` / `(days => $1)` parameter typing in the cleanup SQL; the row-value `IN` in `deleteDanglingRefs`.

## Deliberate choices
- Two files beyond the L5 row: `companion-blob.paths.ts` (fs layout, keeps the store class small) and `companion-blob-refs.helpers.ts` (shared by both routes).
- Step 2 (`exists`) answers before the 415/413 checks, as §7.1 orders it.
- The header check fails on the first byte that can't start `RIFF????WEBP`, not only at 30 bytes.
- No cleanup unit spec: it is all DB + fs, so I-21 is the real proof.
- No `referenced_at` index (L1 note): cleanup batches are bounded; add one in a new migration if I-21 or prod shows a scan problem.
