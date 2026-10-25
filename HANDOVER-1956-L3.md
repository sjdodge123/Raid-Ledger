# ROK-1956 — L3 handover (messages route)

Branch `feat/rok-1956-companion-ingest`. L3 is DONE and nothing is red. Next: L4 (messages integration spec) in parallel with L5 (blobs).

## Commits
- `d76ddf143` steps, latest-wins repo, service, controller, module, `companion.module.ts` import, unit specs
- `e5227138d` prettier fixes + the U-6 describe split

Evidence:
- `npx jest src/companion/ingest` (from `api/`): 90/90.
- `npx tsc --noEmit -p api/tsconfig.json` (from the repo root): clean.
- eslint: 0 errors. Three `max-lines-per-function` warnings on spec describes; one of them is L2's auth-guard spec.
- Nest DI preview probe: `DI_GRAPH_OK`. `CompanionSessionJwtGuard` resolves. The passport `jwt` strategy is registered globally by AuthModule's `JwtStrategy`, but whether it is reachable at runtime is only proved by L4.
- Mutations, each failing its own assertion: clock `<=` changed to `<`; resolve moved before lookup; stale not returned; path/body contract match removed.

## Files (`api/src/companion/ingest/`)
- `companion-ingest.controller.ts` handles `POST /companion/v1/messages/:contract` and returns 202.
  - Decorators: `@SkipThrottle @UseFilters(CompanionConnectionCloseFilter) @UseGuards(CompanionIngestAuthGuard, CompanionIngestRateLimitGuard)`.
  - Order: step 1 `assertContractParam`, which reads no body. Then `readBoundedBody(req, {maxBytes: COMPANION_MESSAGE_MAX_BYTES, contentType:'application/json', errors: companionBodyErrors, rawContentType: req[COMPANION_CONTENT_TYPE]})`. Then `service.ingest`.
  - It logs `user`, `device` and the status on any HttpException.
- `companion-ingest.steps.ts` holds the pure checks and composes them in `validateCompanionMessage(param, body, {table, resolve, now})`. Order:
  1. `parseEnvelope`: strict UTF-8 `TextDecoder`, then `JSON.parse`, then `CompanionEnvelopeSchema`.
  2. `assertContractMatches` (D-9).
  3. `specFor(lookupCompanionContract(...))`.
  4. `resolve` (null → 404 `unknown_contract`).
  5. `body.length > spec.maxBytes` → 413.
  6. `parseMessage` (`invalid_payload` + issues).
  7. `assertNotFromFuture`.

  `latestMarkerOf(handler, msg)`: an empty key, a key over 128 chars or a NaN date throws a plain `Error`, which becomes a 500.
- `companion-ingest.service.ts`: `ingest(auth, contract, body, now?)` validates first and only then opens `repo.transaction`. Inside it:
  1. **11a** `holdDevice`, device path only (a revoked device → 401).
  2. `advance` (when a marker exists; false → `stale`, the handler is not called).
  3. `handler.handle(ctx, msg)`.

  A handler throw propagates, so the transaction rolls back and the marker does not advance. The table comes from `@Optional @Inject(COMPANION_CONTRACT_TABLE)` (same token as the registry).
- `companion-ingest-latest.repository.ts` has `transaction(fn)`, `holdDevice(tx, {deviceId, tokenHash})` and `advance(tx, {userId, contract, key, at})`. `advance` is ONE statement: `INSERT … ON CONFLICT (user_id, contract, latest_key) DO UPDATE SET latest_at = excluded.latest_at, updated_at = now() WHERE companion_ingest_latest.latest_at < excluded.latest_at RETURNING user_id`. A row back means accepted. There is no catch-and-retry. The `setWhere` uses the Valheim snapshots-repo form (`${col} < excluded.x`); **L4 must prove it against a real DB** (equal `at` → stale, older → stale, newer → accepted).
- `companion-ingest.module.ts` imports `CompanionDevicesModule`. Its providers are the registry, both auth guards, the rate guard, the repo and the service. It **exports `CompanionHandlerRegistry`**. `CompanionModule` imports it.

## For L5 (blobs)
Two `// L5:` comments in `CompanionIngestService.commit` mark where the blob work goes:
- 11b: compare stored blobs with `handler.blobRefs(msg)` → 409 `blob_ref_mismatch`. This goes BEFORE the latest-wins advance.
- 11d: upsert `companion_blob_refs`. This goes AFTER the advance and before `handle`. A stale message records no refs.

Both must use the `tx`. `commit` is about 20 lines, so extract a helper rather than going past 30.

## For L4 (integration)
- No test handler exists outside specs (D-4: the ownership scan reads every non-spec `.ts`). Register it inside the integration spec: `app.get(CompanionHandlerRegistry).register('<an active plugin id>', handler)`. Note `resolve` checks `PluginRegistryService.isActive(owner)`, and sources default to `['device']`.
- A synthetic table (`test-retired`) needs `COMPANION_CONTRACT_TABLE` overridden on the test module. Both the registry and the service read it.
- I-cases to cover:
  - global cap 413 before parse
  - gzip
  - 415
  - path mismatch
  - version 404/409 + `currentVersion`
  - handler-less / inactive owner 404
  - per-contract 413
  - `invalid_payload`
  - clock
  - revoked device between guard and commit → 401
  - latest-wins equal/older/newer, per user
  - handler throw → 500 and the marker not advanced
  - impersonation session refused (L2; operator decision pending)

## Deliberate choices
- An invalid UTF-8 body counts as `invalid_envelope`, so the decoder is strict and never substitutes U+FFFD.
- The controller's error log prints the status only, not the code. The raw `:contract` is never logged (log-injection safety).
- The connection-close filter maps a handler throw to a generic 500. L4 should assert the body is generic.
