# Plan: Discord Text-Channel Lifecycle Automation

**Date:** 2026-08-21 (revised 2026-10-20 with the operator's game-driven rulings)
**Status:** draft — revised; detailed spec in `planning-artifacts/specs/ROK-1428.md` (gitignored, local) and the Linear epic body

## Problem Statement

Today, `channel_bindings` only maps a *manually created* Discord text/voice channel to a game (`bind()` in `ChannelBindingsService`, driven by the `/bind` command or the admin Channels page). Nothing creates or retires channels based on whether a game is actually being played. As the game catalog grows:

- Games that start getting activity have no dedicated channel until an operator notices and runs `/bind` manually.
- Games that go dormant keep a permanently visible, empty text channel cluttering the guild's channel list.

**The motivating case (operator, 2026-10-20):** a Baldur's Gate 3 group plays slowly for months. It organises through a handful of events and scheduling polls — and, once ROK-1870 lands, a community hub — but never gets a text channel because nobody runs `/bind`. "Activity" therefore cannot mean `events` only (the August draft): a game kept alive by polls and a hub is still a live game.

This plan designs **automated, game-driven text-channel lifecycle management**:

1. Derive per-game activity from **four signals** — scheduled events, polls (created or voted on), lineup votes, and community-hub activity.
2. **Create** `#<game-slug>` (in a configurable category, "Games" by default) once a game has its **2nd activity item within 30 days**, or has an **approved community hub**. Never on a single poll.
3. **Bind** the managed channel as the game's `game-announcements` channel AND as the linked channel of the game's hub(s) (the ROK-1788 mirror + the ROK-1868 relay). Manual overrides win.
4. **Archive** a managed channel after 30 days without activity (permission lock + move to the mandatory "Archived" category). **Unarchive** it on the next activity.
5. **Link the hub from Discord:** event, poll and lineup embeds carry a link to the game's hub page when one exists.

**Non-game channels are categorically out of scope (decided 2026-08-21, unchanged).** General/lobby channels, `general-lobby` bindings and unbound channels are never candidates. Reconciliation's binding candidate set is *only* `bindingPurpose = 'game-announcements' AND autoManaged = true AND recurrenceGroupId IS NULL`. Non-game channels are invisible to that query by construction, and a dedicated test asserts it.

## Affected Workspaces

- [x] `packages/contract` — shared types/schemas (additive only)
- [x] `api` — NestJS backend
- [x] `web` — React frontend
- [x] `tools/test-bot` — companion-bot smoke

## Prior Research (established, not re-derived here)

- `channelBindings` (`api/src/drizzle/schema/channel-bindings.ts:24-76`), `ChannelBindingsService` (`api/src/discord-bot/services/channel-bindings.service.ts`, `bind()` `:77`, private `upsertBinding()` `:123`, `getChannelForGame()` `:278`) and `ChannelBindingsController` (`api/src/discord-bot/channel-bindings.controller.ts`, `@Controller('admin/discord/bindings')` `:46`, `PATCH :id` `:176`) are the binding system to extend, not replace.
- Partial unique indexes `channel_bindings_nonseries_game_unique` / `_nullgame_unique` (`channel-bindings.ts:65-74`, ROK-1415/1416/1419) guard dedup. Every auto-bind goes through `bind()` → `upsertBinding()`. No parallel insert path.
- **Activity tables that carry a game id today:** `events.game_id` (`events.ts:62`, plus `cancelled_at` `:118`, `duration` tsrange `:67`, `is_ad_hoc` `:87`, hub tag `guild_id` `:142`); `community_lineup_matches.game_id` (the poll — standalone polls and lineup scheduling polls both hang off a match, `community-lineup-matches.ts:36`); `community_lineup_votes.game_id` (`community-lineups.ts:297`); `event_plans.game_id` (`event-plans.ts:31`, Discord-native time polls); `guilds.game_id` (`guilds.ts:29`, every hub).
- **Activity tables that reach a game only by join:** `community_lineup_schedule_votes` (slot → match → game, `community-lineup-matches.ts:157`); ROK-1868 `hub_posts` and ROK-1870 `hub_community_members` (→ `guilds.game_id`). **No table needs a new game-id column** — the joins are one or two hops on indexed FKs.
- The name `game_activity` is taken: `game_activity_sessions` / `game_activity_rollups` hold Discord-presence playtime (ROK-442). The derivation is therefore named **`game_lifecycle_activity`**. Presence playtime is NOT a signal (not in the ruling).
- No text-channel create/archive Discord.js code exists. `ephemeral-voice.discord-ops.ts` (`createVoiceChannel` `:24`, overwrites `:56-109`, `timedDiscordCall` from `scheduled-event.helpers`) is the pattern to mirror.
- Discord has no "archived" text channel (thread-only concept), hence the semantic in Technical Approach §3.
- `ephemeral-voice.scheduler.ts:37-70` + `CronJobService.executeWithTracking` (`api/src/cron-jobs/cron-job.service.ts:207`) is the periodic-reconciliation pattern (connectivity gate, settings gate, per-item try/catch + Sentry).
- `SETTING_KEYS` (`api/src/drizzle/schema/app-settings.ts:194-201`, the `EPHEMERAL_VOICE_*` group) + `settings-ephemeral.base.ts` is the admin-threshold pattern.
- **Category listing already exists:** `listGuildCategories()` (`discord-bot-client.guild.helpers.ts:110`) behind `GET …/categories` (`ephemeral-voice-settings.controller.ts:69`, `DiscordCategorySummaryDto`). The August draft's "not currently exposed" note is stale.
- **Hub linked channel:** `guild_profiles.discord_channel_id` (`guild-profiles.ts:41`) with `discord_channel_private_ack` / `_set_by` / `_set_at`; written by `GuildDiscordService.setChannel()` (`api/src/guilds/guild-discord.service.ts:78`) behind `GuildLeaderGuard` on `PUT guilds/:id/discord/channel` (`guild-discord.controller.ts:55`). ROK-1868's relay posts to the same column. Web picker: `web/src/components/hub/discord/guild-discord-picker.tsx:27` (initial choice = current bound id).
- **Embed builders:** event signup row `buildSignupButtons()` (`discord-embed-buttons.helpers.ts:5`, 4 buttons incl. "View Event"), `buildViewButton()` (`discord-embed.helpers.ts:161`), row selection `buildRowFor()` (`discord-embed.factory.ts:259-270`); scheduling-poll body `discord-embed-scheduling.helpers.ts:221,255,267` (masked `View poll →` links) with input `SchedulingPollEmbedData` (`discord-embed-scheduling.types.ts:33`); lineup channel embeds `lineup-notification-embed.helpers.ts` (`buildDecidedEmbed` `:181`, `buildEventCreatedEmbed` `:232`). Link-button precedent: `lfg-view-group-button.helpers.ts:26`.
- Admin UI: `discord-channels-page.tsx` + `ChannelBindingList.tsx` (bindings CRUD), `discord-features-page.tsx` (toggle + settings); nav `admin-nav-data.tsx:92-100`; routes in `web/src/app-routes.tsx` + `web/src/lazy-routes.ts` under `/admin/settings/discord/*`.

## Contract Changes

Additive only — every new field optional, nothing tightened. Lead-authored (lanes are denied `packages/contract/**`). `npm run build -w packages/contract` must succeed before api/web work begins.

- **`ChannelBindingSchema`** (`packages/contract/src/channel-bindings.schema.ts:23`) — optional fields: `lifecycleState: z.enum(['active','archived'])`, `autoManaged: z.boolean()`, `pinned: z.boolean()`, `archivedAt: z.string().nullable()`.
- **`UpdateChannelBindingSchema`** (`:51`) — `pinned: z.boolean().optional()`.
- **New `channel-lifecycle.schema.ts`** — `ChannelLifecycleSettingsSchema` (`enabled`, `recentActivityDays` default 30, `createThreshold` default 2, `gamesCategoryId`, `archiveCategoryId`, `hideOnArchive`, `maxChangesPerTick`) + a strict partial update variant; `GameActivitySignalKindSchema` (`event | poll | event_plan | lineup_vote | hub`); `GameLifecycleActivitySchema` (per-game signals with `lastActivityAt` and `itemCount`, plus the decision the reconciler would take); `ReconcileResultSchema` (counts + per-game items, also used for the dry-run preview); `LifecycleSuppressionSchema`.
- **`guild-discord.schema.ts`** (mirror DTO) — optional `channelSource: 'auto' | 'manual' | null` and `managedFor: { gameId, gameName } | null`, so the hub picker can say "Created by Raid Ledger for <game>".

## Technical Approach

### 1. Activity derivation — `game_lifecycle_activity` (ruling 1)

One query (a `UNION ALL` of per-signal sub-selects, built in TypeScript, not a DB view), grouped to one row per `(game_id, signal)` with `last_activity_at` and `item_count`, then folded to one row per game. An **activity item** is a distinct object, so a poll with twelve votes is still one item — that is what makes "never on a single poll" hold.

| Signal | Item | Counted when (window = `recentActivityDays`, default 30) | Game id |
|---|---|---|---|
| `event` | one `events` row, `cancelled_at IS NULL`, `is_ad_hoc = false` | `lower(duration) >= now() - window` (covers every upcoming event too) | direct |
| `poll` | one `community_lineup_matches` row with schedule slots | match created in window OR any `community_lineup_schedule_votes.created_at` in window | direct (match) |
| `event_plan` | one `event_plans` row | `created_at` or `poll_started_at` in window (votes are Discord-native, not stored) | direct |
| `lineup_vote` | one `(lineup, game)` pair | any `community_lineup_votes.created_at` for that game in window | direct |
| `hub` (behind ROK-1870) | one hub | a ROK-1868 post, a ROK-1870 join, or a proposal in window | via `guilds.game_id` |

Signals are a small registry (`GameActivitySignal[]`), so the hub signal is appended by a later layer without touching the others.

**Hub hold:** a game with an **approved (`active`) community hub** counts as active regardless of the window, and a managed channel that is a hub's linked channel is never archived while that hub is active.

### 2. Decisions per game (ruling 2)

- **Create** when no `game-announcements` binding exists for the game (manual or auto, series excluded), the game is not suppressed, and `item_count >= createThreshold` (default **2**) within the window OR the game has an active community hub.
- **Keep / unarchive** when `item_count >= 1` or a hub hold applies. The bar to stay or come back is lower than the bar to be created. That asymmetry is the only anti-flap mechanism. The "no hysteresis" ruling of 2026-08-21 stands for the archive boundary itself.
- **Archive** when the managed binding is `active`, not `pinned`, has no hub hold, and has zero items in the window.
- Manual bindings (`autoManaged = false`) and pinned bindings are never touched.

### 3. Archive semantic (decided 2026-08-21, unchanged)

| Approach | Decision |
|---|---|
| A. Permission lock — deny `@everyone` `SendMessages` (+ `ViewChannel` when `hideOnArchive`) | **Adopt** |
| B. Move to an "Archived" category | **Adopt, mandatory alongside A** |
| C. Rename with a prefix | Rejected (cosmetic, no access control) |
| D. Delete + recreate | Rejected (destroys history and pins) |

**The archive category is still a hard prerequisite**, with one 2026-10-20 change: on enable, if no category is chosen, the bot finds or creates one named "Archived" (and "Games" for the create category). Enabling is refused (400) only when the category can neither be found nor created. Discord caps a category at 50 channels, so the archive category overflows into "Archived 2", "Archived 3", and so on.

State (`lifecycleState`, `archivedAt`, `autoManaged`, `pinned`) lives in the DB, not re-derived from Discord permissions, so reconciliation stays idempotent and cheap.

### 4. Bindings and the hub's channel (ruling 3)

- On create: `createTextChannel` → `bind(… 'game-announcements' …)` with `autoManaged = true`.
- **Hub auto-link:** for every active `game_community` (ROK-1870) or `game_server` hub of the game whose `guild_profiles.discord_channel_id` is NULL, write the game's announcement channel (managed, or the operator's manual one) with a new `discord_channel_source = 'auto'`. WoW guild hubs are excluded. A Leader's `PUT …/discord/channel` writes `source = 'manual'` and is never auto-touched again (pinned semantics). The picker shows the auto value preselected, with a "Created by Raid Ledger for <game>" hint, and can be overridden.
- **Hand-deleted channel or unbound managed binding:** the binding is removed and a `channel_lifecycle_suppressions` row stops re-creation until an admin clears it ("Recreate").

### 5. Embeds reference the hub (ruling 4)

`resolveGameHubLink(gameId, taggedGuildId?)` → URL or null. Precedence: the event's tagged hub (`events.guild_id`) → the game's only active community hub → the game's server hub → several hubs → `/hubs?game=<id>` (label "Hubs") → none → nothing rendered.

| Embed | Where | Rendering | No-hub fallback |
|---|---|---|---|
| Event (signup / view rows) | `buildRowFor` → `buildSignupButtons` / `buildViewButton` | 5th Link button "Hub" (4 used today, max 5) | button omitted |
| Event, terminal states (no row) | — | none (row is dropped by design) | — |
| Scheduling / standalone poll | `discord-embed-scheduling.helpers.ts` link lines | masked `Hub →` beside `View poll →` (`SchedulingPollEmbedData.hubUrl?`) | line omitted |
| Lineup decided / event-created | `buildDecidedEmbed`, `buildEventCreatedEmbed` | masked `Hub →` line for the decided game | line omitted |
| Lineup building / voting (many games) | — | none in v1 | — |

### 6. Reconciliation loop (per tick)

1. Skip when the bot is offline, `enabled` is off, or no archive category resolves.
2. Compute `game_lifecycle_activity` once.
3. Per game (own try/catch, `Sentry.captureException` tag `channel-lifecycle-<phase>`): create → bind → hub auto-link, or unarchive, or archive, capped at `maxChangesPerTick` (default 10). The rest roll to the next tick.
4. Discord 10003 (unknown channel) → the suppression path in §4. 50013 (missing permissions) → stop the tick and record the cause on the settings health line (one Sentry event per tick, not per game).
5. Cadence: daily cron (04:15 UTC) + admin "Reconcile now" (with dry-run) + a debounced per-game nudge on activity writes. The nudge unarchives within a minute, so a new event's embed does not sit in a hidden channel until tomorrow.

## Milestones

Layer-level detail (files, turn budgets, test matrices) lives in the spec. The milestones map to the child stories as re-cut on 2026-10-20.

### M1 (ROK-1429): Contract + schema + settings
- **Workspace(s):** contract (Lead), api
- **Scope:** §Contract; migration adding `lifecycle_state`, `auto_managed`, `pinned`, `archived_at`, `restore_parent_id` to `channel_bindings` (+ CHECK, + partial index `WHERE auto_managed`); `guild_profiles.discord_channel_source`; new `channel_lifecycle_suppressions`; `SETTING_KEYS` `DISCORD_CHANNEL_LIFECYCLE_*` + typed getters (automation defaults **off**).
- **AC:** contract builds; migration validated on real Postgres + `fix-migration-order.sh --check`; getters return defaults.
- **Complexity:** S · **Dependencies:** none

### M2 (ROK-1430): Activity derivation + decision core
- **Workspace(s):** api
- **Scope:** `game_lifecycle_activity` with the event, poll, event-plan and lineup-vote signals (the hub signal is a registry slot left for M7); the pure `decideGame()` function.
- **AC:** each signal is counted per item, not per vote; a single poll never reaches the create threshold; cancelled events are excluded; ad-hoc (voice-presence) events COUNT (operator ruling 2026-10-20 — the 2-item create threshold is the guard against one-off lobbies); upcoming events count; series bindings and non-game bindings never appear as candidates.
- **Complexity:** M · **Dependencies:** M1

### M3 (ROK-1431): Discord ops + reconciliation loop
- **Workspace(s):** api
- **Scope:** `channel-lifecycle.discord-ops.ts` (`createTextChannel`, `archiveChannel`, `unarchiveChannel`, `ensureCategory` with overflow) and `channel-lifecycle.service.ts` + `.scheduler.ts` (cron, per-game isolation, caps, suppression on 10003, the 50013 stop) + the activity nudge.
- **AC:** create → bind through `bind()` only; archive and unarchive are exact inverses; one game's failure never blocks the others; a hand-deleted channel is not recreated.
- **Complexity:** L · **Dependencies:** M1, M2

### M4 (ROK-1432): Admin API
- **Workspace(s):** api
- **Scope:** `GET/PATCH /admin/discord/lifecycle/settings`, `GET …/activity`, `POST …/reconcile?dryRun=`, `DELETE …/suppressions/:gameId`, `pinned` on `PATCH /admin/discord/bindings/:id`; categories reuse the existing endpoint.
- **AC:** `AuthGuard('jwt') + AdminGuard` on every route; enable is refused without a resolvable archive category; the dry run writes nothing and matches the real run.
- **Complexity:** M · **Dependencies:** M3

### M5 (ROK-1433): Admin UI
- **Workspace(s):** web
- **Scope:** `/admin/settings/discord/lifecycle` (enable, two category pickers, thresholds, hide toggle, activity preview, Reconcile now); a lifecycle column + pin control on `ChannelBindingList` for auto rows only.
- **AC:** settings round-trip; manual rows show no lifecycle UI; verified in `default-dark` + `default-light`, desktop + phone.
- **Complexity:** M · **Dependencies:** M4

### M6 (NEW): Hub link — auto-link + embeds
- **Workspace(s):** api, web, contract (mirror DTO)
- **Scope:** §4 hub auto-link + picker preselect/override; §5 `resolveGameHubLink` + the embed changes. Ships for **server hubs and event hub tags today**; community hubs flow in once ROK-1870 lands.
- **Complexity:** M · **Dependencies:** M3 (auto-link), none (embeds)

### M7 (NEW, blocked by ROK-1870): Community-hub signal + creation on approval
- **Scope:** the `hub` signal (posts, joins, proposals), the hub hold, and a create nudge when a proposal is approved.
- **Complexity:** S · **Dependencies:** M2, M3, ROK-1870 (+ ROK-1868 for posts)

### M8 (ROK-1434, retitled): Smoke + fleet plan
- **Scope:** companion-bot smoke for create / archive / unarchive / embed hub link; Playwright for the admin page; fleet test plan; add `channel-lifecycle*` to the CLAUDE.md / TESTING.md smoke-trigger list. Unit and integration specs ship with each layer, not here.
- **Complexity:** M · **Dependencies:** M5, M6

## Risk Register

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Guild channel cap (500) / category cap (50) / burst rate limits after a bulk game import | Low | Medium | `maxChangesPerTick`; archive-category overflow; ROK-1332-style backoff on a 429 |
| Threshold flapping at the 30-day boundary | Low (create 2 / keep 1) | Low | the asymmetric bar; revisit hysteresis only if observed |
| Auto-create collides with a manual binding | Low (guarded) | High | `getChannelForGame`-equivalent pre-check + unique indexes as the backstop |
| Operator deletes a managed channel and the bot recreates it every day | Medium | Medium | suppression row on 10003 / on unbind of an auto binding |
| Auto-linking a hub overwrites a Leader's choice | Low | High | only writes when the hub's channel is NULL; `source='manual'` is never touched |
| Embed posted into a just-archived (hidden) channel | Medium | Low | activity nudge unarchives within ~60 s; the bot can still post |
| Permission lock bypassed by a role's explicit Allow | Medium | Low | documented limitation, shown in the admin copy |
| Reconcile touches a series binding | Low | High | `recurrenceGroupId IS NULL` in every query + an explicit test |
| Missing `AuthGuard('jwt') + AdminGuard` on a new route | Low | High | copy from `ChannelBindingsController`; integration 403 rows |
| The hub-dependent work (M6 community part, M7) waits on ROK-1870 | High | Low | isolated behind a signal registry and a hub resolver; M1–M5 ship without it |

## Open Questions

Resolved by operator decision (2026-08-21): archive = permission lock + category move, both mandatory · 30-day threshold · auto-unarchive · no hysteresis at the archive boundary · non-game channels never candidates.

Resolved by operator decision (2026-10-20): four activity signals (events, polls created/voted, lineup votes, community-hub activity) · RL creates `#<game-slug>` in a configurable "Games" category on the 2nd activity in 30 days or an approved community hub, never on a single poll · the managed channel is bound to both the game-announcements binding and the hub's linked channel, preselected and overridable, a manual override is honoured · event/poll/lineup embeds link the hub · build order decided after the spec.

Still open (recommendations in the spec):

- [x] Ad-hoc (voice-presence) events as a signal — **operator ruling 2026-10-20: INCLUDED** (an ad-hoc event is one `event` item like any other; the create threshold of 2 items in the window keeps a single spontaneous lobby from creating a channel).
- [x] **Active community hub (hold)** — operator ruling 2026-10-20, definition: a community hub is *active*, and holds its game's channel open, while (a) its status is `active` (approved, not archived) AND (b) it has had hub activity inside the lifecycle window (30 days): its approval, a leader post, a member join, or an event tagged to it. A hub with none of those for 30 days is *dormant*: it stops holding the channel (the channel then follows the normal signals) and its page shows the leader a "Quiet since <date>" note; archiving the hub releases the hold at once.
- [ ] Does an active community hub hold its channel open forever? — recommend **yes**, while the hub is active.
- [ ] Auto-link WoW guild hubs too? — recommend **no** (community + server hubs only).
- [ ] Rename the channel when the game is renamed? — recommend **no auto-rename** in v1.
- [ ] Pin expiry — recommend **none**. Cron cadence — recommend **daily + nudge**.
- [ ] Find-or-create the "Games" / "Archived" categories on enable (softens the 2026-08-21 hard-prerequisite rule) — recommend **yes**.
