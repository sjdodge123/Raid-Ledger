# Plan: Discord Text-Channel Lifecycle Automation

**Date:** 2026-08-21
**Status:** draft

## Problem Statement

Today, `channel_bindings` only maps a *manually created* Discord text/voice channel to a game (`bind()` in `ChannelBindingsService`, driven by the `/bind` command or the admin Channels page). Nothing creates or retires channels based on whether a game is actually being played. As the game catalog grows, this means:

- Games that start getting scheduled activity have no dedicated announcement channel until an operator notices and runs `/bind` manually.
- Games that go dormant keep a permanently-visible, empty text channel cluttering the guild's channel list forever.

This plan designs **automated text-channel lifecycle management**: for every game with active/upcoming scheduled activity (`events` rows), ensure an unarchived text channel exists and is bound to it (`bindingPurpose: 'game-announcements'`); for games with no recent/upcoming activity, archive their auto-created channel. Operators get a new admin "controls" surface to tune thresholds, pin/override individual channels, and enable/disable the automation entirely.

**Non-game channels are categorically out of scope (decided).** Not every text channel is game-specific — general/lobby channels, announcement channels with `bindingPurpose: 'general-lobby'`, and any channel with no binding at all must never be touched by this automation, archived, or even considered as a candidate. This isn't an edge case to handle defensively; it's a hard scope boundary: reconciliation's candidate set is *only* bindings where `bindingPurpose = 'game-announcements' AND autoManaged = true` (see Technical Approach). A channel with no game-announcements binding, or a `general-lobby`-purpose binding, is invisible to the reconciliation query by construction — not filtered out after the fact. This is asserted as an explicit test case in M6, not left as an implicit consequence of the query shape.

## Affected Workspaces

- [x] `packages/contract` — shared types/schemas
- [x] `api` — NestJS backend
- [x] `web` — React frontend

## Prior Research (established, not re-derived here)

- `channelBindings` table (`api/src/drizzle/schema/channel-bindings.ts`) + `ChannelBindingsService` (`api/src/discord-bot/services/channel-bindings.service.ts`) + `ChannelBindingsController` (`api/src/discord-bot/channel-bindings.controller.ts`) are the binding system to extend, not replace.
- Two very recently hardened partial unique indexes guard dedup: `channel_bindings_nonseries_game_unique` (guild, channel, purpose, gameId WHERE recurrenceGroupId IS NULL AND gameId IS NOT NULL) and `channel_bindings_nonseries_nullgame_unique` (ROK-1415/1416/1419). Any auto-bind path MUST go through the existing `bind()` → `upsertBinding()` path (which already handles these via manual SELECT→INSERT/UPDATE, not `ON CONFLICT`) rather than inventing a parallel insert path.
- No "active game" concept exists. It must be derived fresh from `events` (`gameId`, `cancelledAt` soft-cancel, `duration` tsrange — see `api/src/drizzle/schema/events.ts`).
- No text-channel create/archive Discord.js code exists. `ephemeral-voice.discord-ops.ts` (voice channel create/delete) is the pattern to mirror — all calls wrapped in `timedDiscordCall`, Sentry-instrumented at the service layer, `guild.channels.cache` read with a fetch-fallback for cold cache.
- Discord.js has no "archived" state for text channels (thread-only concept) — this plan must pick a concrete semantic (see below).
- `ephemeral-voice.scheduler.ts` + `CronJobService.executeWithTracking` is the established periodic-reconciliation pattern (`@Cron`, gated on `clientService.isConnected()` + a settings-driven enable flag, per-item try/catch with `Sentry.captureException`).
- `settings-ephemeral.base.ts` + `settings-discord.helpers.ts` + `SETTING_KEYS` (`api/src/drizzle/schema/app-settings.ts`) is the established pattern for admin-configurable thresholds (e.g. `EPHEMERAL_VOICE_CATEGORY_ID`, `EPHEMERAL_VOICE_CREATE_BUFFER_MINUTES`).
- `discord-channels-page.tsx` (bindings CRUD) and `discord-features-page.tsx` (feature toggle + settings section) are the two existing admin UI patterns; routes registered in `web/src/app-routes.tsx` + lazy-loaded in `web/src/lazy-routes.ts` under `/admin/settings/discord/*`.

## Contract Changes

`packages/contract` changes must land and build (`npm run build -w packages/contract`) before any api/web work begins.

- **`ChannelBindingSchema`** (`packages/contract/src/channel-bindings.schema.ts`) — add three fields orthogonal to the existing `bindingPurpose`:
  - `lifecycleState: z.enum(['active', 'archived'])` — current archive state.
  - `autoManaged: z.boolean()` — true only for bindings this feature created; hand-created bindings (via `/bind` or the admin Channels page) are never touched by reconciliation.
  - `pinned: z.boolean()` — operator override; reconciliation skips archive/unarchive decisions for a pinned binding entirely.
  - `archivedAt: z.string().nullable()` — when the binding was last archived (null if never/currently active).
- **`UpdateChannelBindingSchema`** — add `pinned: z.boolean().optional()` so the existing PATCH endpoint can toggle the override without a new route.
- **New schema: `ChannelLifecycleSettingsSchema`** — `{ enabled: boolean; recentActivityDays: number; archiveCategoryId: string | null; hideOnArchive: boolean }`, plus a `UpdateChannelLifecycleSettingsSchema` (partial). Mirrors the existing ad-hoc-events settings DTO shape used by `useAdminSettings`.
- **New schema: `ReconcileNowResultSchema`** (optional, M6-stretch) — `{ created: number; archived: number; unarchived: number; skipped: number }` for the manual-trigger admin button's response/preview.

## Technical Approach

Two independent design decisions, then a straightforward reconciliation loop wired to a daily cron (mirroring the ephemeral-voice cron pair).

### 1. "Active game" derivation

A game is **active** iff it has at least one non-cancelled `events` row (`cancelledAt IS NULL`) whose `lower(duration)` (start time) is either:
- in the future (any upcoming event, no matter how far out), **or**
- within the last `recentActivityDays` (operator-configurable, **default 30 days** — decided) of "now".

This is a fresh SQL query — `lower(events.duration) >= now() - interval '<recentActivityDays> days'` OR `lower(events.duration) >= now()` — grouped by `gameId`, restricted to `gameId IS NOT NULL`. Scope is **game-level only**: bindings with a non-null `recurrenceGroupId` (series-specific overrides) are explicitly out of scope for this automation (see Open Questions #4) — they're a separate, already-curated feature and mixing the two risks the exact kind of dedup collision ROK-1415/1416/1419 just fixed.

A game is **inactive** iff it is not active AND currently has an `autoManaged=true`, `pinned=false`, `lifecycleState='active'` binding.

No hysteresis — a game flips active/inactive on the very tick it crosses the threshold (decided: v1 ships without consecutive-scan smoothing; revisit only if flapping is observed in practice).

### 2. Archive semantic (Discord.js has no native "archived" text channel)

| Approach | Pros | Cons | Decision |
|----------|------|------|----------|
| **A. Permission lock** — deny `@everyone` `SendMessages` (optionally also `ViewChannel` if "hide" is enabled) via `permissionOverwrites.edit`, no channel move | Simple, instantly reversible, preserves history/pins | Doesn't visually declutter the channel list on its own; a role with an explicit Allow overwrite bypasses the `@everyone` deny (documented limitation, not a bug) | **Adopt as the baseline mechanism** |
| **B. Move to an "Archived" category** | Visually groups archived channels, works well alongside A | Requires the operator to pre-create and configure a category before the feature can be used | **Adopt as mandatory alongside A (decided)** — `archiveCategoryId` must be configured before automation can be enabled at all; see "Archive category is a hard prerequisite" below |
| **C. Rename with a prefix (e.g. `🔒-archived-warcraft`)** | Cheap, visible in a flat channel list | Cosmetic only — does not actually restrict posting; easy to miss/undo by accident | Rejected as the primary mechanism (weak signal, no real access control) |
| **D. Delete + recreate on reactivation** | Fully declutters | **Destroys message history and pins** — unacceptable for a community channel; also means "archive" and "delete" become indistinguishable operations | Rejected |

Chosen: **A + B, both mandatory.** Store `lifecycleState`/`archivedAt`/`autoManaged`/`pinned` in the DB (not derived by re-reading Discord permission state every tick) so reconciliation stays idempotent and cheap — this is the same reason `events.ephemeralVoiceChannelId` is persisted rather than inferred from Discord.

**Archive category is a hard prerequisite (decided):** unlike the graceful-degradation design considered earlier, `ChannelLifecycleSettingsSchema.enabled` cannot be set `true` while `archiveCategoryId` is null. The settings PATCH endpoint (M4) validates this server-side (not just client-side UI guidance) — flipping `enabled: true` with no category configured returns a 400. This guarantees the channel list actually looks clean once automation is live, per operator decision.

### Reconciliation loop (per guild, per tick)

1. Skip entirely if the bot isn't connected, the `enabled` setting is off, or `archiveCategoryId` is unset (belt-and-suspenders — should be unreachable given the M4 validation, but the scheduler re-checks in case settings were edited directly).
2. Compute the active-game-id set (SQL above, `recentActivityDays` default 30).
3. For each active game with **no existing binding at all** for `(guildId, gameId, bindingPurpose='game-announcements', recurrenceGroupId=NULL)` → create a text channel (name from `games.slug`, already kebab-case-safe and unique) under the default/no category, `bind()` it with `autoManaged=true, lifecycleState='active'`.
4. For each active game whose existing binding is `autoManaged=true, pinned=false, lifecycleState='archived'` → **auto-unarchive** (decided: no operator confirmation step): clear the permission overwrite, move out of the archive category back to no-category, set `lifecycleState='active', archivedAt=null`.
5. For each inactive game whose existing binding is `autoManaged=true, pinned=false, lifecycleState='active'` → **archive**: apply the permission lock + move into `archiveCategoryId`, set `lifecycleState='archived', archivedAt=now()`.
6. Games with a **manually created** binding (`autoManaged=false`) or a **pinned** binding are never touched by 3–5 — reconciliation only ever creates new bindings or flips state on bindings it itself created.
7. Each game is wrapped in its own try/catch + `Sentry.captureException` (tag `channel-lifecycle-<phase>`) so one Discord API failure (rate limit, missing permissions) doesn't abort the whole batch — same shape as `EphemeralVoiceService`'s per-event error isolation.

## Milestones

### M1: Contract + Schema Foundation

- **Workspace(s):** contract, api
- **Scope:**
  - Contract: `lifecycleState`, `autoManaged`, `pinned`, `archivedAt` on `ChannelBindingSchema`; `pinned` on `UpdateChannelBindingSchema`; new `ChannelLifecycleSettingsSchema` + update variant.
  - api: one self-contained Drizzle migration adding the four columns to `channel_bindings` (`lifecycle_state varchar(20) NOT NULL DEFAULT 'active'`, `auto_managed boolean NOT NULL DEFAULT false`, `pinned boolean NOT NULL DEFAULT false`, `archived_at timestamp NULL`) plus a partial index on `(guild_id, binding_purpose, lifecycle_state) WHERE auto_managed` to support the reconciliation scan query.
  - api: new `SETTING_KEYS` group (`DISCORD_CHANNEL_LIFECYCLE_ENABLED`, `..._RECENT_DAYS`, `..._ARCHIVE_CATEGORY_ID`, `..._HIDE_ON_ARCHIVE`) + `settings-discord-lifecycle.helpers.ts` (pure getters, mirrors `settings-discord.helpers.ts`) + a `SettingsService` mixin base (mirrors `settings-ephemeral.base.ts`).
- **Acceptance Criteria:**
  - [ ] `npm run build -w packages/contract` succeeds with the new/extended schemas exported.
  - [ ] Migration applies cleanly via `./scripts/validate-migrations.sh`; `./scripts/fix-migration-order.sh --check` passes.
  - [ ] `SettingsService` exposes typed getters/setters for the four new keys with sane defaults (automation defaults to **disabled** until an operator opts in).
- **Complexity:** S
- **Dependencies:** none

### M2: Active-Game Derivation + Reconciliation Core

- **Workspace(s):** api
- **Scope:** `channel-lifecycle.db-helpers.ts` (active-game-id query, candidate-binding queries scoped to `autoManaged=true`), `channel-lifecycle.service.ts` (the create/archive/unarchive decision + orchestration described above, calling the existing `ChannelBindingsService.bind()`/`updateConfig()` — no parallel insert path), `channel-lifecycle.scheduler.ts` (`@Cron`, daily by default, `CronJobService.executeWithTracking`, gated on connectivity + enabled setting).
- **Acceptance Criteria:**
  - [ ] Active-game query correctly includes games with only-future events and only-recent-past events, excludes cancelled-only and stale-only games.
  - [ ] Reconciliation never creates a second binding for a game that already has one (manual or auto), verified against both partial unique indexes.
  - [ ] Reconciliation never mutates a `pinned=true` or `autoManaged=false` binding.
  - [ ] Reconciliation's candidate query never returns a `general-lobby`-purpose binding or a channel with no binding at all — non-game channels are structurally excluded, not filtered post-hoc.
  - [ ] One game's failure (simulated Discord error) does not block reconciliation of the others in the same tick.
- **Complexity:** L
- **Dependencies:** M1

### M3: Channel Lifecycle Semantic + Discord.js Ops

- **Workspace(s):** api
- **Scope:** `channel-lifecycle.discord-ops.ts` — `createTextChannel(guild, { name, parentId? })`, `archiveChannel(guild, channelId, { categoryId?, hide })` (permission overwrite edit + optional `channels.edit` parent move), `unarchiveChannel(guild, channelId, { restoreCategoryId? })`. All calls through `timedDiscordCall`, cache-then-fetch-fallback lookups, mirroring `ephemeral-voice.discord-ops.ts` exactly in shape.
- **Acceptance Criteria:**
  - [ ] `archiveChannel` denies `@everyone` `SendMessages` (and `ViewChannel` when `hide` is true) and is a no-op if the channel is already gone.
  - [ ] `unarchiveChannel` fully reverses the overwrite (does not leave a stale explicit-Allow that masks future guild-wide permission changes).
  - [ ] Category move only fires when a category id is configured; unset category id → permission-lock-only, verified by a test.
- **Complexity:** M
- **Dependencies:** M1

### M4: Admin API Surface

- **Workspace(s):** api
- **Scope:** Extend `ChannelBindingsController` (or a new `channel-lifecycle.controller.ts` alongside it) with: `GET/PATCH /admin/discord/lifecycle-settings`, `POST /admin/discord/lifecycle/reconcile-now` (manual trigger, reuses M2's service, returns the `ReconcileNowResultSchema` summary), and thread `pinned` through the existing `PATCH /admin/discord/bindings/:id` path (already accepts a partial patch shape — extend `resolveUpdateGameId`'s sibling logic to also apply `pinned` when present).
- **Acceptance Criteria:**
  - [ ] Settings GET/PATCH round-trip persists via `SettingsService`, guarded by `AuthGuard('jwt') + AdminGuard` like every other admin route in this controller.
  - [ ] `reconcile-now` runs the same code path as the cron tick (no divergent logic) and returns accurate counts.
  - [ ] `pinned` toggle persists and is reflected in `listBindings()`'s DTO output.
- **Complexity:** M
- **Dependencies:** M2, M3

### M5: Admin Controls UI

- **Workspace(s):** web
- **Scope:** New page (e.g. `discord-lifecycle-page.tsx`) at `/admin/settings/discord/lifecycle`, registered in `app-routes.tsx` + `lazy-routes.ts`, following the `discord-features-page.tsx` toggle-section pattern for the enable/disable switch and threshold inputs (recentActivityDays, archive-category select, hide-on-archive toggle), plus a "Reconcile now" button showing the returned summary. Extend `ChannelBindingList` (used by `discord-channels-page.tsx`) to show a lifecycle-state badge (Active/Archived) and a pin/unpin control on rows where `autoManaged=true` only — manually created bindings show no lifecycle affordance at all, avoiding UI confusion.
- **Acceptance Criteria:**
  - [ ] Automation can be enabled/disabled and thresholds edited from the page; changes persist and reflect on reload.
  - [ ] Archive-category selector requires the client to expose Discord categories (new capability on `DiscordBotClientService` / `useAdminSettings` — not currently exposed, since only text/voice channel lists exist today).
  - [ ] Pin/unpin control on a binding row updates immediately and is disabled while the mutation is pending, matching the existing `useBindingHandlers` pattern.
  - [ ] Non-`autoManaged` bindings render with zero lifecycle UI (no stray "Archived" badge on manually-created channels).
- **Complexity:** M
- **Dependencies:** M4

### M6: Test Coverage per TESTING.md

- **Workspace(s):** api, web, tools/test-bot
- **Scope:**
  - **Integration test** (not unit — tsrange `lower()` extraction isn't faithfully mockable) for the active-game derivation query: seed events with past-cancelled / past-uncancelled-stale / past-uncancelled-recent / future-near / future-far rows and assert the resulting active-game set, per `TESTING.md`'s "queries involving real DB behavior" guidance.
  - **Unit tests** for `channel-lifecycle.discord-ops.ts` (mock `discord.js` `Guild`, following `ephemeral-voice.discord-ops.spec.ts`) and for the create/archive/unarchive decision logic in `channel-lifecycle.service.ts` (drizzle-mock + mocked ops, following the flat-mock pattern in `TESTING.md`).
  - **Integration test** for the new admin endpoints (settings CRUD, pin toggle, reconcile-now) against a real DB, following the `settings.integration.spec.ts` exemplar.
  - **Migration validation** via `validate-migrations.sh` (auto-triggered by `validate-ci.sh` on a migration diff).
  - **Vitest** component tests for the new admin page (toggle behavior, threshold form validation, pin control) with MSW handlers for the new endpoints.
  - **Playwright smoke test** (`scripts/smoke/admin-discord-lifecycle.smoke.spec.ts`, desktop + mobile) — required because this is a new user-facing admin flow per `TESTING.md`'s UI-change row.
  - **Discord companion-bot smoke test** — the create/archive/unarchive path has real Discord-side effects (channel creation, permission overwrites, rate-limit behavior) that unit/integration coverage cannot verify. Recommend adding `channel-lifecycle*` to the smoke-trigger file list in `CLAUDE.md`/`TESTING.md` alongside `discord-bot/**`, and writing a new `tools/test-bot/src/smoke/tests/channel-lifecycle.test.ts` that seeds a fixture game + event, calls `reconcile-now`, and asserts a channel appears/gets locked via the companion bot's channel APIs.
- **Acceptance Criteria:**
  - [ ] All six test types above pass locally and the new spec files are wired into their respective runners (no orphaned test files).
  - [ ] `CLAUDE.md` / `TESTING.md` smoke-trigger tables updated to list the new lifecycle files (housekeeping, not a story-scope story — but required so future changes to this area actually get smoke-reviewed).
- **Complexity:** L
- **Dependencies:** M1–M5

## Risk Register

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Guild channel-count cap (500) or burst rate limits if many games flip active simultaneously (e.g. after a bulk game import) | Low | Medium | Batch the scan, reuse the existing `scheduledEventReconcileBackoffUntil`-style backoff pattern (ROK-1332) if Discord rejects a create/edit |
| Threshold flapping — a game oscillating right at the `recentActivityDays` boundary repeatedly archives/unarchives | Medium | Low-Med | Flag as Open Question #5 (hysteresis); not solved in this plan without operator input |
| Auto-create collides with a pre-existing manual binding for the same game | Low (guarded) | High if unguarded | M2 explicitly checks `getChannelForGame` equivalent before creating; unique indexes are the backstop |
| Permission-lock archive doesn't visually restrict a role with an explicit Allow overwrite | Medium | Low | Document as expected/known limitation, not a bug — surfaced in the admin UI copy |
| Reconciliation accidentally touches a series-scoped (`recurrenceGroupId` non-null) binding | Low (guarded by scope) | High (repeat of ROK-1415/1416/1419 class of bug) | M2 scopes every query to `recurrenceGroupId IS NULL`; add an explicit test asserting series bindings are never selected as candidates |
| New settings/admin routes forget the existing `AuthGuard('jwt') + AdminGuard` pattern | Low | High (auth bypass) | M4 explicitly copies the guard decorator from every existing route in `ChannelBindingsController` |

## Open Questions

Resolved by operator decision (2026-08-21):

- [x] **Archive semantic** — permission-lock + category move, both mandatory (not graceful-degradation-optional as first drafted). See "Archive category is a hard prerequisite" above.
- [x] **Default inactivity threshold** — 30 days.
- [x] **Reactivation behavior** — auto-unarchive on the next cron tick, no operator confirmation step.
- [x] **Hysteresis / anti-churn** — none for v1; flips on the first tick that crosses the threshold. Revisit only if flapping is observed in practice.
- [x] **Non-game channels** — categorically never candidates for archival (see Problem Statement); this was not in the original open-questions list but was flagged mid-review and is now a hard scope boundary with a dedicated M2/M6 test.

Still open — need operator input before M4/M5 implementation, but don't block starting M1–M3:

- [ ] **Scope boundary confirmation** — confirm game-level-only automation (never touching `recurrenceGroupId`-scoped series bindings) is correct, per the Technical Approach section above. (No pushback so far; treating as provisionally confirmed but flagging since it's a hard architectural boundary, not just a default.)
- [ ] **Pin expiry** — does a manual pin last forever until explicitly unpinned, or auto-expire after some period and resume normal automation? Recommend: no expiry for v1 (simplest; matches "no hysteresis" bias toward less state).
- [ ] **Cron cadence** — daily is proposed (channel churn is inherently low-frequency); does the operator want faster reaction time (e.g. hourly) at the cost of more Discord API calls?
