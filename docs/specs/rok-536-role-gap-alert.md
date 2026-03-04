# Spec: ROK-536 — 4h Role Gap Alert

**Plan:** [docs/plans/rok-536-role-gap-alert.md](../plans/rok-536-role-gap-alert.md)
**Date:** 2026-03-04
**Status:** draft

## Overview

When an MMO rostered event is ~4 hours from starting and still missing required tank or healer slots, the system DMs the event creator with an alert. The embed includes the gap summary (which roles are short, by how many) and deep-link buttons to View Event, Cancel, Reschedule, and Adjust Notifications on the web app.

The detection logic hooks into the existing `EventReminderService` cron. Deduplication reuses `event_reminders_sent` with a new `reminderType = 'role_gap_4h'`. On the web side, the event detail page gains `?action=cancel|reschedule&reason=...` query param support to auto-open the corresponding modal with a pre-populated reason.

## Contract Layer (`packages/contract`)

No new Zod schemas required. The notification type enum lives in `api/src/drizzle/schema/notification-preferences.ts` (not in `packages/contract`), and the notification payload uses the existing `Record<string, unknown>` shape.

## NestJS Module Spec (`api`)

### 1. Notification Type Registration

**File:** `api/src/drizzle/schema/notification-preferences.ts`

Add `'role_gap_alert'` to `NOTIFICATION_TYPES` array (after `'recruitment_reminder'`):

```ts
export const NOTIFICATION_TYPES = [
  // ... existing types ...
  'recruitment_reminder',
  'role_gap_alert',  // ROK-536
  'system',
] as const;
```

Add default channel prefs (all channels enabled — this is a high-priority operational alert):

```ts
export const DEFAULT_CHANNEL_PREFS: ChannelPrefs = {
  // ... existing entries ...
  role_gap_alert: { inApp: true, push: true, discord: true },
  system: { inApp: true, push: false, discord: false },
};
```

### 2. Embed Builder Updates

**File:** `api/src/notifications/discord-notification-embed.service.ts`

#### Color mapping (`getColorForType`)

```ts
case 'role_gap_alert':
  return EMBED_COLORS.REMINDER;  // Amber #f59e0b — urgent/attention
```

#### Emoji mapping (`getEmojiForType`)

```ts
case 'role_gap_alert':
  return '\u26A0\uFE0F';  // Warning sign
```

#### Type label (`getTypeLabel`)

```ts
case 'role_gap_alert':
  return 'Role Gap Alert';
```

#### Type-specific fields (`addTypeSpecificFields`)

New case in the switch block:

```ts
case 'role_gap_alert':
  if (payload.eventTitle) {
    embed.addFields({
      name: 'Event',
      value: toStr(payload.eventTitle),
      inline: true,
    });
  }
  if (payload.gapSummary) {
    embed.addFields({
      name: 'Missing Roles',
      value: toStr(payload.gapSummary),
      inline: true,
    });
  }
  if (payload.rosterSummary) {
    embed.addFields({
      name: 'Roster',
      value: toStr(payload.rosterSummary),
      inline: true,
    });
  }
  break;
```

#### Primary button (`buildPrimaryButton`)

Add `'role_gap_alert'` to the existing event-type case that renders "View Event":

```ts
case 'event_reminder':
case 'new_event':
case 'subscribed_game':
case 'event_rescheduled':
case 'event_cancelled':
case 'recruitment_reminder':
case 'role_gap_alert':          // ROK-536
  if (eventId) {
    return new ButtonBuilder()
      .setLabel(input.type === 'new_event' ? 'Sign Up' : 'View Event')
      ...
```

#### Extra rows (`buildExtraRows`)

New case for `role_gap_alert` — renders Cancel and Reschedule link buttons:

```ts
if (input.type === 'role_gap_alert') {
  const clientUrl = await this.resolveClientUrl();
  const reason = input.payload?.suggestedReason
    ? encodeURIComponent(toStr(input.payload.suggestedReason).slice(0, 200))
    : '';
  const cancelUrl = `${clientUrl}/events/${toStr(eventId)}?action=cancel${reason ? `&reason=${reason}` : ''}`;
  const rescheduleUrl = `${clientUrl}/events/${toStr(eventId)}?action=reschedule${reason ? `&reason=${reason}` : ''}`;

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel('Cancel Event')
      .setStyle(ButtonStyle.Link)
      .setURL(cancelUrl),
    new ButtonBuilder()
      .setLabel('Reschedule')
      .setStyle(ButtonStyle.Link)
      .setURL(rescheduleUrl),
  );

  return [actionRow];
}
```

**Note:** `buildExtraRows` is currently synchronous. It needs to become `async` to call `resolveClientUrl()`, or the clientUrl can be passed in from the caller. The simplest approach is to pass clientUrl as a parameter (it's already resolved in `buildNotificationEmbed`). Change the signature:

```ts
private buildExtraRows(
  input: NotificationEmbedInput,
  clientUrl: string,
): ActionRowBuilder<ButtonBuilder>[] | undefined
```

Update the caller in `buildNotificationEmbed` to pass `clientUrl`.

#### Timestamp resolution (`resolveTimestamp`)

Add `'role_gap_alert'` to the `eventTypes` array so the embed footer shows the event start time:

```ts
const eventTypes: NotificationType[] = [
  'event_reminder',
  'new_event',
  'event_rescheduled',
  'event_cancelled',
  'subscribed_game',
  'recruitment_reminder',
  'role_gap_alert',  // ROK-536
];
```

### 3. Role Gap Detection — `EventReminderService`

**File:** `api/src/notifications/event-reminder.service.ts`

#### New constants

```ts
/** ROK-536: 4-hour role gap alert window. */
const ROLE_GAP_WINDOW = {
  type: 'role_gap_4h' as const,
  label: '4 Hours',
  /** Center of the window: 4 hours in ms */
  centerMs: 4 * 60 * 60 * 1000,
  /** Half-width: 15 minutes in ms (total window: 3h45m to 4h15m) */
  halfWidthMs: 15 * 60 * 1000,
};

/** Default required counts for MMO roles when slotConfig specifies them. */
const MMO_CRITICAL_ROLES = ['tank', 'healer'] as const;
```

#### New interface for gap results

```ts
interface RoleGap {
  role: string;
  required: number;
  filled: number;
  missing: number;
}

interface RoleGapResult {
  eventId: number;
  creatorId: number;
  title: string;
  startTime: Date;
  gameId: number | null;
  gaps: RoleGap[];
}
```

#### New method: `checkRoleGaps(now: Date)`

Called from `handleReminders()` after the standard reminder windows loop.

**Algorithm:**

1. Query candidate events:
   ```sql
   SELECT id, title, duration, creator_id, game_id, slot_config
   FROM events
   WHERE cancelled_at IS NULL
     AND slot_config->>'type' = 'mmo'
     AND lower(duration) >= (now + 3h45m)
     AND lower(duration) <= (now + 4h15m)
   ```
   Use parameterized bounds:
   ```ts
   const lowerBound = new Date(now.getTime() + ROLE_GAP_WINDOW.centerMs - ROLE_GAP_WINDOW.halfWidthMs);
   const upperBound = new Date(now.getTime() + ROLE_GAP_WINDOW.centerMs + ROLE_GAP_WINDOW.halfWidthMs);
   ```

2. For each candidate event, extract slot config via `slotConfigFromEvent()` pattern (inline, since it's private to SignupsService — duplicate the simple extraction logic here or extract to a shared utility):
   ```ts
   const config = event.slotConfig as Record<string, unknown>;
   const tankRequired = (config.tank as number) ?? 2;
   const healerRequired = (config.healer as number) ?? 4;
   ```

3. Batch query roster assignments for all candidate event IDs:
   ```sql
   SELECT ra.event_id, ra.role, COUNT(*) as count
   FROM roster_assignments ra
   INNER JOIN event_signups es ON es.id = ra.signup_id
   WHERE ra.event_id IN (...)
     AND es.status = 'signed_up'
     AND ra.role IN ('tank', 'healer')
   GROUP BY ra.event_id, ra.role
   ```

4. Compare filled vs required for each event. Build `RoleGap[]` for events with shortfalls.

5. For each event with gaps, call `sendRoleGapAlert()`.

#### New method: `sendRoleGapAlert(result: RoleGapResult, now: Date, defaultTimezone: string)`

1. **Dedup check:** Insert into `event_reminders_sent` with `ON CONFLICT DO NOTHING`:
   ```ts
   const dedup = await this.db
     .insert(schema.eventRemindersSent)
     .values({
       eventId: result.eventId,
       userId: result.creatorId,
       reminderType: 'role_gap_4h',
     })
     .onConflictDoNothing({
       target: [
         schema.eventRemindersSent.eventId,
         schema.eventRemindersSent.userId,
         schema.eventRemindersSent.reminderType,
       ],
     })
     .returning();

   if (dedup.length === 0) return false; // Already sent
   ```

2. **Build gap summary string:** e.g., `"Missing 1 tank, 2 healers"`
   ```ts
   const gapParts = result.gaps.map(g =>
     `${g.missing} ${g.role}${g.missing > 1 ? 's' : ''}`
   );
   const gapSummary = `Missing ${gapParts.join(', ')}`;
   ```

3. **Build roster summary:** e.g., `"Tanks: 1/2 | Healers: 2/4"`
   ```ts
   const rosterParts = result.gaps.map(g =>
     `${g.role.charAt(0).toUpperCase() + g.role.slice(1)}s: ${g.filled}/${g.required}`
   );
   const rosterSummary = rosterParts.join(' | ');
   ```

4. **Build suggested reason for deep-link:**
   ```ts
   const roleList = result.gaps.map(g => g.role).join('/');
   const suggestedReason = `Not enough ${roleList} — ${gapSummary.toLowerCase()}`;
   ```

5. **Format time:**
   ```ts
   const timezone = /* creator's timezone pref */ ?? defaultTimezone;
   const timeStr = result.startTime.toLocaleTimeString('en-US', {
     hour: 'numeric', minute: '2-digit', hour12: true,
     timeZoneName: 'short', timeZone: timezone,
   });
   ```

6. **Send notification:**
   ```ts
   await this.notificationService.create({
     userId: result.creatorId,
     type: 'role_gap_alert',
     title: 'Role Gap Alert',
     message: `Your event "${result.title}" starts in ~4 hours at ${timeStr} and still needs roles filled. ${gapSummary}.`,
     payload: {
       eventId: result.eventId,
       eventTitle: result.title,
       startTime: result.startTime.toISOString(),
       gapSummary,
       rosterSummary,
       suggestedReason,
     },
   });
   ```

#### Integration into `handleReminders()`

Add after the existing `for (const window of REMINDER_WINDOWS)` loop, inside the `cronJobService.executeWithTracking` callback:

```ts
// ROK-536: Check for role gaps on MMO events ~4h out
await this.checkRoleGaps(now, defaultTimezone);
```

**Note:** The existing `candidateEvents` query (lines 81-99) has an upper bound of 24 hours. The role gap check needs events at 4h, which is within this range, but the role gap query needs different fields (`slotConfig`, `creatorId`) and a different filter (`slotConfig->>'type' = 'mmo'`). Run a separate query for clarity and independence.

### 4. Dependencies to Inject

`EventReminderService` already has `NotificationService` and `SettingsService` injected. The new `checkRoleGaps` method needs access to:
- `schema.rosterAssignments` (already available via `schema` import)
- `schema.eventSignups` (already available)
- Creator's timezone preference (reuse existing `getUserTimezones()` method)

No new dependencies required.

## React Component Spec (`web`)

### Component Hierarchy (changes only)

```
EventDetailPage (existing)
├── ... existing components ...
├── CancelEventModal  ← add initialReason prop
└── RescheduleModal   ← add initialReason prop (no reason field currently — see below)
```

### Deep-Link Query Param Handler

**File:** `web/src/pages/event-detail-page.tsx`

#### New hook: `useDeepLinkAction`

Add inline in the page (not a separate file — it's page-specific):

```ts
import { useSearchParams } from 'react-router-dom';

// Inside EventDetailPage:
const [searchParams, setSearchParams] = useSearchParams();
const deepLinkAction = searchParams.get('action');  // 'cancel' | 'reschedule' | null
const deepLinkReason = searchParams.get('reason');   // pre-populated reason or null
```

#### Auto-open logic

Add a `useEffect` that triggers when event data loads and a deep-link action is present:

```ts
useEffect(() => {
  if (!event || !deepLinkAction) return;
  // Only allow creator or admin to use deep-link actions
  if (!isCreatorOrAdmin) return;

  if (deepLinkAction === 'cancel') {
    setShowCancelModal(true);
  } else if (deepLinkAction === 'reschedule') {
    setShowRescheduleModal(true);
  }

  // Clear query params to prevent re-trigger on refresh
  setSearchParams({}, { replace: true });
}, [event, deepLinkAction]);
```

#### `CancelEventModal` — `initialReason` prop

**File:** `web/src/components/events/cancel-event-modal.tsx`

Add optional prop:

```ts
interface CancelEventModalProps {
  isOpen: boolean;
  onClose: () => void;
  eventId: number;
  eventTitle: string;
  signupCount: number;
  initialReason?: string;  // ROK-536: Deep-link pre-population
}
```

Initialize state from prop:

```ts
const [reason, setReason] = useState(initialReason ?? '');
```

Add `useEffect` to update when prop changes (modal re-open with different reason):

```ts
useEffect(() => {
  if (initialReason) setReason(initialReason);
}, [initialReason]);
```

#### `RescheduleModal` — `initialReason` prop

**File:** `web/src/components/events/RescheduleModal.tsx`

The RescheduleModal currently does **not** have a reason/note field. For ROK-536, we do **not** add one — the reschedule action is a time picker, not a reason form. The `initialReason` prop will be accepted but unused for now (reserved for future enhancement). The deep link simply auto-opens the modal.

```ts
interface RescheduleModalProps {
  // ... existing props ...
  initialReason?: string;  // ROK-536: Reserved for future use
}
```

#### Passing props from EventDetailPage

Update the modal renders in `event-detail-page.tsx`:

```tsx
<CancelEventModal
  isOpen={showCancelModal}
  onClose={() => setShowCancelModal(false)}
  eventId={eventId}
  eventTitle={event.title}
  signupCount={event.signupCount ?? 0}
  initialReason={deepLinkReason ?? undefined}
/>

<RescheduleModal
  isOpen={showRescheduleModal}
  onClose={() => setShowRescheduleModal(false)}
  eventId={eventId}
  // ... existing props ...
  initialReason={deepLinkReason ?? undefined}
/>
```

### State Management

- **No new TanStack Query hooks** — uses existing event data
- **No new Zustand stores** — modal state is local `useState`
- **No new form state** — `CancelEventModal` already uses controlled `useState` for reason

### UI Components

- No new Shadcn components
- No new accessibility requirements beyond existing modal a11y (focus trap, ESC key)

## Behavior Specifications

### Scenario: MMO event with missing tank triggers alert

- **Given:** An MMO event with `slotConfig = { type: 'mmo', tank: 2, healer: 4 }` starts in 4 hours, has 1 tank and 4 healers assigned (status = `signed_up`)
- **When:** The reminder cron fires
- **Then:** The event creator receives a DM with title "Role Gap Alert", message mentioning "Missing 1 tank", and buttons for View Event, Cancel Event, Reschedule, and Adjust Notifications

### Scenario: MMO event with missing healers triggers alert

- **Given:** An MMO event starts in 3h50m, has 2 tanks but only 2 of 4 required healers
- **When:** The reminder cron fires
- **Then:** Creator receives alert with "Missing 2 healers" and roster summary "Healers: 2/4"

### Scenario: MMO event with both roles missing

- **Given:** An MMO event starts in 4h10m, has 0 tanks (of 2) and 3 healers (of 4)
- **When:** The reminder cron fires
- **Then:** Creator receives alert with "Missing 2 tanks, 1 healer"

### Scenario: Fully staffed MMO event — no alert

- **Given:** An MMO event starts in 4 hours, has 2+ tanks and 4+ healers assigned
- **When:** The reminder cron fires
- **Then:** No alert is sent

### Scenario: Non-MMO event — no alert

- **Given:** An event with `slotConfig = { type: 'generic' }` starts in 4 hours with empty slots
- **When:** The reminder cron fires
- **Then:** No alert is sent (role gap alerts only apply to MMO events)

### Scenario: Cancelled event — no alert

- **Given:** An MMO event starts in 4 hours with missing roles, but `cancelledAt` is set
- **When:** The reminder cron fires
- **Then:** No alert is sent

### Scenario: Event outside 4h window — no alert

- **Given:** An MMO event with missing roles starts in 6 hours (outside 3h45m–4h15m window)
- **When:** The reminder cron fires
- **Then:** No alert is sent

### Scenario: Deduplication — one alert per event

- **Given:** An MMO event triggered a role gap alert in a previous cron cycle
- **When:** The cron fires again and the event is still in the 4h window
- **Then:** No second alert is sent (dedup row already exists in `event_reminders_sent`)

### Scenario: Only signed_up signups count

- **Given:** An MMO event has 2 tank roster assignments, but one signup has status `tentative`
- **When:** The cron fires
- **Then:** Only the `signed_up` assignment counts toward the fill (tentative does not)

### Scenario: Deep link opens cancel modal

- **Given:** A user navigates to `/events/42?action=cancel&reason=Not%20enough%20tanks`
- **When:** The event detail page loads and the user is the event creator
- **Then:** The cancel modal opens automatically with "Not enough tanks" pre-populated in the reason field, and query params are cleared from the URL

### Scenario: Deep link opens reschedule modal

- **Given:** A user navigates to `/events/42?action=reschedule`
- **When:** The event detail page loads and the user is the event creator
- **Then:** The reschedule modal opens automatically, and query params are cleared

### Scenario: Deep link non-creator — no modal

- **Given:** A user who is NOT the event creator navigates to `/events/42?action=cancel`
- **When:** The page loads
- **Then:** The cancel modal does NOT auto-open (permission check fails gracefully)

## Error Handling Matrix

| Error Condition | Error Type | HTTP Status | User Message |
|-----------------|------------|-------------|--------------|
| Creator has Discord DMs disabled | Discord 50007 | N/A (async) | In-app notification still created; standard unreachable flow applies |
| Creator has `role_gap_alert` in-app disabled | Preference check | N/A | No notification created (silently skipped) |
| Roster query returns empty (no signups) | No error | N/A | Alert fires — 0 filled roles means all required roles are missing |
| Event deleted between query and send | FK cascade | N/A | `event_reminders_sent` insert fails silently; no notification sent |
| Deep-link reason exceeds 200 chars | URL truncation | N/A | Reason truncated to 200 chars in the URL; textarea shows truncated value |

## Dependencies

- **API internal:**
  - `EventReminderService` (host for role gap check)
  - `NotificationService.create()` (notification dispatch)
  - `DiscordNotificationEmbedService` (embed rendering)
  - `SettingsService` (client URL, default timezone)
  - Drizzle schema: `events`, `rosterAssignments`, `eventSignups`, `eventRemindersSent`
- **Web internal:**
  - `EventDetailPage` (deep-link param handler)
  - `CancelEventModal` (initialReason prop)
  - `RescheduleModal` (initialReason prop)
- **External:** None

## Files Changed (Summary)

### API
| File | Change |
|------|--------|
| `api/src/drizzle/schema/notification-preferences.ts` | Add `'role_gap_alert'` to types + default prefs |
| `api/src/notifications/event-reminder.service.ts` | Add `checkRoleGaps()`, `sendRoleGapAlert()`, call from `handleReminders()` |
| `api/src/notifications/discord-notification-embed.service.ts` | Add `role_gap_alert` to color/emoji/label/fields/buttons/timestamp maps; make `buildExtraRows` accept `clientUrl` param |

### Web
| File | Change |
|------|--------|
| `web/src/pages/event-detail-page.tsx` | Add `useSearchParams`, deep-link action effect, pass `initialReason` to modals |
| `web/src/components/events/cancel-event-modal.tsx` | Add `initialReason` prop, initialize state from it |
| `web/src/components/events/RescheduleModal.tsx` | Add `initialReason` prop (reserved, no UI change) |
