# Spec: ROK-1242 — Out-of-date Version Banner on Admin Settings

**Plan:** No `docs/plans/` plan exists. Authoritative source = Linear story body (https://linear.app/roknua-projects/issue/ROK-1242). This spec also reconciles ROK-1242's intent against the pre-existing ROK-294 implementation.
**Date:** 2026-05-14
**Status:** draft

## Overview

Self-hosters drift versions behind without realizing. ROK-1242 asks for a passive, dismissible banner on the admin settings page that compares the running version against the latest GitHub release and links to the release notes.

**Important: most of this feature already shipped under ROK-294.** A backend `VersionCheckService` polls GitHub once on boot + daily at midnight UTC, caches results in `app_settings`, and exposes `GET /admin/update-status`. A React `<UpdateBanner />` is already mounted on `/admin/settings` via `web/src/pages/admin-settings-page.tsx:102`. This spec therefore scopes ROK-1242 as a **delta/gap-closure**: ship the small set of changes required to make the existing infrastructure satisfy ROK-1242's acceptance criteria verbatim, and decide the two open questions in the Linear body.

### Gaps to close (driven by ROK-1242 ACs)

1. **Release URL is wrong and not data-driven.** `UpdateBanner.tsx:24` hardcodes `https://github.com/sjdodge123/Raid-Ledger/Releases` (capital `R` → 404 redirect on GitHub). The banner should link to the **specific** `html_url` of the latest release, not a generic releases index. This requires plumbing `html_url` through the API + contract + settings store.
2. **Dismissal does not persist across the session.** `UpdateBanner.tsx:40` uses component-local `useState`, so the banner reappears on the next navigation back to `/admin/settings`. ROK-1242 AC explicitly says "dismissible for the session" — needs `sessionStorage` keyed by latest version (so a new release re-shows the banner).
3. **Pre-release handling decision (open question in Linear).** GitHub's `/releases/latest` endpoint already excludes pre-releases, so the current behavior is "stable only." Document this as the resolved decision; no code change.
4. **Server-side vs client-side caching (open question in Linear).** Already resolved by ROK-294: server-side cron + `app_settings` cache. Document as resolved; no code change.
5. **Test coverage.** No `version-check.service.spec.ts`, no `UpdateBanner.test.tsx`. Add unit/component tests so ROK-1242's ACs are regression-protected.

## Contract Layer (`packages/contract`)

Extend `UpdateStatusSchema` in `packages/contract/src/version.schema.ts` with the release URL so the frontend can render the deep link without hardcoding a URL.

    // packages/contract/src/version.schema.ts (additive)
    export const UpdateStatusSchema = z.object({
      currentVersion: z.string(),
      latestVersion: z.string().nullable(),
      updateAvailable: z.boolean(),
      lastChecked: z.string().nullable(),
      // ROK-1242: link to the specific GitHub release. Null when no release
      // has been fetched yet, the check failed, or the running version IS the
      // latest.
      latestReleaseUrl: z.string().url().nullable(),
    });

    export type UpdateStatusDto = z.infer<typeof UpdateStatusSchema>;

`VersionInfoSchema` is unchanged.

Rebuild contract after change: `npm run build -w packages/contract` (per `feedback_rebuild_contract_after_rebase.md`).

## NestJS Module Spec (`api`)

### Module Structure (unchanged from ROK-294)

- **Module:** `VersionModule` (`api/src/version/version.module.ts`)
- **Controller:** `VersionController` (`api/src/version/version.controller.ts`)
- **Service:** `VersionCheckService` (`api/src/version/version-check.service.ts`)
- **Storage:** `app_settings` rows via `SettingsService`

### New SETTING_KEY

Add to `api/src/drizzle/schema/app-settings.ts::SETTING_KEYS`:

    LATEST_RELEASE_URL: 'latest_release_url',

No migration required — `app_settings` is a key/value table; new keys are created on first `set()`.

### `GitHubRelease` interface

Extend in `version-check.service.ts:9`:

    interface GitHubRelease {
      tag_name: string;
      html_url: string;
    }

### `fetchLatestVersion` → `fetchLatestRelease`

Refactor to return both the normalized tag and the release URL:

    private async fetchLatestRelease(): Promise<{ version: string; htmlUrl: string | null } | null>

- On `200`: return `{ version: normalizeVersion(tag_name), htmlUrl: html_url }`.
- On `404` (no releases yet): fall through to `fetchLatestTag`, which returns `{ version, htmlUrl: null }` — tags don't have an `html_url` in the same shape.
- On `403 / 429 / network error / timeout`: return `null` (unchanged behavior).

### `storeVersionCheckResults` extended

Accept the release URL and persist alongside the existing three keys:

    private async storeVersionCheckResults(
      latestVersion: string,
      updateAvailable: boolean,
      latestReleaseUrl: string | null,
    ): Promise<void> {
      await Promise.all([
        this.settingsService.set(SETTING_KEYS.LATEST_VERSION, latestVersion),
        this.settingsService.set(SETTING_KEYS.VERSION_CHECK_LAST_RUN, new Date().toISOString()),
        this.settingsService.set(SETTING_KEYS.UPDATE_AVAILABLE, updateAvailable ? 'true' : 'false'),
        this.settingsService.set(SETTING_KEYS.LATEST_RELEASE_URL, latestReleaseUrl ?? ''),
      ]);
    }

`app_settings` values are strings; `''` denotes "no URL" (controller maps `''` → `null` in the DTO).

### API Endpoints

#### `GET /admin/update-status` (extended)

- **Description:** Returns version check results, including release URL.
- **Auth:** `AuthGuard('jwt')` + `AdminGuard`.
- **Request body:** none.
- **Response:** `UpdateStatusDto` (extended; `latestReleaseUrl: string | null` added).
- **Errors:**
  - `401` — missing/invalid JWT.
  - `403` — non-admin caller.
- **Behavior:** reads four `app_settings` keys in parallel. Maps stored `''` → `null` for `latestReleaseUrl`. Never throws on missing keys; always returns a well-formed DTO.

#### `GET /system/version` (unchanged)

### Drizzle Schema

No schema change. `app_settings` already exists and accepts arbitrary keys via `SETTING_KEYS`.

## React Component Spec (`web`)

### Component Hierarchy (unchanged shape, internals updated)

    AdminSettingsLayout (web/src/pages/admin-settings-page.tsx)
    └── UpdateBanner (web/src/components/admin/UpdateBanner.tsx)
        ├── BannerContent (inline)
        └── DismissButton (inline)

### State Management

- **Server state:** `useUpdateStatus(enabled)` in `web/src/hooks/use-version.ts` — already exists, no API change (consumes the wider `UpdateStatusDto` automatically).
- **Client state:** dismissal moves from `useState` → `sessionStorage`.
  - Key: `raid_ledger_update_banner_dismissed_v<latestVersion>` (e.g. `raid_ledger_update_banner_dismissed_v1.2.0`).
  - Setting key includes the latest version so a NEW release re-surfaces the banner even within the same browser session.
  - Read on mount, written on click.
- **Form state:** none.

### `UpdateBanner` updated behavior

- Hide when `!data?.updateAvailable`, when dismissed for THIS latestVersion, or when `data.latestVersion` is null.
- Link target: `data.latestReleaseUrl` when present, fall back to `https://github.com/sjdodge123/Raid-Ledger/releases` (lowercase) when null (e.g. when the cron fell back to the tags API and has no per-release URL).
- Link text: "View release notes" (clearer than "View releases on GitHub" when the URL is release-specific).
- `target="_blank" rel="noopener noreferrer"` retained.
- `aria-label="Dismiss update banner"` retained on close button.

### UI Components

- Tailwind only (`bg-amber-500/10`, `border border-amber-500/30`, etc.) — no new shadcn dependency.
- Accessibility:
  - Banner wrapper `role="status"` (non-blocking, polite announcement).
  - Close button keyboard-focusable (default `<button>` semantics suffice).
  - Color contrast: amber-300 on amber-500/10 background passes WCAG AA on dark theme (existing footprint).

## Behavior Specifications

### Scenario: Admin sees banner with current and latest version

- **Given** the running version is `1.0.0` and the latest GitHub release is `1.2.0`, and the daily cron has run.
- **When** an admin navigates to `/admin/settings`.
- **Then** the banner renders with text "A new version of Raid Ledger is available (v1.2.0). You are running v1.0.0." and a "View release notes" link whose `href` matches the `html_url` from the GitHub `/releases/latest` response.

### Scenario: Admin dismisses banner; it stays dismissed across navigation

- **Given** the banner is visible for latest version `1.2.0`.
- **When** the admin clicks the dismiss (X) button, then navigates to `/dashboard`, then back to `/admin/settings`.
- **Then** the banner does NOT reappear (sessionStorage key `raid_ledger_update_banner_dismissed_v1.2.0` is set to `"1"`).

### Scenario: New release re-surfaces banner after prior dismissal

- **Given** the admin previously dismissed the banner for `1.2.0` in this session.
- **When** the cron picks up `1.3.0` as the new latest, and the admin reloads `/admin/settings`.
- **Then** the banner reappears (different sessionStorage key — `..._v1.3.0` is not yet set).

### Scenario: No banner when versions match

- **Given** the running version is `1.2.0` and the latest GitHub release is `1.2.0`.
- **When** an admin navigates to `/admin/settings`.
- **Then** the banner does not render (`updateAvailable: false` from the API).

### Scenario: No banner when GitHub check failed

- **Given** GitHub was unreachable or rate-limited at the last cron tick, so `latest_version` in `app_settings` is null.
- **When** an admin navigates to `/admin/settings`.
- **Then** the banner does not render. The page renders normally; no error toast.

### Scenario: GitHub API is not called per-admin-page-load

- **Given** an admin is logged in.
- **When** they navigate to `/admin/settings` 10 times within 60 seconds.
- **Then** the API receives at most 1 call to `GET /admin/update-status` (React Query `staleTime: 60_000`). The GitHub API itself is called **once per 24h** via the backend cron, never from the browser.

### Scenario: Server-side fallback to tags API still renders banner

- **Given** the repo has no GitHub Releases, only tags, and the cron's `/releases/latest` returned 404 → `fetchLatestTag` returned `1.2.0` with `htmlUrl: null`.
- **When** an admin navigates to `/admin/settings`.
- **Then** the banner renders with version text, and the "View release notes" link falls back to `https://github.com/sjdodge123/Raid-Ledger/releases` (lowercase).

### Scenario: Non-admin does not trigger the admin endpoint

- **Given** a non-admin user.
- **When** they visit any non-admin page.
- **Then** `useUpdateStatus(enabled)` is gated by `isAdminCheck(user)` → `enabled: false` → no fetch, no banner. (The endpoint also returns 403 if hit directly.)

## Error Handling Matrix

| Error Condition                                | Error Type            | HTTP Status | User Message / Behavior                                    |
| ---------------------------------------------- | --------------------- | ----------- | ---------------------------------------------------------- |
| Non-admin calls `/admin/update-status`         | `ForbiddenException`  | 403         | None — UI never calls this endpoint for non-admins.        |
| Missing/invalid JWT                            | `UnauthorizedException` | 401       | None — global auth interceptor handles redirect.           |
| GitHub returns 403/429 (rate limited)          | Logged warning        | n/a         | Cron skips; `updateAvailable` stays at last good value or `false`. No banner if never succeeded. |
| GitHub returns 404 on `/releases/latest`       | Falls back to tags API | n/a         | Banner still renders (with fallback `releases` URL).       |
| GitHub network error / 10s timeout             | Logged warning        | n/a         | Cron skips; banner does not appear if never succeeded.     |
| `app_settings.latest_version` is null on read  | Returns null in DTO   | 200         | Banner hidden (`!data?.updateAvailable`).                  |
| `sessionStorage` unavailable (private mode)    | Caught + ignored      | n/a         | Falls back to in-memory `useState` dismissal (current behavior). |

## Testing

Per `TESTING.md` and the STRICT test-failure rules: every feature must include an end-to-end test. For ROK-1242:

### API unit (Jest, `api/src/version/version-check.service.spec.ts` — NEW)

- `fetchLatestRelease` returns version + html_url on 200.
- 404 falls back to `fetchLatestTag` and returns `htmlUrl: null`.
- 403/429 returns `null` and logs a warning (does not throw).
- Timeout (`AbortSignal`) returns `null` and logs a warning.
- `storeVersionCheckResults` writes four settings keys including `latest_release_url`.
- `isNewer` matrix: `1.0.0 < 1.0.1`, `1.0.0 < 1.1.0`, `1.0.0 < 2.0.0`, `1.0.0 === 1.0.0` (false), `2.0.0 > 1.0.0` (false from remote's perspective).
- Mock `fetch` per TESTING.md "Mocking external HTTP" pattern.

### API e2e (Jest, `api/src/version/version.controller.spec.ts` — NEW)

- `GET /admin/update-status` returns 401 without JWT.
- `GET /admin/update-status` returns 403 for non-admin JWT.
- `GET /admin/update-status` returns the four-field DTO with `latestReleaseUrl: null` when stored value is `''`.
- `GET /admin/update-status` returns `latestReleaseUrl: "https://github.com/..."` when stored.

### Web component (Vitest, `web/src/components/admin/UpdateBanner.test.tsx` — NEW)

- Renders text with both versions when `updateAvailable: true`.
- Link `href` matches `data.latestReleaseUrl` when present.
- Link falls back to `https://github.com/sjdodge123/Raid-Ledger/releases` when `latestReleaseUrl: null`.
- Dismiss click writes the version-scoped sessionStorage key.
- Mounting with that sessionStorage key pre-set renders nothing.
- A different `latestVersion` re-shows the banner even if a prior version's key is set.
- Returns `null` when `enabled: false` (non-admin) — MSW handler should NOT be hit.

### Playwright smoke (desktop + mobile)

Add to `tests/smoke/admin-settings.spec.ts` (new or extend existing):

1. Seed `app_settings` with `latest_version=999.0.0`, `update_available=true`, `latest_release_url=https://github.com/sjdodge123/Raid-Ledger/releases/tag/v999.0.0` via test-only setup (DEMO_MODE).
2. Log in as admin (DEMO_MODE prefilled creds).
3. Navigate to `/admin/settings`.
4. Assert banner is visible, contains "v999.0.0" and "View release notes" with the expected href.
5. Click dismiss, reload, assert banner is gone.
6. Run BOTH `--project=desktop` AND `--project=mobile` (per CLAUDE.md "Smoke Test Verification" rule).

## Dependencies

- **Contract:** `UpdateStatusSchema` extended with `latestReleaseUrl: z.string().url().nullable()`.
- **API internal:** `SettingsService` (existing), `CronJobService` (existing), `AdminGuard` (existing). New `SETTING_KEYS.LATEST_RELEASE_URL` constant.
- **Web internal:** `useUpdateStatus` hook (existing), `UpdateBanner` (existing, internals updated), `admin-settings-page.tsx` (mount point — no change).
- **External:** GitHub REST API `https://api.github.com/repos/sjdodge123/Raid-Ledger/releases/latest` (existing usage). Rate limit 60/hr unauthenticated; we call ≤1/day from a single egress IP, well under the limit.

## Out of Scope (explicitly deferred)

- Pre-release / RC opt-in: GitHub's `/releases/latest` already filters pre-releases; revisiting requires a UX surface (toggle in settings) and is not in ROK-1242's ACs.
- Showing the banner on pages OTHER than `/admin/settings`: ROK-1242 scopes it to admin settings only.
- "Update now" / one-click upgrade: this is an awareness banner, not an installer. Out of scope.
- Multi-tenant / per-user dismissal stored server-side: session-scoped client storage is sufficient and matches the AC.

## Acceptance Criteria Trace

| ROK-1242 AC                                                                                | Spec section                                  | Status after this spec |
| ------------------------------------------------------------------------------------------ | --------------------------------------------- | ---------------------- |
| Banner appears on admin settings only when current < latest                                | Scenario 1, 4                                 | shipped via ROK-294, no change |
| Displays current, latest, link to release                                                  | Contract + Web spec + Scenario 1              | **NEW: link is now data-driven via `latestReleaseUrl`** |
| Banner is dismissible for the session                                                      | Web spec (sessionStorage) + Scenario 2, 3     | **NEW: persists across navigation within session** |
| No banner when versions match or check fails                                               | Scenario 4, 5                                 | shipped via ROK-294, no change |
| GitHub API not called more than once per cache window per user                             | Scenario 6                                    | shipped via ROK-294 (server cron, 1/day globally) |
| Server-side vs client-side cached (open question)                                          | Overview                                      | **RESOLVED: server-side (already done in ROK-294)** |
| Pre-release tags considered (open question)                                                | Out of Scope                                  | **RESOLVED: stable only (GitHub default)** |
