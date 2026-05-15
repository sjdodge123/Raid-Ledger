# Spec: ROK-1243 — Quick Play Discord Embed Preserves Full Participant List

**Plan:** No `docs/plans/` plan exists. Authoritative source = Linear story body (https://linear.app/roknua-projects/issue/ROK-1243). This spec is a delta against the existing ROK-293 / ROK-612 / ROK-680 ad-hoc embed implementation and resolves ROK-1243's three Open Questions as design decisions.
**Date:** 2026-05-14
**Status:** draft

## Overview

When a Quick Play (internally: "ad-hoc") session is live, the Discord embed that's edited-in-place should be an **append-only historical record** of every Discord user who participated in the session. Today the participant list reads as currently-present rather than ever-present, so the final embed under-represents who actually played.

The infrastructure to render left participants with strikethrough already exists from ROK-680 (`signupMentions[].status: 'left'` → `~~<@id>~~` in `discord-embed.helpers.ts::formatMentionLine`). The bug is two-fold and concentrated in `ad-hoc-notification.helpers.ts::assembleEmbedData` plus the ROSTER header in `discord-embed.helpers.ts::buildRosterLine`:

1. **`signupCount` decrements as people leave.** `assembleEmbedData` sets `signupCount = active.length`. The `── ROSTER: 1/5 ──` header therefore drops to `0/5` even though three people played. The header should reflect cumulative participants (`participants.length`), not currently-active count.
2. **Spawn embed posts before any `status:'left'` ever appears, then the first leave triggers a 5s-batched edit-in-place.** During the 5s window after a leave, the embed is stale — the active count is wrong AND the leaver is not yet shown. If a participant joins-then-leaves WITHIN the 5s batch interval, the edit can land with both states merged, but if Discord rate-limits or `editEmbed` fails silently (see `editTrackedEmbed` line 264 — error is logged, not retried), the leaver is lost from the visible embed permanently. Today there is no resync path.
3. **`notifyCompleted` calls `toInactiveParticipants` which forces `isActive: false` for everyone** — that's correct for "the session is over," but combined with bug #1 the header now reads `── ROSTER: 0/5 ──` on the final embed, which is the worst possible historical record.

The fix is to (a) make the ROSTER header reflect cumulative participation, (b) ensure `signupMentions` always contains every participant (including those whose `leftAt IS NOT NULL`) and never gets filtered down, (c) add a final reconciliation read of the DB inside `notifyCompleted` so a missed mid-session edit cannot orphan a leaver, and (d) resolve the three Open Questions in the Linear body.

### Resolution of Open Questions (Linear body)

| Open Question | Decision |
|---------------|----------|
| Visually distinguish currently-present vs. left? | **Yes — strikethrough.** ROK-680 already ships this for `status:'left'`. We reuse it; no new visual surface. |
| Apply only after event starts, or from the moment the embed is posted? | **From the moment the embed is posted.** A Quick Play embed only exists once spawn fires (a member joined a bound voice channel), so "event start" == "embed post" anyway. The append-only rule applies the entire lifetime of the embed (LIVE → COMPLETED states). |
| Apply to scheduled raid events too? | **No — Quick Play only for ROK-1243.** Scheduled raid embeds reflect signup intent, not voice presence. A user un-signing-up from a scheduled raid SHOULD remove them from the embed; that is a different semantic. Out of scope. Track as a separate story if operator wants a similar append-only behavior on scheduled events. |

## Contract Layer (`packages/contract`)

No contract change required. `AdHocParticipantDto` (in `packages/contract/src/ad-hoc-roster.schema.ts`) already exposes `leftAt: string | null` and `totalDurationSeconds: number | null` — the API surface for active vs. left is sufficient.

Internal embed types (`EmbedEventData`, `AdHocParticipant`) live in `api/src/discord-bot/services/`; not part of the public contract. No `npm run build -w packages/contract` step needed.

## NestJS Module Spec (`api`)

### Module Structure (unchanged)

- **Module:** `DiscordBotModule` (`api/src/discord-bot/discord-bot.module.ts`).
- **Service:** `AdHocNotificationService` (`api/src/discord-bot/services/ad-hoc-notification.service.ts`) — edit-in-place logic.
- **Helpers:** `ad-hoc-notification.helpers.ts` — `assembleEmbedData`, `toActiveParticipants`, `toInactiveParticipants`.
- **Embed builder:** `discord-embed.helpers.ts::buildRosterLine`, `getMentionsForRole`, `formatMentionLine`.

### Drizzle Schema

No schema change. `ad_hoc_participants` already stores everything we need:

- `joined_at` (NOT NULL) — when the user FIRST appeared in this session.
- `left_at` (nullable) — most recent leave; cleared on re-join (`upsertParticipant`'s `onConflictDoUpdate` sets `leftAt: null`).
- `session_count` (NOT NULL, default 1) — number of join/leave cycles.
- `total_duration_seconds` (nullable) — sum across sessions.

The unique index `(event_id, discord_user_id)` guarantees one row per participant per event, so "the list of everyone who ever participated" == `SELECT ... FROM ad_hoc_participants WHERE event_id = $1`. No new column needed; the row simply must never be deleted mid-session. Confirmed by code audit: there is no `DELETE FROM ad_hoc_participants` outside of cascade-on-event-delete.

### Service-layer changes

#### Change 1 — `assembleEmbedData` in `ad-hoc-notification.helpers.ts`

Replace `signupCount = active.length` with `signupCount = participants.length`. Keep `signupMentions` populated for every participant (already correct). The semantic of `signupCount` for ad-hoc shifts from "currently active" to "cumulative participants in this session." The active count is still accessible via `signupMentions.filter((m) => m.status !== 'left').length` if any consumer needs it, but no consumer does today.

    // before
    signupCount: active.length,

    // after — cumulative participants (ROK-1243)
    signupCount: participants.length,

`maxAttendees` is untouched — it stays whatever the event row stores (typically `null` for ad-hoc since there's no signup cap). When `maxAttendees` is `null` and `signupCount > 0`, `buildRosterLine` already falls through to `── ROSTER: ${signupCount} signed up ──` which is exactly the wording we want; no header rewrite needed.

#### Change 2 — `toActiveParticipants` call site in `notifySpawn`

`notifySpawn` is only called for the FIRST joiner (line 97 of `ad-hoc-notification.service.ts`). At spawn time there is by definition exactly one active participant and zero left. Behavior unchanged.

#### Change 3 — `notifyCompleted` final reconciliation

`AdHocNotificationService.notifyCompleted` currently receives a pre-built participants array from the caller (`ad-hoc-event.handlers.ts::notifyCompleted` → `participantService.getRoster`). It then maps to `toInactiveParticipants` (force `isActive: false`). This is the only call site that drops the active/left distinction — and per the Linear AC, the FINAL embed is the most important historical record.

Two changes:

(a) Don't blanket-mark everyone inactive. Pass the real `leftAt` state through so `signupMentions` correctly reflects who left during the session vs. who was finalized by `participantService.finalizeAll`. Practically: everyone gets `status:'left'` on the completed embed anyway (since `finalizeAll` populates `leftAt` for the last-remaining members at session end), so the visible result is identical — BUT the data flow becomes consistent ("status:'left' iff DB says leftAt IS NOT NULL"), which makes the helper testable in isolation.

(b) Inside `notifyCompleted`, re-read `ad_hoc_participants` for `eventId` (one query, ≤ 50 rows in practice) BEFORE building the embed, so any participant who joined-and-left during the final 5s batch window is included. This is a reconciliation pass — cheap insurance against missed `processUpdate` flushes.

    // ad-hoc-notification.service.ts::notifyCompleted (after participantService.finalizeAll has run)
    const rows = await this.db
      .select()
      .from(schema.adHocParticipants)
      .where(eq(schema.adHocParticipants.eventId, eventId));
    const participants: AdHocParticipant[] = rows.map((r) => ({
      discordUserId: r.discordUserId,
      discordUsername: r.discordUsername,
      isActive: false, // all inactive on COMPLETED
    }));
    const embedData = await buildEmbedEventData(this.deps, eventId, participants);

Replaces the existing `const inactive = toInactiveParticipants(participants)` line. `toInactiveParticipants` stays as a helper for now but becomes unused; mark for cleanup in a follow-up to keep this PR scoped.

#### Change 4 — `processUpdate` already correct

`processUpdate` (line 218-237) already reads ALL `ad_hoc_participants` rows and sets `isActive: !r.leftAt`. No change required, but add a test asserting that a leaver appears in `signupMentions` with `status:'left'` after a single flush cycle (see Testing).

### API Endpoints

No HTTP API change. The Discord embed lifecycle is fully internal.

### Migrations

None. Existing schema covers the requirement.

## React Component Spec (`web`)

No web change. The active-vs-left distinction on `/events/:id` already renders cleanly via `AdHocRosterResponseDto` (`leftAt` + `totalDurationSeconds` per participant). The bug is purely on the Discord embed render path.

If the operator later wants the web Quick Play page to also show "all-ever-participated" prominently, that's a separate story (`/events/:id` currently shows a roster table with left timestamps, which is already correct historical behavior).

## Behavior Specifications

### Scenario: Single participant joins, leaves, embed reflects them as left

- **Given** Quick Play is enabled, a binding is configured for voice channel `#raid-1`, and the embed has been posted for the spawn.
- **When** the single member leaves `#raid-1` and 5 seconds elapse (one flush cycle).
- **Then** the edited embed shows `── ROSTER: 1 signed up ──` (cumulative count, not 0) and the one mention is rendered with strikethrough: `~~<@123>~~`. The grace period starts as today.

### Scenario: Two participants, one leaves mid-session, second stays

- **Given** users A and B are both in the voice channel, embed shows `── ROSTER: 2 signed up ──` with two un-struck mentions.
- **When** user A leaves and 5s elapse.
- **Then** the embed shows `── ROSTER: 2 signed up ──` (unchanged count), `~~<@A>~~` (strikethrough), `<@B>` (no strikethrough). Both are in the mention list; A is not removed.

### Scenario: Participant leaves then rejoins within the session

- **Given** user A joined, left (embed shows strikethrough), then rejoins the same voice channel before the grace period expires.
- **When** the rejoin handler fires (`handleJoinExisting` → `upsertParticipant` clears `leftAt` and increments `sessionCount`) and 5s elapse.
- **Then** the embed shows `── ROSTER: 1 signed up ──`, mention `<@A>` is NO LONGER struck through. The strikethrough state must follow the DB's `leftAt IS NULL` state. (Already correct today via `processUpdate`'s `isActive: !r.leftAt`, but pin with a test.)

### Scenario: Session completes — final embed lists everyone struck through

- **Given** users A, B, C all participated; A and B left mid-session, C was the last to leave (triggering grace period → finalize).
- **When** `finalizeEvent` runs and posts the COMPLETED embed.
- **Then** the embed shows `── ROSTER: 3 signed up ──` with all three mentions struck through (`~~<@A>~~`, `~~<@B>~~`, `~~<@C>~~`). The embed has no "View Event" / signup buttons (already correct via `EMBED_STATES.COMPLETED` branch in `buildEventEmbed`).

### Scenario: Mid-session edit-in-place fails silently — completion reconciliation rescues

- **Given** A and B participated; A's leave was queued for the batch flush but `editEmbed` threw (logged, not retried). Embed on Discord visibly shows A still active (stale).
- **When** B then leaves and `finalizeEvent` runs.
- **Then** the COMPLETED embed re-reads `ad_hoc_participants` for the event and shows BOTH A and B with strikethrough. No participant is permanently dropped from the historical record by a missed mid-session flush.

### Scenario: Participant who joined for <5s never gets an "active" frame in Discord, but appears in COMPLETED

- **Given** A joined the voice channel, the spawn embed posted with just A, then A left within 1s. No `processUpdate` flush has fired yet.
- **When** the grace period fires (default 60s) and `finalizeEvent` completes.
- **Then** the COMPLETED embed shows `── ROSTER: 1 signed up ──` with `~~<@A>~~`. (Today this would show `── ROSTER: 0 signed up ──` and effectively render an empty mention list — the historical record is lost.)

### Scenario: Cancellation deletes the embed message — append-only rule does NOT apply

- **Given** an admin cancels an in-flight ad-hoc event via `/events/:id` → cancel.
- **When** `EventLifecycleService` emits `APP_EVENT_EVENTS.CANCELLED`.
- **Then** the embed is replaced with the cancelled-state embed (existing behavior); append-only does not apply because the session is being annulled, not preserved. No change from current behavior.

### Scenario: Sibling scheduled event suppresses ad-hoc spawn — no embed, nothing to preserve

- **Given** there's an active scheduled event on a sibling binding for the same game.
- **When** a member joins a bound voice channel.
- **Then** `trySuppressForScheduled` returns true; no ad-hoc embed is posted; nothing to preserve. No change.

## Error Handling Matrix

| Error Condition | Error Type | Behavior |
|---|---|---|
| `editEmbed` fails (rate limit, network) during `processUpdate` flush | Logged warning (existing) | Embed stays stale until next flush. **Reconciliation pass in `notifyCompleted` rescues the historical record.** No user-visible cascade. |
| `editEmbed` fails during `notifyCompleted` reconciliation | Logged warning (existing) | Final embed is stale on Discord. Web Quick Play page (`/events/:id`) is the source of truth for participants and is unaffected. Captured in Sentry via the existing logger.error path. |
| `ad_hoc_participants` SELECT fails inside `processUpdate` or `notifyCompleted` | Logged warning | No edit; embed stays at last successful render. Same failure mode as today. |
| Participant row missing for an event (shouldn't happen — spawn always inserts) | Returns empty array | Embed shows `── ROSTER: 0 signed up ──` and mention value `'None'` (existing `buildAdHocSpawnEmbed` semantics). |

## Testing

Per `TESTING.md` and the STRICT test-failure rules, every behavior change needs an end-to-end path. The bug is API-only (Discord embed render), so the canonical test surface is:

### API unit (Jest, NEW + EXTEND)

1. **NEW: `ad-hoc-notification.helpers.spec.ts` — `assembleEmbedData` cumulative count**
   - Given two participants, one active + one with `isActive: false`, `assembleEmbedData` returns `signupCount: 2` (NOT 1).
   - Given zero participants (defensive), returns `signupCount: 0`.
   - `signupMentions` length always equals `participants.length`.
   - `signupMentions[i].status` is `'left'` iff `participants[i].isActive === false`.

2. **EXTEND: `discord-embed.helpers.left-status.spec.ts` (ROK-680)**
   - Add a case: when ALL mentions have `status: 'left'` (the COMPLETED-state shape after Change 3), every line is struck through and none is dropped. This pins the future behavior we're committing to.

3. **EXTEND: `ad-hoc-notification.service.spec.ts`** (file doesn't exist yet — see [`ad-hoc-notification.helpers.spec.ts`](../../api/src/discord-bot/services/ad-hoc-notification.helpers.spec.ts) for the helper-level coverage; if the service file is missing, add it as part of this story since the reconciliation read in Change 3 is service-level).
   - **Scenario: rejoin clears strikethrough.** Insert participant A with `leftAt = now`, queueUpdate, flush. Assert mention has `status:'left'`. Then clear `leftAt`, queueUpdate, flush. Assert mention has no `status` (or `signed_up`).
   - **Scenario: completion reconciliation rescues a missed flush.** Insert participants A (leftAt set) and B (leftAt set, simulating finalize). Call `notifyCompleted` directly — assert the SELECT runs (mock + verify), and assert `editTrackedEmbed` is called with mention list of length 2, both struck through.
   - **Scenario: edit-in-place failure does not throw.** Mock `clientService.editEmbed` to reject. Call `processUpdate`. Assert no exception bubbles and the logger.error is called.

### API integration (Jest, EXTEND `api/src/discord-bot/ad-hoc-events.integration.spec.ts`)

This file already exists and exercises the full join/leave/finalize flow against a real Postgres. Add one new test case:

- **"COMPLETED embed mentions every participant who ever joined."** Drive three members joining, two leaving mid-session (5s+ apart so each flush lands), the third triggering grace + finalize. After `finalizeEvent`, spy on `clientService.editEmbed` and assert the final call's embed `description` contains 3 mentions with strikethrough on all 3, and the ROSTER header reads `── ROSTER: 3 signed up ──`. Cap per `TESTING.md`: deterministic — use the existing test-bot drain helpers to flush BullMQ / 5s batch.

### Discord smoke test (companion bot, EXTEND `tools/test-bot/src/smoke/tests/ad-hoc*.test.ts` if present; else NEW)

Per CLAUDE.md "Discord Smoke Tests (MANDATORY)" rule — anything touching `api/src/discord-bot/**` requires a smoke test.

- **Smoke: "Quick Play embed preserves all participants."** Two test bots join a bound voice channel, embed posts (use `pollForEmbed` to assert content), bot 1 leaves (use `waitForEmbedUpdate` with predicate `embed.description.includes('~~<@<bot1-id>>~~')` and `embed.description.includes('ROSTER: 2 signed up')`), bot 2 leaves (waitForEmbedUpdate with predicate that BOTH mentions are struck through). Use `POST /admin/test/await-processing` to drain the BullMQ queue and `POST /admin/test/flush-notification-buffer` to skip the 5s batch wait between assertions.
- Do NOT use `sleep()` (per STRICT rule). Use `pollForEmbed` + `waitForEmbedUpdate` from `tools/test-bot/src/helpers/polling.ts`.
- Run BOTH the companion-bot smoke suite (`cd tools/test-bot && npm run smoke`) AND `./scripts/validate-ci.sh --full` locally before pushing.

### Playwright smoke (NOT applicable)

No web UI change. Skip Playwright for this story — the existing `/events/:id` page already displays the full roster correctly.

### Cheap experiment harness (optional, for the reconciliation race)

If the reconciliation pass introduces a perceived flake on full-suite runs, use `./scripts/spec-loop.sh ad-hoc-events.integration 50` per the STRICT flake-investigation protocol to characterize before designing a fix. Expected: 0/50 hits; if non-zero, the BullMQ flush + DB read ordering needs to be re-examined.

## Dependencies

- **Contract:** none. `AdHocParticipantDto` already sufficient.
- **API internal:**
  - `AdHocNotificationService` (`api/src/discord-bot/services/ad-hoc-notification.service.ts`) — Change 3 (reconciliation read in `notifyCompleted`).
  - `assembleEmbedData` in `ad-hoc-notification.helpers.ts` — Change 1 (`signupCount = participants.length`).
  - `discord-embed.helpers.ts::formatMentionLine` — unchanged; ROK-680 strikethrough already correct.
  - `discord-embed.helpers.ts::buildRosterLine` — unchanged; the `maxAttendees == null && signupCount > 0` branch already produces the right header text.
- **Web internal:** none.
- **External:** discord.js `EmbedBuilder.editMessage`-class behavior — already used; rate-limit handling is library-side. No new external dep.

## Out of Scope (explicitly deferred)

- **Append-only behavior on scheduled raid embeds.** Different semantic (signup intent, not voice presence). Separate story if requested.
- **"(left)" suffix instead of strikethrough.** Linear's first Open Question; resolved as "strikethrough." If operator prefers an explicit textual suffix, that's a one-line change in `formatMentionLine`. Track as follow-up.
- **Per-participant duration shown in the LIVE embed.** Today only the COMPLETED embed (via `buildAdHocCompletedEmbed`, NOT used in the current edit-in-place flow — see Note below) shows `(Xm)` next to mentions. Adding it to the LIVE embed is an unrelated UX call.
- **Sorting participants** (joined-first vs. left-first vs. alphabetical). Current behavior is insertion order from the DB scan. If sorting is wanted, separate story.

**Note on the unused `buildAdHocCompletedEmbed` factory method:** `DiscordEmbedFactory.buildAdHocCompletedEmbed` (line 212) is referenced but the `AdHocNotificationService.notifyCompleted` path uses `buildEventEmbed` (the standard layout) with `state = EMBED_STATES.COMPLETED` instead, per ROK-612 (edit-in-place rather than separate completion message). The completed helper appears unreferenced in the runtime path; track for tech-debt cleanup but do NOT delete in this story (out of scope, surface area to verify).

## Acceptance Criteria Trace

| ROK-1243 AC (Desired Behavior) | Spec section | Validation |
|---|---|---|
| Once a Quick Play session is underway, the embed's participant list should be append-only — names added when someone joins, never removed when they leave. | Change 1 + Change 2 + Scenarios 1, 2 | Unit test on `assembleEmbedData` + integration test asserting 3 mentions persist after 2 leaves. |
| The final embed should serve as a historical record of all participants for that session. | Change 3 + Scenario 4, 5, 6 | Service spec on `notifyCompleted` reconciliation + integration test asserting COMPLETED embed mentions all 3 participants with strikethrough. |
| Open Q 1: visually distinguish currently-present vs. left? | Overview "Resolution of Open Questions" → strikethrough (ROK-680) | Existing `discord-embed.helpers.left-status.spec.ts` + extended case. |
| Open Q 2: applies only after event starts, or from embed post? | Overview → from embed post (LIVE state) | Scenarios 1, 6 (`<5s leaver` case). |
| Open Q 3: same logic for scheduled events? | Out of Scope → no | N/A — explicitly excluded. |
