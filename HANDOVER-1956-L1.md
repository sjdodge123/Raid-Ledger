# ROK-1956 — L0 + L1 handover

Branch `feat/rok-1956-companion-ingest`. L0 + L1 are DONE; nothing is red. Next: L2 (registry + guards + bypass).

## Commits
- `f2ec3b132` L0 contract (additive)
- `ed79a5f3f` shared bounded body reader + Valheim wrapper
- `887d4f0c3` WebP header helpers
- `6010b22d4` Drizzle tables
- (last) migration `0258_companion_ingest` — provisional number; **renumber at build** (`git fetch origin && ./scripts/renumber-branch-migrations.sh`, then `fix-migration-order.sh --check`, `validate-migrations.sh`).

## Contract exports (`@raid-ledger/contract`, `companion-ingest-api.schema.ts`)
- `CompanionIngestErrorCodeSchema` += `unsupported_media`, `hash_mismatch`, `invalid_blob`, `blob_ref_mismatch`, `blob_quota_exceeded` (appended).
- `CompanionIngestErrorSchema` `{code, message≤200, currentVersion?, issues?}` + `CompanionIngestIssueSchema` `{path≤200, code≤40}`, `COMPANION_INGEST_ISSUES_MAX = 20`.
- `CompanionBlobAckSchema` `{status:'stored'|'exists', sha256}`.
- `CompanionConfigSchema` (+ `CompanionConfigLimitsSchema`, `CompanionConfigRateSchema`, `CompanionConfigContractSchema`) and their types.
- `companion-devices.schema.ts` now imports `COMPANION_DISPLAY_TEXT_RE`; `COMPANION_DEVICE_DISPLAY_TEXT_RE` is gone (no api/web users).
- schema.json unchanged (gen script emits only message schemas).

## Shared body reader — `api/src/common/bounded-body/bounded-body.reader.ts`
- `readBoundedBody(src: BoundedBodyStream, { maxBytes, contentType, errors: BoundedBodyErrors, rawContentType? })`.
- `BoundedBodyErrors = { tooLarge(), unsupported('content-encoding'|'content-type'), badGzip() }` — L2's `companion-ingest.errors.ts` supplies the companion factory; per Q10 its `badGzip` should return 400 `invalid_envelope`.
- Also exported: `headerOf`, `encodingOf(src, errors)`, `assertMediaType(src, want, errors, raw?)`, `assertDeclaredLength(src, max, errors)` — the blob reader (L5) uses these for its pre-read checks.
- Pass `maxBytes: COMPANION_MESSAGE_MAX_BYTES` for the global cap; the per-entry `maxBytes` is checked by L3 after lookup on the returned buffer length.
- `rawContentType` = whatever L2's `companion-body-bypass.ts` stashes off the headers.

## WebP — `api/src/companion/blobs/companion-webp.helpers.ts`
`WEBP_HEADER_BYTES = 30`, `parseWebpHeader(head, maxEdge) → {ok:true, format, width, height, riffSize} | {ok:false, reason}`, `webpSignatureSoFarOk(prefix)`, `riffLengthMatches(riffSize, total)`. Reasons are log-only; wire code is `invalid_blob`. Offsets verified on the fixture (VP8 1280×720) and sharp lossy/lossless/alpha output. VP8L also refuses version bits ≠ 0.

## Tables — `api/src/drizzle/schema/companion-ingest.ts` (exported from `drizzle/schema.ts`)
- `companionIngestLatest` → `companion_ingest_latest` PK (user_id, contract, latest_key); CHECK latest_key ≤ 128 (`COMPANION_LATEST_KEY_MAX_CHARS`).
- `companionBlobs` → `companion_blobs`, unique `companion_blobs_user_sha_uq` (user_id, sha256) — the `ON CONFLICT` target; `storage_path` (relative to root); `device_id` → companion_devices SET NULL; indexes on created_at, device_id. `COMPANION_BLOB_CONTENT_TYPE = 'image/webp'`.
- `companionBlobRefs` → `companion_blob_refs` PK (user_id, sha256, contract); no FK to blobs (either order).

## Deliberate choices
- Added `companion_blobs_device_id_idx` (not in spec §6) — required by `fk-index-coverage.spec.ts`.
- No `referenced_at` index on refs (spec lists none); L5 cleanup may want one → new migration.
- No routes, registry, guards (L2+).
