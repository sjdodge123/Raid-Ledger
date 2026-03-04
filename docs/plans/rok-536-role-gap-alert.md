# Plan: ROK-536 — 4h Role Gap Alert

**Date:** 2026-03-04
**Status:** draft
**Linear:** [ROK-536](https://linear.app/roknua-projects/issue/ROK-536)

## Problem Statement

When an MMO rostered event is ~4 hours from starting and still missing required tank or healer slots, the event creator has no warning. They discover the gap too late to recruit replacements or adjust plans. This feature DMs the creator with an alert and deep links to cancel/reschedule modals on the web.

## Affected Workspaces

- [x] `packages/contract` — new notification type
- [x] `api` — role gap detection logic, cron hook, embed builder
- [x] `web` — deep-link query param handling for cancel/reschedule modals

## Contract Changes

- **`NotificationType` enum** — add `'role_gap_alert'` to `NOTIFICATION_TYPES` array in `api/src/drizzle/schema/notification-preferences.ts` (this is the source of truth, not in `packages/contract`)
- **No new Zod schemas needed** — the notification payload is `Record<string, unknown>` and doesn't require contract-level typing

## Technical Approach

Hook into the existing `EventReminderService` cron (runs every 60s). Add a new method that:
1. Queries MMO events starting in ~4 hours (3h45m–4h15m window)
2. For each candidate, counts `signed_up` roster assignments by role
3. Compares against `slotConfig` defaults (2 tank, 4 healer)
4. If gaps exist, DMs the **event creator** (not all attendees) via the standard notification pipeline
5. Deduplicates using `event_reminders_sent` with `reminderType = 'role_gap_4h'`

On the web side, add `?action=cancel` and `?action=reschedule` query param support to the event detail page, auto-opening the corresponding modal and pre-populating a suggested reason via `&reason=...`.

### Alternatives Considered

| Approach | Pros | Cons | Decision |
|----------|------|------|----------|
| Separate service class | Clean separation | More files, same cron | Rejected — fits naturally in EventReminderService |
| Alert all signed-up members | More visibility | Noisy, only creator can act | Rejected — creator-only per spec |
| Discord interactive buttons (cancel/reschedule in-DM) | No web redirect | Complex, reschedule logic is too rich for Discord | Rejected — deep-link to web modals |

## Milestones

### M1: Backend — Role Gap Detection & Alert

- **Workspace(s):** api
- **Scope:**
  1. Add `'role_gap_alert'` to `NOTIFICATION_TYPES` array and default channel config
  2. Add `role_gap_alert` embed handling in `DiscordNotificationEmbedService` (color, emoji, type label, fields, buttons)
  3. New private method `checkRoleGaps()` in `EventReminderService`:
     - Query events with `slotConfig.type === 'mmo'` starting in 3h45m–4h15m window
     - Filter out cancelled events (`cancelledAt IS NULL`)
     - For each event, query `roster_assignments` joined with `event_signups` (status = `'signed_up'`) to count assignments by role
     - Compare against `slotConfig` (defaults: tank=2, healer=4)
     - If tank or healer count is below required, build gap summary
  4. New private method `sendRoleGapAlert()`:
     - Dedup via `event_reminders_sent` with `reminderType = 'role_gap_4h'` (per event, creator userId)
     - Build notification with gap details, event info, and deep-link buttons
     - Send via `notificationService.create()` to event creator
  5. Call `checkRoleGaps()` from the existing `handleReminders()` cron, after the standard reminder windows loop
- **Acceptance Criteria:**
  - [ ] MMO events with unfilled tank/healer slots trigger a DM to creator ~4h before start
  - [ ] Only `signed_up` status signups are counted (not tentative/declined/roached_out)
  - [ ] Alert fires at most once per event (dedup via `event_reminders_sent`)
  - [ ] Cancelled events are excluded
  - [ ] Non-MMO events are excluded
  - [ ] Embed includes: event name, date/time, missing roles summary, current roster fill, action buttons
  - [ ] Buttons: View Event (deep link), Cancel Event (deep link), Reschedule (deep link), Adjust Notifications
- **Complexity:** M
- **Dependencies:** None

### M2: Frontend — Deep-Link Query Param Support

- **Workspace(s):** web
- **Scope:**
  1. Add `useSearchParams()` to `EventDetailPage` to read `?action=cancel|reschedule` and `&reason=...`
  2. When `action=cancel`, auto-open `CancelEventModal` once event data is loaded, pre-populate reason field
  3. When `action=reschedule`, auto-open `RescheduleModal` once event data is loaded, pre-populate reason field
  4. Clear query params after modal opens (replace URL state) to prevent re-triggering on refresh
  5. Update `CancelEventModal` to accept optional `initialReason` prop
  6. Update `RescheduleModal` to accept optional `initialReason` prop (if it has a reason field)
- **Acceptance Criteria:**
  - [ ] `?action=cancel` auto-opens cancel modal on page load
  - [ ] `?action=reschedule` auto-opens reschedule modal on page load
  - [ ] `&reason=...` pre-populates the reason textarea
  - [ ] Query params are cleared after modal opens
  - [ ] Only event creator/admin can trigger these actions (existing permission checks apply)
  - [ ] Direct URL access without auth redirects to login, then back to the deep link
- **Complexity:** S
- **Dependencies:** None (can be done in parallel with M1)

### M3: Backend Tests

- **Workspace(s):** api
- **Scope:**
  1. Unit tests for `checkRoleGaps()` method:
     - MMO event with full roster → no alert
     - MMO event missing 1 tank → alert with correct gap summary
     - MMO event missing 2 healers → alert with correct gap summary
     - Non-MMO event → no alert
     - Cancelled event → no alert
     - Event outside 4h window → no alert
  2. Unit tests for `sendRoleGapAlert()`:
     - First call → sends notification, returns true
     - Second call (dedup) → skips, returns false
  3. Unit test for embed builder: verify `role_gap_alert` type produces correct color, emoji, fields, buttons
- **Acceptance Criteria:**
  - [ ] All gap detection edge cases covered
  - [ ] Dedup logic tested
  - [ ] Embed output verified
- **Complexity:** S
- **Dependencies:** M1

### M4: Frontend Tests

- **Workspace(s):** web
- **Scope:**
  1. Test `EventDetailPage` with `?action=cancel` → verify cancel modal auto-opens
  2. Test `EventDetailPage` with `?action=reschedule` → verify reschedule modal auto-opens
  3. Test reason pre-population from `&reason=...`
  4. Test query param cleanup after modal open
- **Acceptance Criteria:**
  - [ ] Deep-link modal opening tested
  - [ ] Reason pre-population tested
  - [ ] Query param cleanup tested
- **Complexity:** S
- **Dependencies:** M2

## Risk Register

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Cron timing drift causes missed/double alerts | Low | Medium | 30-minute window (3h45m–4h15m) is generous; dedup table prevents doubles |
| `slotConfig` is null for some MMO events | Medium | Low | Fall back to genre-based MMO detection via `getSlotConfigFromGenre()` with standard defaults (2 tank, 4 healer) |
| Deep-link reason param too long for URL | Low | Low | URL-encode; truncate at 200 chars |
| Creator has Discord DMs disabled | Low | Low | In-app notification still created; standard unreachable flow handles Discord failures |

## Open Questions

- [x] Should the alert count tentative signups toward the fill? → **No**, only `signed_up` per spec
- [x] Should the Dismiss button be a Discord interactive button or just omitted? → **No Dismiss button.** The alert is fire-and-forget — creator sees it and acts or ignores. Dedup prevents re-sending.
- [x] Does `RescheduleModal` have a reason field to pre-populate? → **Yes, both modals.** RescheduleModal should also accept an `initialReason` prop for deep-link pre-population.
