# ROK-1955 R1 — review fix round 1 handover

Merged origin/main (724f4c494, clean; 0257 still the top migration, journal order OK — no renumber). Contract rebuilt.

## Commits
- 3ed596b8d MAJOR 1 — guard refuses banned / kick-cooldown owners (same 401). Shared predicate `isBannedOrKickCoolingDown` in `api/src/auth/auth-status.helpers.ts`; jwt.strategy untouched.
- d63df20dd MINOR — contract: `COMPANION_DEVICE_DISPLAY_TEXT_RE` on name + osVersion; `CompanionLinkPreviewRequestSchema`. Regex copied verbatim from ROK-1954 `COMPANION_DISPLAY_TEXT_RE` (#1802, not on main); named differently so both `export *` from index cannot collide. Once #1802 lands: import it, delete the copy.
- c2d8b2ff8 MAJOR 2 — `decide` 403 for `impersonatedBy`; preview is now `POST /companion/v1/devices/link/preview {userCode}` (+ NotDeactivatedGuard, NIT). Scrub regexes keep `preview` readable.
- (this commit) MINOR — pending cap race-safe: `insertPendingCapped` = one tx, `pg_advisory_xact_lock(19552, hashtext(network ?? 'unknown'))`, count + `ON CONFLICT DO NOTHING` insert. Null network = ONE shared bucket (capped), not uncapped.

## Integration specs for the Lead (fleet, never run)
- `api/src/companion/devices/companion-devices.integration.spec.ts` — new T-API-18b/18c.
- `api/src/companion/devices/companion-device-link-decision.integration.spec.ts` — new burst test (8 concurrent starts, cap 3 → 3×200 + 5×409); preview now via POST.
- `api/src/companion/devices/companion-device-link-poll.integration.spec.ts` (unchanged, regression).

## Web/app follow-up
The approve page (L5) must call `POST …/link/preview` with `{ userCode }`, not `GET …/link/:code`.

## Skipped (reasons)
- ParseIntPipe > int4 → 500 (NIT): turn budget; one-liner for next round.
- IPv6 /64 keying of per-IP budgets, hex IPv4-mapped NIT: not one-liners; behaviour change to every budget.
- Owner display name in poll/self (reverse attack): contract + app scope, product call.
- Impersonation refusal on rename/revoke: brief scoped decide only.
- `verificationUriComplete` `/link?code=` still puts the code in the web page URL (access logs) — RFC 8628 shape; flag for the Lead.
- Migration CHECKs, T-API-9 race proof, invalid_grant budget NITs: not one-liners / harmless.
