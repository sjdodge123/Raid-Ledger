# ROK-1327 — Spike: series-level signup

**Status:** spike output for operator review. No code, no migration and no Linear filing in this story.
**Base commit:** `907469784` (origin/main, 2026-09-22).
**Tier:** spike (docs only). The follow-up build is `standard`: it adds a migration, a contract change
and a new rendered flow, so it gets the full gate (the migration escalates `validate-ci` to `--full`).
**Provenance:** the scope comes from the ROK-1327 Linear issue body (read in full on 2026-09-22; created 2026-05-19).
Every statement about current behaviour below cites `file:line` on the base commit. Anything not
confirmed by reading the code is marked **UNVERIFIED**.

---

## 0. The finding that reshapes the question

The story asks what happens as future occurrences "are generated". **They are not generated lazily.** All
occurrences of a series exist as rows from the moment the series is created:

- `insertRecurringEvents` inserts every instance in one statement
  (`api/src/events/event-create.helpers.ts:40-63`), with dates from `generateRecurringDates`
  (`api/src/events/recurrence.util.ts:23-40`).
- The series is capped at `MAX_RECURRENCE_INSTANCES = 52` (`api/src/events/recurrence.util.ts:7`, enforced at `:32`).
- `until` is **required**: `RecurrenceSchema = { frequency: weekly|biweekly|monthly, until }`
  (`packages/contract/src/events.schema.ts:24-27`). **An open-ended series does not exist today.**
- There is no series entity table. A series is only the bare `events.recurrence_group_id` uuid
  (`api/src/drizzle/schema/events.ts:69`) plus a copied `recurrence_rule` jsonb (`:71`). The one other table that
  keys on the group id is `channel_bindings.recurrence_group_id` (`api/src/drizzle/schema/channel-bindings.ts:35`,
  ROK-435/1351), which is the precedent for keying on the uuid without a foreign key.
- Discord embeds are the only lazy part: they are deferred and posted at `min(6 days, interval)` before
  each occurrence (`api/src/discord-bot/utils/embed-lead-time.ts:1-10, 36-38`,
  `api/src/discord-bot/services/embed-scheduler.service.ts:21, 47-70`).

**Consequence:** "sign up for the series" needs **no spawn hook**. It is a bulk signup across rows that
already exist, plus a durable record of intent. That record lets the UI say "in for the series", tells
organizers apart who is in for the series and who is in for one night, and gives a future "extend series"
or open-ended feature a place to hook in.

---

## 1. What exists today (audit)

| Concern | Current behaviour | Anchor |
|---|---|---|
| Signup entry point | `SignupsService.signup(eventId, userId, dto?, opts?)` checks that the event accepts signups, then runs `signupTxBody` in a transaction (which auto-allocates via `allocationService.autoAllocateSignup`) | `api/src/events/signups.service.ts:57-58, 62-86` |
| Signup side effects (per call) | emits `SIGNUP_EVENTS.CREATED`, calls `rosterNotificationBuffer.bufferJoin`, and writes the activity log `signup_added` | `api/src/events/signups.service.ts:96-105` |
| Signup row | `event_signups`: one row per (event, user) (`unique_event_user`), with `characterId`, `preferredRoles[]`, `status` (`signed_up`, `tentative`, `declined`, `roached_out`, `departed`) and `signedUpAt` | `api/src/drizzle/schema/event-signups.ts:34-35, 45-129` (unique `:115`) |
| Existing bulk auto-signup precedent | `autoSignupPollVoters` loops `signupsService.signup` per user, filters out deactivated, banned and kicked users, and wraps each call in its own try/catch so one failure never propagates | `api/src/events/event-plans-auto-signup.helpers.ts:34-60` (filter `:44-49`) |
| Allocation tie-break | tentative displacement and bench promotion both order by `signedUpAt` ascending | `api/src/events/signups-allocation.helpers.ts:138-143`, `api/src/events/bench-promotion.service.ts:211` |
| Per-occurrence cancel | `cancel` → `rosterService.cancel`. ≥23h before start gives `declined`, <23h gives `roached_out` | `api/src/events/signups.service.ts:251-254`, `api/src/events/signup-cancel.helpers.ts:61-83` |
| Series ops (edit, delete, cancel) | `PATCH/DELETE :id/series` and `PATCH :id/series/cancel` with scope `this`, `this_and_following` or `all` | `api/src/events/events.controller.ts:240-299`, `api/src/events/event-series.service.ts:40-94`, scope resolution `api/src/events/event-series.helpers.ts:65-78` |
| Series reschedule | shifts every target by the time delta and calls `resetSignupConfirmations` per event. **Signups stay attached to the event row.** | `api/src/events/event-series.helpers.ts:80-111`, `api/src/events/event-lifecycle.helpers.ts:137` |
| Series lookup | `findSeriesEvents(db, groupId, fromStart?)` does **not** filter `cancelledAt` | `api/src/events/event-series.helpers.ts:26-47` |
| Event delete | deleting an event cascades to its signups (FK `onDelete: 'cascade'`) | `api/src/drizzle/schema/event-signups.ts:49-51` |
| Reminders | per occurrence, per signed-up user: 15min, 1h and 24h windows, run by a cron every minute | `api/src/notifications/event-reminder.constants.ts:7-26`, `api/src/notifications/event-reminder.service.ts:55, 105` |
| Organizer roster pings | `bufferJoin` is a **no-op** unless a leave is already buffered for that event+user, so a bulk signup does not spam the organizer | `api/src/notifications/roster-notification-buffer.service.ts:28-39, 94-97` |
| Deactivation cascade | `deactivateUserOrchestrated` → `runCascade` → `cancelAllUpcomingSignupsForUser`, which cancels every future signup that is not already declined, roached out or departed | `api/src/notifications/discord-notification-deactivate.helpers.ts:100-133, 153-175`; `api/src/events/signup-cancel-batch.helpers.ts:21-57` |
| Deactivation triggers | the 50278 classifier, the `GuildMemberAdd` reactivation and the daily cron at 07:00 UTC | `api/src/notifications/discord-notification.processor.ts:138`, `api/src/users/guild-reconciliation.service.ts:44` |
| Discord signup row | Sign Up / Tentative / Decline plus a View Event link (4 of Discord's 5 per-row components), customIds `${SIGNUP_BUTTON_IDS.X}:${eventId}` | `api/src/discord-bot/services/discord-embed-buttons.helpers.ts:5-33`, `api/src/discord-bot/discord-bot.constants.ts:266-267` |
| Series-bound Discord channel | a binding can target one series (`recurrence_group_id`), and notification routing prefers it (ROK-1390) | `api/src/drizzle/schema/channel-bindings.ts:34-35`, `api/src/discord-bot/services/ad-hoc-notification.helpers.ts:175` |
| Web series surfaces | `SeriesBadge` in the event banner when `recurrenceGroupId` is set; `SeriesScopeModal` (This / This and following / All) | `web/src/components/events/EventBanner.tsx:118-121`, `web/src/components/events/series-scope-modal.tsx:13-16, 45`, lazy-loaded at `web/src/pages/event-detail/EventDetailModals.tsx:19-20` |
| Web signup CTAs | `EventDetailFallbackSignup` ("Sign Up for Event") and `SignedUpActions` ("Leave") | `web/src/pages/event-detail/EventDetailSubComponents.tsx:60-66, 286-292`; mounted at `web/src/pages/event-detail-page.tsx:193` |
| Time-conflict detection | **none in the signup path.** A grep of `api/src/events/signup*.ts` and `signups*.ts` for overlap or conflict finds only `onConflictDoNothing` and the cancelled-event `ConflictException` | `api/src/events/signups-cancel.helpers.ts:30-42` |

---

## 2. Semantic model

### Recommended — M2 "Series membership, materialized, opt-out per night"

Joining a series creates one **membership** row and immediately signs the player up (as real
`event_signups` rows, through the normal `signup()` path) for **every occurrence from the one they
clicked forward** that is still in the future, not cancelled, and has no existing signup row for them.
Each materialized signup is tagged with the membership id.

- **Skip one night:** the existing per-occurrence Decline or Leave. The membership is untouched.
- **Leave the series:** end the membership and cancel every future signup tagged with it. Nights the
  player joined individually (untagged) are left alone.
- Everything downstream (allocation, bench, reminders, embeds, attendance, the deactivation cascade)
  keeps working unchanged, because it still sees ordinary `event_signups` rows.

Why this model: occurrences already exist (section 0), so materializing costs one loop that already has
a precedent (`autoSignupPollVoters`). It adds no new read path to any existing consumer, and it gives the
organizer a real roster on every night instead of a guess.

### Alternatives

| Model | What it is | For | Against |
|---|---|---|---|
| **M1: bulk action only** | a "Sign up for all remaining" button that loops `signup()`; no new table | smallest build (no migration); ships in a day | no durable "in for the series" state, so the UI and organizer can't tell series members from one-nighters, and there's nothing for "extend series" to hook. Leaving the series is also ambiguous (which nights were the bulk ones?). A good **phase-0** if the operator wants to learn from usage first. |
| **M2: membership + materialize** (recommended) | see above | real rosters, explicit intent, clean leave semantics | one migration, and an explicit cleanup hook in series delete/cancel |
| **M3: intent only** | the membership row exists, but every night still needs a per-occurrence confirm | organizers see soft commitment; no phantom attendance | keeps the exact friction the story is trying to remove. Needs a new "intent" rendering in the roster and the embed, and two sources of truth for "who's coming". |
| **M4: lazy rolling window** | the membership materializes only N weeks ahead, with a cron topping up | the only model that works for **open-ended** series | open-ended series don't exist (`until` is required, 52-instance cap), so this is complexity with no customer today. Revisit if open-ended series ship. |

A `signup.scope = 'series' | 'occurrence'` discriminator on `event_signups` (the story's second schema
option) is **rejected**: `event_id` is `NOT NULL` with `unique_event_user` (`event-signups.ts:49-51, 115`), so a
series-scoped row has nowhere to live without loosening core roster constraints.

---

## 3. Data-model sketch (Drizzle; not a migration)

```ts
// api/src/drizzle/schema/series-signups.ts  (NEW FILE — does not exist yet)
export const seriesSignups = pgTable(
  'series_signups',
  {
    id: serial('id').primaryKey(),
    /** Series identity. Bare uuid, no FK — same precedent as channel_bindings.recurrence_group_id. */
    recurrenceGroupId: uuid('recurrence_group_id').notNull(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    /** Default character/roles copied into each materialized signup. Editable per night afterwards. */
    characterId: uuid('character_id').references(() => characters.id, { onDelete: 'set null' }),
    preferredRoles: text('preferred_roles').array(),
    /** 'active' | 'left' | 'ended' */
    status: varchar('status', { length: 20 }).default('active').notNull(),
    /** 'user_left' | 'deactivated' | 'series_cancelled' | 'series_deleted' */
    endedReason: varchar('ended_reason', { length: 30 }),
    joinedAt: timestamp('joined_at').defaultNow().notNull(),
    endedAt: timestamp('ended_at'),
  },
  (t) => [
    // One ACTIVE membership per user per series; history rows are kept on re-join.
    uniqueIndex('uq_series_signups_active')
      .on(t.recurrenceGroupId, t.userId)
      .where(sql`${t.status} = 'active'`),
    index('idx_series_signups_group').on(t.recurrenceGroupId),
    index('idx_series_signups_user').on(t.userId),
  ],
);

// event_signups gains one nullable column:
seriesSignupId: integer('series_signup_id').references(() => seriesSignups.id, {
  onDelete: 'set null',
}),
```

- **Migration and backfill:** purely additive. **No backfill.** Guessing "was in for the whole series"
  from existing per-night signups would be a fabrication. Existing signups keep `series_signup_id = NULL`.
- **Characters and roles:** one default per membership, copied into each `CreateSignupDto`. Per-night
  changes go through the existing per-occurrence character and role flows and never write back to the
  membership. (If the membership's character is deleted, `set null` degrades it to "pending" confirmation
  on later materializations.)
- **Contract:** a new `SeriesSignupSchema` plus a `seriesSignupId` field on the roster signup DTO (so the
  web and the embed can show a "Series" chip). The exact DTO shape is left to the spec.

---

## 4. Interaction matrix

| Trigger | Auto-allocation / roster | Cancellation cascade | Reminder cadence | Deactivation cascade |
|---|---|---|---|---|
| **Join series** | each materialized signup runs the normal `signup()` → `signupTxBody` → `autoAllocateSignup` (`signups.service.ts:57-58, 62-86`). Full nights put the member on the bench by existing rules (**UNVERIFIED**: bench path not re-read). Member `signedUpAt` is earlier than later one-nighters' **by construction**, so the existing tie-break (`signups-allocation.helpers.ts:138-143`, `bench-promotion.service.ts:211`) gives series members a soft priority without a new rule. | n/a | unchanged: the per-occurrence 15m/1h/24h windows (`event-reminder.constants.ts:7-26`) fire for each night, because each night has a real row | materializer must filter out deactivated, banned and kicked users like `event-plans-auto-signup.helpers.ts:44-49` |
| **Skip one night** (existing Decline/Leave on an occurrence) | existing bench promotion fills the slot | only that night: the existing 23h rule gives `declined` or `roached_out` (`signup-cancel.helpers.ts:61-83`). **Membership stays active.** | none for that night (no active row) | n/a |
| **Leave series** | each cancelled night runs existing promotion | membership becomes `left`, then cancel every **future** signup with `series_signup_id = membership.id` that is still active, per-row try/catch like `signup-cancel-batch.helpers.ts:21-57`. The 23h rule applies **per night** (the next night may become `roached_out`; see OQ-3). Untagged nights are kept. | stops (no active rows) | n/a |
| **Organizer cancels series** (`scope=all` or `this_and_following`, `event-series.service.ts:74-94`) | n/a (events cancelled) | existing per-event cancel behaviour for signups (**UNVERIFIED**: whether signups are touched or only `events.cancelled_at` is set). **New:** mark memberships `ended/series_cancelled` when scope covers the last remaining occurrence | existing: reminders skip cancelled events (**UNVERIFIED**) | n/a |
| **Organizer deletes series** (`deleteSeriesEvents`, `event-series.helpers.ts:134`) | n/a | signups FK-cascade away (`event-signups.ts:49-51`). **New:** memberships have no FK to events, so delete must end them explicitly (`series_deleted`) | n/a | n/a |
| **Organizer reschedules** (any scope) | unchanged: signups stay on the moved rows and `resetSignupConfirmations` runs (`event-series.helpers.ts:96-106`) | none | follows the new start time (the windows are computed from event start) | n/a |
| **Guild leave → deactivation** | existing promotion per cancelled night | existing `cancelAllUpcomingSignupsForUser` (`signup-cancel-batch.helpers.ts:21-57`) already cancels every materialized night. **New:** one line in `runCascade` (`discord-notification-deactivate.helpers.ts:153-175`) to end the user's active memberships (`ended/deactivated`), so nothing re-materializes later | stops | **Reactivation (`GuildMemberAdd`) does NOT restore memberships** (see OQ-4); keep the ROK-313 `banned_at IS NULL` guard untouched |
| **Event notifications to the organizer** | `bufferJoin` is a no-op for fresh signups (`roster-notification-buffer.service.ts:94-97`), so there's no DM storm | — | — | — |
| **Activity log / embed sync** | `signup_added` and `SIGNUP_EVENTS.CREATED` fire **per night** (`signups.service.ts:96-105`). For a 52-night series that's 52 log rows and up to 52 embed-sync events, but only nights with a *posted* embed have anything to edit (lead-time gating, `embed-lead-time.ts:36-38`). **UNVERIFIED**: embed-sync listener cost for events with no posted embed. | — | — | — |

---

## 5. UX sketch

Per `docs/design-system.md`: reuse `Modal` on desktop and `BottomSheet` on mobile, split by viewport
(`docs/design-system.md:309-316`); success, warning and danger are tokens (`docs/design-system.md:97-104`); check
`default-dark` **and** `default-light` on `/dev/design-system`.

### Web — event detail page (occurrence of a series)

```
┌ EventBanner ─────────────────────────────── [⟳ Series] ┐   ← existing SeriesBadge, EventBanner.tsx:118-121
│ Weekly Raid Night · Tue 8pm                             │
└─────────────────────────────────────────────────────────┘
 Not signed up:          [ Sign Up for Event ]  [ Join series ▸ ]      ← new secondary btn beside
                                                                          EventDetailFallbackSignup (:60-66)
 Signed up (one night):  [ Leave ]  [ Join series ▸ ]                   ← SignedUpActions (:286-292)
 Series member:          ⟳ In for the series · [ Skip this night ] [ ⋯ Leave series ]
```

**Join series** opens a `Modal`/`BottomSheet`:

```
 Join "Weekly Raid Night"
 You'll be signed up for 7 upcoming nights (Sep 29 → Nov 10).
 Nights you already declined stay declined.
 Character: [ dropdown ]   Roles: [tank][healer][dps]
 You can skip any single night later.
                                  [ Cancel ]  [ Join 7 nights ]
```

**Leave** for a series member reuses the `SeriesScopeModal` idiom (`series-scope-modal.tsx:13-16`) with two
options: *This night only* or *This and all following nights (leave series)*. Note that the modal's selected
state uses raw `emerald-500` (`series-scope-modal.tsx:30`). Accent hues are allowed by convention, but a
build that touches it should check whether the `success` token is now the right role (flagged, not
decided).

**Roster:** a small "Series" chip on member entries (a `badge` per design-system §4.3, chips and pills), so
organizers can tell the two apart. **UNVERIFIED:** which roster component renders the entries (not read in
this spike).

### Discord — occurrence embed

`buildSignupButtons` uses 4 of the 5 components in the row (`discord-embed-buttons.helpers.ts:9-31`). Add a
5th, **Join Series**, only when the event has a `recurrenceGroupId`:

```
[ Sign Up ] [ Tentative ] [ Decline ] [ Join Series ] [ View Event ↗ ]
```

- **Join Series** gives an ephemeral reply: "Sign up for the 7 remaining nights?" with character and role
  dropdowns (reuse `api/src/discord-bot/utils/signup-dropdown-builders.ts`) and a Confirm button.
- **Decline** for a series member gives an ephemeral choice: *Skip this night* or *Leave the series*.
- No new series-level embed. Occurrence embeds already land in the series-bound channel when one exists
  (ROK-1390 routing, `ad-hoc-notification.helpers.ts:175`), and lead-time gating keeps about one live
  embed per series. A pinned "series card" is a possible later step, not v1.
- Anonymous Discord participants (`user_id` NULL, `event-signups.ts:52-61`) **cannot** join a series. The
  ephemeral reply points them to link an account (see OQ-5).

---

## 6. Edge cases

1. **Mid-series reschedule** (organizer moves occurrence 5): signups are rows on the event, so the member
   follows automatically. `resetSignupConfirmations` asks them to reconfirm like everyone else
   (`event-series.helpers.ts:102-105`). No membership change.
2. **Guild leaver:** covered by the existing cascade. The only new behaviour is ending the membership
   (section 4). Rejoining does not restore it.
3. **Fixed end** (the only kind today, `events.schema.ts:24-27`): after the last night passes, the membership is
   inert. Derive "completed" at read time (no cron). Leave `status='active'` or add a lazy
   `ended/series_complete`. That's the spec's call; flagged.
4. **Open-ended end:** does not exist (`until` required, 52 cap at `recurrence.util.ts:7`). If an "extend series"
   or open-ended feature ships, it must call the materializer for active members. Put this contract in
   that story.
5. **Joining mid-series:** materialize only from the anchor forward and only future nights. `findSeriesEvents`
   does not filter `cancelledAt` (`event-series.helpers.ts:31-45`), so the materializer must filter it itself.
6. **Explicit prior decline on a night:** skip it. Never re-activate a row the player declined. The
   duplicate/reconfirm path in `signup()` (`signups.service.ts:94-95`) could re-activate an existing row
   (**UNVERIFIED** for declined rows), so pre-filter existing rows instead of relying on it.
7. **Full nights:** the member lands on the bench for those nights (existing rules). The join confirmation
   should say "benched on N nights" if that's cheap to compute. Otherwise, OQ-7.
8. **Time conflicts with other events:** no overlap detection exists in the signup path (section 1), so series
   signup can't detect it either. Out of scope; listed so nobody assumes it.
9. **Organizer is a member of their own series:** the creator is not auto-joined today. **UNVERIFIED** whether
   the creator gets an auto-signup on each occurrence at create time; the spec should check.
10. **Series size:** worst case is 52 `signup()` transactions in one request. Run them sequentially with
    per-night try/catch (the precedent is `autoSignupPollVoters`). **UNVERIFIED**: latency. If it's too slow,
    move to a BullMQ job and return 202.

---

## 7. Open questions for the operator (recommended answer in **bold**)

1. **OQ-1 Model:** materialized opt-out membership (M2), M1 bulk-only first, or intent-only (M3)? **M2.** If
   you want to validate demand first, ship M1 as a one-PR phase 0, then M2.
2. **OQ-2 Allocation priority:** should series members get explicit priority over one-night signups beyond
   the natural `signedUpAt` earliness? **No explicit rule.** The existing tie-break already favours them.
3. **OQ-3 Leaving <23h before the next night:** does that night count as `roached_out` like any late cancel?
   **Yes.** Apply the existing rule per night, with no special case.
4. **OQ-4 Guild rejoin:** does reactivation restore the series membership? **No.** The player re-joins
   manually, and reactivation stays a pure un-deactivate.
5. **OQ-5 Anonymous Discord participants:** can they join a series? **No.** Series signup needs a linked RL
   account.
6. **OQ-6 Roster chip:** show a "Series" marker on member entries in the web roster and the embed? **Yes,
   web only in v1.** Embed field budget is tight.
7. **OQ-7 Benched-nights disclosure:** tell the player at join time which nights they'll be benched?
   **Nice-to-have; not an AC for v1.**
8. **OQ-8 Organizer adds members:** can an organizer or admin enrol someone into a series? **Defer.**
9. **OQ-9 Anchor:** does "Join series" start from the clicked occurrence or from the next upcoming one? **From
   the clicked occurrence forward.** This matches `this_and_following` (`series-scope-modal.tsx:15`).
10. **OQ-10 Discord button:** is a 5th button on every series embed acceptable, or should Join Series live
    behind the Sign Up ephemeral ("Just this night / Whole series")? **The 5th button.** It's one click, and the row
    has exactly one slot free.

---

## 8. Draft follow-up story (NOT filed; operator reviews first)

**Title:** `feat: join a recurring series in one click (series signup)`
**Labels:** Events · **Tier:** standard (migration + contract + new flow) · **Gate:** `--full`, Playwright
desktop+mobile, Discord companion smoke (touches `api/src/events/signups*` and `api/src/discord-bot/**`).

**Acceptance criteria**

1. A new `series_signups` table and a nullable `event_signups.series_signup_id` (FK `set null`) ship in one
   additive migration with no backfill. There is a partial unique index on (group, user) where `status='active'`.
2. `POST /events/:id/series/signup` (the path is for the spec to decide) creates an active membership and
   signs the user up, through `SignupsService.signup`, for every occurrence of the event's series from `:id`
   forward that is in the future, not cancelled, and has no existing signup row for the user. Each created
   signup carries `series_signup_id`. The request is rejected for non-series events and for deactivated,
   banned or kicked users.
3. Declining or leaving a single occurrence keeps the membership active. The existing 23h
   `declined`/`roached_out` rule is unchanged.
4. `DELETE /events/:id/series/signup` sets the membership to `left` and cancels only the future
   signups tagged with it. Untagged signups for the same series are untouched.
5. The deactivation cascade (`deactivateUserOrchestrated`) ends every active membership of the user
   (`ended_reason='deactivated'`). `GuildMemberAdd` reactivation does not restore it, and the ROK-313 ban guard
   is unchanged.
6. Series delete ends the memberships (`series_deleted`). Series cancel covering the final remaining
   occurrence ends them (`series_cancelled`).
7. Web: a series occurrence shows "Join series" beside the signup CTA. Joining opens `Modal` on desktop and
   `BottomSheet` on mobile, with the night count, date range, character and role. A member sees "In for the
   series", "Skip this night" and "Leave series". It's verified in `default-dark` and `default-light`, and
   the PR states any new pattern.
8. Discord: series embeds get a 5th **Join Series** button with an ephemeral confirm and the
   character/role dropdowns. A member pressing Decline gets "Skip this night / Leave the series".
9. Reminders stay per occurrence, and no new reminder cadence is added. The regression test asserts that a
   series member receives the standard windows for a materialized night.
10. Tests: an integration test for materialize/leave/deactivate (real DB); a Playwright join-series smoke
    (desktop + mobile); a companion-bot smoke for the Join Series button. Every new assertion is mutation-checked.
11. A fleet test plan with a seeded series (≥3 future nights) deep-links the join, skip and leave flows.

---

## Summary

- **Verified:** occurrences are materialized eagerly (52 cap, `until` required). Signup, cancel,
  allocation tie-break, deactivation cascade, reminder windows, series ops, embed buttons, lead-time
  gating and the web series surfaces, all anchored above.
- **Flagged UNVERIFIED:** the bench path details; how series cancel treats signups; reminder skipping on
  cancelled events; embed-sync cost for unposted nights; whether duplicate-signup re-activates declined rows;
  creator auto-signup per occurrence; which component renders roster entries; 52-signup request latency.
- **Not reached:** Discord interaction handler internals (how `signup:{eventId}` is routed) and the
  web calendar and event cards' use of `recurrenceGroupId`.
