# ROK-1475 part 2 — Handover

Branch `feat/rok-1475-part2`, worktree `/Users/sdodge/Documents/Projects/Raid-Ledger--rok-1475`.

## Done (committed)
- **OQ-1** `ci.yml` docker-build: `fetch-depth: 0` + `git describe --tags --abbrev=0 --match 'v*'` → `APP_VERSION` build-arg on the `:main` image. No Dockerfile change needed (ARG exists at `Dockerfile.allinone:610-611`).
- **Contract** `UpdateStatusSchema` + `fixesAvailable`, `runningCommitSha`, `latestCommitSha`, `fixesCompareUrl` (all nullable, required).
- **API** `VersionCheckService` runs both halves each cycle: feature (releases vs APP_VERSION → `update_available`) and build (compare API → `fixes_available`, only with COMMIT_SHA). Release fetch extracted to `release-check.ts`. `fetchCompare` + `countFixCommits` in `commit-freshness.ts`. Controller: `currentVersion` is now the semver (`getVersion()`), sha moved to `runningCommitSha`.
- **OQ-5** `countFixCommits`: first line, `fix`/`fix(scope)`/`fix!` then `:` or ` +` (two-type squash subject counts).
- **OQ-6** `POST /admin/test/seed-update-status` (DEMO_MODE + JWT + AdminGuard).
- Tests: `version-check.signals.spec.ts` (AC3 quadrants, mutation-verified), reworked `version-check.main-compare.spec.ts`, extended controller + commit-freshness specs, fixture spec.

## Deliberate deviations from the spec (flag to operator)
- The 30 h `isBehindMain` gate does NOT suppress the fixes count: "0 fixes / up to date" for a build that really lacks fixes would lie. `isBehindMain` stays exported + tested but is unused by the service.
- `commits[]` truncation (250) makes `fixCount` a lower bound; no "250+" rendering.

## NOT done — next
- **S4 web**: new `web/src/components/admin/BuildFixesNotice.tsx` (§4.12 count pill, indigo/emerald tint, tokens only; `0` → "up to date", `null` → render nothing), mounted beside `UpdateBanner` in `admin-settings-layout.tsx:47`; tests; verify default-dark AND default-light. `UpdateBanner` needs no logic change (currentVersion is semver now) — check its tests still pass.
- Fleet: `--full` gate (contract change), then a fleet test plan seeded via the fixture.
- Docs: README "Updates." could mention the fixes pill (optional).
