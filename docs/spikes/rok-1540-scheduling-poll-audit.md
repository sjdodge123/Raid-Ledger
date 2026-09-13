# ROK-1540 — Scheduling poll experience: audit, principles, wireframes, plan

**Spike.** Operator framing: the scheduling poll is *"probably the most used function of the entire app"* and it must be *"top tier."* Operator ruled **both** poll surfaces in scope.

**Method.** Derived from source + tests on `origin/main@6e828478` — no browser session, no prod access. Every claim below carries a `file:symbol` anchor so the landing lane can verify without re-deriving. Usage numbers are explicitly **not** guessed: see [Usage numbers](#usage-numbers-lead-to-fill-from-prod).

**Relationship to Cycle 4.** The two surfaces audited here were built to the Cycle 4 "Unify" target in `web/src/dev/simplify-wireframes/README.md` (sections **Ss** / **Sx**, story ROK-1300). That target is *shipped and honoured* — this spike does **not** re-litigate it. Where a proposal here changes Ss/Sx, it is called out in [Superseding Cycle 4](#superseding-cycle-4-sssx) with the exact rule it replaces. Anything not listed there still binds.

---

## 1. Surface inventory

### Surface A — Lineup scheduling phase (the poll page)

Route `/community-lineup/:lineupId/schedule/:matchId`. One component, **two modes**, driven by the contract's `isStandalone`:

| Mode | Entry point | Hero |
|---|---|---|
| `from-match` (**Ss**) | Lineup Decided → per-match "Pick a time →" | 4-phase ribbon, `Step 4 of 4 · Scheduling · Match N of M` |
| `standalone` (**Sx**) | `/events` → "Schedule a Game", or RescheduleModal → "Run a poll" | `noRibbon`, `🗓 Scheduling Poll · started by <x>` |

Component tree (all under `web/src/components/lineups/cycle-4/`):

```
SchedulingComposite.tsx          orchestrator: mode, readOnly, submit, lock
├── SchedulingToolbar.tsx        sticky (top-14, z-20), auto-hides on scroll
│   ├── JourneyHero              badge / task / sub / hint / tone
│   ├── LineupParticipantsButton (web/src/components/lineups/)
│   ├── SchedulingAddMembersAction / RemindAction / CancelAction → CancelPollModal.tsx
│   ├── SchedulingGameRefBanner  U2 game ref → /games/:id
│   ├── StickyHeroScheduleSubmitButton  (sticky-hero-buttons.tsx)
│   └── SchedulingVoteProgress   only when minVoteThreshold set
├── PollDeadlineBanner           (pages/scheduling/)
├── read-only banner             inline in SchedulingComposite
├── SchedulingAvailability.tsx   → AvailabilityHeatmapSection → GameTimeGrid
└── SchedulingSlotList.tsx
    ├── SchedulingSlotRow.tsx    time · avatars · N votes · conflict · [+ Vote] [Lock this time →]
    └── SchedulingSuggestForm.tsx
```

Pure helpers: `scheduling-hero.ts` (hero props), `scheduling-submit-copy.ts` (submit kind + labels), `use-schedule-submit-state.ts` (dirty-unlock), `use-scheduling-lock.ts` (threshold confirm), `scheduling-crossrefs.ts` (Match N of M), `scheduling-availability.ts` (week math).

Contract: `packages/contract/src/lineup-scheduling.schema.ts` → `SchedulePollPageResponseSchema`.
Data: `community_lineup_matches` / `_match_members` / `_schedule_slots` / `_schedule_votes` (`api/src/drizzle/schema/community-lineup-matches.ts`).
Discord: `api/src/lineups/scheduling/scheduling-poll-embed.service.ts` + `.helpers.ts` → `api/src/discord-bot/services/discord-embed-scheduling.helpers.ts`.

### Surface B — Event reschedule poll

Two *different* things share the word "reschedule" and the audit must keep them apart:

1. **Direct reschedule** — `web/src/components/events/RescheduleModal.tsx`. Operator picks a new time on the aggregate game-time heatmap and commits. No poll. Fires `PATCH` via `useRescheduleEvent`, then Discord DMs the roster with Confirm/Tentative/Decline buttons (`api/src/discord-bot/listeners/reschedule-response.listener.ts`, ROK-537).
2. **Reschedule *poll*** — the same modal's `PollBanner` ("Run a poll") calls `useCreateSchedulingPoll({ gameId, linkedEventId })` and **navigates to Surface A** (`/community-lineup/:lineupId/schedule/:matchId`). The linked event's Discord card flips to `RESCHEDULING`; lock-in (`StandalonePollService.complete`) restores it and enqueues an explicit embed sync (ROK-1392).

Other touchpoints: `web/src/components/events/SchedulingBanner.tsx` (events-page NavChip row), `CalendarView.tsx` (no poll affordance — see F-11), `useActiveStandalonePolls`.

---

## 2. State matrix

`isReadOnly` is the master gate: `poll.match.status !== 'scheduling' && !== 'suggested'` (`SchedulingComposite.tsx:isReadOnly`). Match status flow is `suggested → scheduling → scheduled → archived`.

| # | State | Trigger | What renders | Who owns it |
|---|---|---|---|---|
| 1 | **Open, no slots** | `poll.slots.length === 0` | "No times suggested yet. Add one below." + suggest form. Heatmap still renders. | `SchedulingSlotList` |
| 2 | **Open, unvoted** | `myVotedSlotIds = []` | Rows with `+ Vote`; submit **disabled**, nudge "Pick a time first to submit." | `deriveScheduleSubmitKind` → `empty` |
| 3 | **Voted, unsubmitted** | ≥1 vote, `schedulingSubmittedAt = null` | `✓ Voted` pills, submit enabled (`Submit my times →` / `Lock this time →`) | kind `pre` |
| 4 | **Submitted** | server stamp present, not dirty | hero `tone=waiting` + "You're done here" pill, task "Your times are submitted.", button `Change my times` | `useScheduleSubmitState` |
| 5 | **Changed vote after submit** | vote toggled post-submit | `markDirty()` re-arms the button; **hero silently flips back to `action`** | `use-schedule-submit-state.ts` |
| 6 | **Tie** | two slots with equal `votes.length` | **No tie treatment exists.** `sortSlots` breaks ties by earlier `proposedTime`; the embed's `sortedSlots` has *no* secondary key → **web and Discord can disagree on which slot is "top"** | F-03 |
| 7 | **Locked in** | `match.status = 'scheduled'` | `isReadOnly` → amber "This poll is read-only. Voting is closed." Nothing names the winning time or links the event. | F-01 |
| 8 | **Cancelled** | `CancelPollModal` → status `archived` | Same generic read-only banner. Cancel *reason* is DM'd but never rendered on the page. | F-02 |
| 9 | **Late joiner** | member row created by self-enrol or `added` | Page renders identically to state 2. No "you joined late / N already voted / here is the leader" orientation. | F-05 |
| 10 | **Viewer without vote rights** | not a member | Vote is **not** gated client-side; the server owns enrolment (`standalone-poll-auth.helpers.ts`, `standalone-poll-voter.helpers.ts`). A non-member sees live `+ Vote` buttons. | F-07 |
| 11 | **Expired / past deadline** | `phaseDeadline` in the past | `PollDeadlineBanner` only; slots in the past get a muted `· past` suffix and **remain votable** | F-04 |
| 12 | **No availability data** | heatmap query empty | `AvailabilityHeatmapSection` renders its own empty/loading; on Surface B `GridBody` says "No players signed up yet" | — |
| 13 | **Operator/creator** | `canBypassThreshold(user, match)` | Every row gains a second cyan `Lock this time →` button; `EarlyCreateConfirmModal` on under-threshold lock | `use-scheduling-lock.ts` |
| 14 | **Threshold pending** | `minVoteThreshold` set | `SchedulingVoteProgress` bar; otherwise absent entirely | ROK-1015 |
| 15 | **Conflict** | `slotConflicts[]` | `⚠ Conflicts with <title>` amber text, `title=` tooltip only | F-09 |

---

## 3. Interaction cost

Counted as discrete taps from the state named, on the poll page.

| Task | Taps | Breakdown |
|---|---|---|
| Cast first vote | **2** | `+ Vote` → `Submit my times →` |
| Cast first vote, arriving from Discord | **3** | masked "Vote now ↗" → (OAuth if cold) → `+ Vote` → Submit |
| Cast first vote, arriving from `/events` | **3** | `SchedulingBanner` NavChip → `+ Vote` → Submit |
| Add a *second* preferred slot | **2** | `+ Vote` → Submit |
| **Change a vote after submitting** | **3** | `Change my times` (unlock) → `+ Vote` → Submit |
| Suggest a new time | **3–4** | heatmap cell (prefill, optional) → datetime field → `Suggest`; auto-votes server-side |
| Operator lock-in | **1–2** | `Lock this time →` (+ `EarlyCreateConfirmModal` confirm when under threshold) |

**The single biggest cost is the Submit ritual.** Scheduling inherited U4's submit-bar from Nominating/Voting, where a member has a *budget* of votes (`3 of 3 used`) and Submit means "I am finished spending it." Scheduling has **no vote budget** — `deriveScheduleSubmitKind` passes the same boolean for `hasAnyAction` and `hasFullAction`, so `partial` is unreachable and the four-kind machine is really two states. The vote itself already persists optimistically and server-side the moment it is tapped (`useToggleScheduleVote`). So the second tap commits nothing the first did not; it only stamps `scheduling_submitted_at`, which feeds quorum/reminder logic. **The user pays a tap for a bookkeeping column.** See P-2 and F-06.

---

## 4. Desktop vs mobile

| Aspect | Desktop | Mobile (<640px) | Note |
|---|---|---|---|
| Toolbar | `md:bg-surface md:rounded-md`, `md:translate-y-0` — never hides | `sticky top-14 z-20` **auto-hides on scroll-down** (`useSchedulingSticky`, 300ms transform) | Submit lives in the toolbar, so on mobile **the primary action scrolls out of reach** while the user is looking at the slot list. F-08 |
| Slot row | time + avatars left, `+ Vote` (+ `Lock`) right | same flex row, no stacking | Operator sees two buttons + avatars + conflict text on one 375px row. F-10 |
| Vote button | `min-h-[36px]` | `min-h-[36px]` — **not** the `min-h-[44px] sm:min-h-[36px]` pattern the sticky-hero buttons use | Below the 44px target. F-12 |
| Game-ref + Submit | one row, `sm:flex-row sm:justify-between` | stacks | OK |
| Toolbar actions | Add members / Remind / Cancel inline | `flex-col items-end` stack | Three operator actions above the member's own action. F-13 |
| Heatmap | `GameTimeGrid` full week | same grid, `compact` not passed here (it *is* on the RescheduleModal) | F-14 |
| Reschedule modal | `Modal maxWidth=max-w-4xl` | `BottomSheet maxHeight=85vh` via `useMediaQuery('(max-width: 767px)')` | Correct primitive use — the poll page has no equivalent responsive switch |

Note the breakpoint split: the toolbar uses `md:` (768px), the inner rows use `sm:` (640px), the reschedule modal uses a 767px media query. Three thresholds on one flow.

---

## 5. Discord embed vs web page

Embed body: `discord-embed-scheduling.helpers.ts::buildSchedulingPollEmbedBody`.

| Element | Discord | Web | Diverges? |
|---|---|---|---|
| Title | `When should we play <game>?` → `/games/:id` | `Lock in a time for <game>.` (hero task) | Copy differs; both link the game |
| Status | author line `▸ POLL OPEN · N voters` / `● LOCKED IN · <time>` / `■ POLL CLOSED` | hero badge + read-only banner; **no locked-in time, no "closed" vs "cancelled" distinction** | **Yes — F-01/F-02** |
| Slots | **top 3 only**, `<t:…:f>`, sorted by `voteCount` desc, no tiebreak | **all** slots, sorted by votes desc **then time asc** | **Yes — F-03** |
| Voter identity | vote counts only (`voterNames` is built by `buildEmbedSlots` and then **never rendered**) | avatar group per slot, max 4 | **Yes — F-15**, and dead code |
| Your own vote | not shown — the embed is one shared message, not personalised | `✓` marker + `✓ Voted` pill | **Yes — the embed cannot answer "did I vote?"** F-16 |
| Voting | **not possible.** No action row (`discord-embed-scheduling.lifecycle.spec.ts` asserts "no button row", ROK-1461); only a masked `Vote now ↗` link | the only place a vote can be cast | **Yes — F-17, the biggest single finding** |
| Cover | `setThumbnail` | `SchedulingGameRefBanner` | consistent |
| Deadline | absent | `PollDeadlineBanner` | **Yes — F-04** |
| Conflicts | absent | per-slot `⚠` | Yes (acceptable — conflicts are per-viewer) |
| Colour | `CHROME_STATES`: open→`announcing`, locked_in→`live`, closed→`done` | emerald/amber ad hoc | Two palettes for one state machine |

**Freshness.** The embed is push-rendered from `fireUpdateEmbed(matchId)` on lock-in (ROK-1461) and on poll lifecycle events. There is **no re-render on an ordinary vote**, so `▸ POLL OPEN · N voters` and the per-slot counts are stale between lifecycle events. A Discord reader sees a poll that looks abandoned. F-18.

---

## 6. Live-update behaviour

**There are no sockets on either surface.** Everything is TanStack Query polling-by-invalidation:

| Query | `staleTime` | Refetch interval |
|---|---|---|
| `useSchedulePoll` (`['scheduling','poll',lineupId,matchId]`) | 15s | **none** |
| `useMatchAvailability` | 60s | none |
| `useSchedulingBanner` | 120s | none |
| `useOtherPolls` | 60s | none |

`useToggleScheduleVote` does an optimistic cache patch and `invalidateQueries(['scheduling'])` on settle, so **your own** vote is instant. **Someone else's vote never arrives** until a remount, a window refocus past `staleTime`, or one of your own mutations. On a live poll — exactly the "everyone votes in the same five minutes before raid" case — every participant is looking at a different snapshot of the same poll. F-19.

Consequence worth naming: two operators can both see a slot as top-voted, both hit `Lock this time →`, and the second one's confirm modal shows a distinct-voter count that is already wrong.

---

## 7. Copy inconsistencies

| # | Where | Copy | Problem |
|---|---|---|---|
| C-1 | `scheduling-submit-copy.ts::submitCopy` | standalone → **`Lock this time →`**; slot row (operator) → **`Lock this time →`** | **Identical label, different actions.** The toolbar one submits *your* votes; the row one ends the poll for everyone. An operator on a standalone poll sees both on one screen. |
| C-2 | hero task | `Lock in a time for <game>.` (from-match) vs `Pick a time that works for everyone.` (standalone) | Same job, two verbs. The Cycle 4 glossary rule ("one term per concept") is broken by the product's own copy. |
| C-3 | submit label | `Submit my times →` vs `Lock this time →` vs `Change my times` | "times" plural vs "this time" singular for the same button. |
| C-4 | `SchedulingBanner` | "Help schedule your next game night!" | Warm, but names no game, no deadline, no urgency; the chip says `N slots`, which is a count of *options*, not of what the user must do. |
| C-5 | `standaloneSub` | "N people in this poll · M of N have voted on times so far" | from-match's `sub` says "M of N have voted on times so far." — two sentences, one with a trailing period, one without. |
| C-6 | read-only banner | "This poll is read-only. Voting is closed." | Covers locked-in, cancelled, and archived with one sentence. See F-01/F-02. |
| C-7 | Discord | "Vote for the best time to play!" | Web never uses the word "best"; web asks for *all* times that work. The two surfaces ask for different things. |
| C-8 | `RescheduleModal` `PollBanner` | "Run a poll" | Creates a standalone scheduling poll and navigates away from the event; nothing warns that the event card flips to `RESCHEDULING` in Discord. |

---

## 8. Accessibility

Good, and worth preserving: every interactive control on `SchedulingSlotRow` has an explicit `aria-label` including the slot time; the vote button carries `aria-pressed`; the heatmap wrapper has an `isolate` stacking fix; the `✓` marker has `aria-label="You voted"`.

Gaps:

| # | Issue | Anchor |
|---|---|---|
| A-1 | **No live region.** Vote counts, voter avatars, and the progress bar all change without announcement. A screen-reader user has no way to know a vote registered besides re-reading the row. | `SchedulingSlotRow` |
| A-2 | **44px hit target missed** on the two most-used buttons: `+ Vote` and `Lock this time →` are `min-h-[36px]` flat, while `sticky-hero-buttons.tsx` established `min-h-[44px] sm:min-h-[36px]` for exactly this reason. | `SchedulingSlotRow.tsx` |
| A-3 | **Conflict warning is `title=` only** — not exposed to touch, not announced, truncated to the first event name in the visible text. | `SchedulingSlotRow` |
| A-4 | **Sticky toolbar hides the submit button on mobile scroll** with no keyboard-reachable equivalent lower down; focus can land on an off-screen transformed element. | `useSchedulingSticky` |
| A-5 | **`aria-hidden` sentinel + `h-px`** div precedes the toolbar; harmless, but the toolbar itself is not a `<header>`/`role="region"` and has no accessible name. | `SchedulingToolbar` |
| A-6 | Read-only banner is a plain `<div>`, not `role="status"`, so the transition open→closed is silent. | `SchedulingComposite` |
| A-7 | The heatmap is a click-grid; `AvailabilityHeatmapSection`/`GameTimeGrid` cell keyboard access is not established by this surface (inherited — verify before claiming it as new). | `SchedulingAvailability` |
| A-8 | Time labels use `toLocaleString('en-US', …)` hard-coded, ignoring the viewer's locale while the Discord side formats per-community timezone. | `SchedulingSlotRow::formatSlotTime` |

---

## 9. Known bugs and flakes (from `TECH-DEBT-BACKLOG.md`)

- **[high, main-reproduced 2026-07-02]** reschedule-poll lock-in embed re-render was carried by *ambient* embed traffic; on a quiet server the event card stayed on `RESCHEDULING`. **Fixed by ROK-1392** (`standalone-poll.service.ts::complete` now enqueues `'reschedule-poll-lockin'`). Keep the regression test — this is the shape the revamp must not reintroduce.
- **[med, open]** CI path filters (`discord-smoke` `paths:` in `.github/workflows/*` and the mirror in `validate-ci.sh`) **do not include `api/src/lineups/standalone-poll/**`**, which is exactly where the embed-affecting lock-in lives. An embed-affecting change there merges with **zero** Discord CI signal. **Any phase of this revamp that touches the poll embed must fix this filter first.**
- **[med, open]** `standalone-poll-reschedule-cycle.integration.spec.ts` cold-start schema race: first integration run of a session can fail 18 tests with FK DDL errors during bootstrap, not assertions. Did not reproduce in 5 consecutive reruns.
- **[low, open]** `ROK-1370: lock-in restores the live embed` is in the documented Scheduled-Event `pollForCondition` timeout family (`reference_known_smoke_flakes`) — rerun, do not investigate.
- **[low, recurring]** `community-lineup.smoke.spec.ts:638` / `lineup-votes-per-player.smoke.spec.ts:114` — create-modal slider `toBeVisible()` flakes under parallel shards. Same class; the suggested fix (assert the modal, then `scrollIntoViewIfNeeded`) applies to any new modal-based poll spec.
- `scripts/smoke/scheduling-poll-threshold.smoke.spec.ts` carries **six `test.skip` guards** on "need ≥2 members in DB" — the threshold path is effectively unexercised in CI whenever the seed is thin.

Existing Playwright coverage (the states that *are* pinned today): `scheduling-poll.smoke.spec.ts`, `standalone-scheduling-poll.smoke.spec.ts`, `scheduling-poll-threshold.smoke.spec.ts`, `cancel-poll-modal.smoke.spec.ts`, `lineup-scheduling-toggle.smoke.spec.ts`, `lineup-participants.smoke.spec.ts`, `calendar.smoke.spec.ts`.

---

## 10. Findings, ranked by user impact

| ID | Sev | Finding | Anchor |
|---|---|---|---|
| **F-17** | **critical** | **A vote cannot be cast from Discord.** The embed is read-only by design (ROK-1461 removed the button row); the only affordance is a masked link that costs an OAuth round-trip on mobile. The app's most-used function is unreachable from where the community actually is. | `discord-embed-scheduling.helpers.ts::buildDescription` |
| **F-19** | **critical** | **No live updates.** `useSchedulePoll` has `staleTime: 15s` and **no** refetch interval or socket; other people's votes never arrive. Concurrent voting — the normal case — shows every participant a different poll. | `use-scheduling.ts::useSchedulePoll` |
| **F-01** | **high** | **Locked-in is a dead end on the web.** `isReadOnly` renders "Voting is closed." and nothing else: not the winning time, not the created event, not a link to it. Discord's author line *does* say `● LOCKED IN · <time>`. The web page is strictly worse than the bot. | `SchedulingComposite::isReadOnly` |
| **F-06** | **high** | **Submit is a tax, not a ritual.** The vote already persisted; Submit only stamps a column. It doubles the cost of voting and triples the cost of changing a vote, and `partial` is structurally unreachable. | `scheduling-submit-copy.ts::deriveScheduleSubmitKind` |
| **F-18** | **high** | **Embed vote counts go stale.** Only lifecycle events re-render it; an ordinary vote does not. A healthy poll reads as abandoned in the channel. | `scheduling-poll-embed.service.ts::fireUpdateEmbed` |
| **F-02** | **high** | **Cancelled is indistinguishable from locked-in** on the web, and the operator's cancellation *reason* — collected by `CancelPollModal`, DM'd to voters — is never shown on the page voters land on. | `CancelPollModal.tsx` + read-only banner |
| **F-03** | **high** | **Tie order disagrees between surfaces.** Web `sortSlots` breaks ties by `proposedTime` asc; the embed's `sortedSlots` has no secondary key (`Array.prototype.sort` stability → DB order). Lock-in's fallback picks `sortedSlots[0]`. Same poll, two "winners". | `SchedulingSlotList::sortSlots` vs `discord-embed-scheduling.helpers.ts::sortedSlots` |
| **F-05** | **high** | **Late joiners get no orientation.** Added/self-enrolled members see the unvoted page with no "you joined late · 7 already voted · Thursday is leading" summary. On a poll near lock-in this is the difference between a vote and a bounce. | — |
| **F-08** | **high** | **The mobile submit button scrolls away.** The toolbar auto-hides on scroll-down and the submit lives in it; no secondary affordance exists lower in the page. | `use-scheduling-sticky.ts` |
| **F-04** | **med** | Deadline is web-only, and **past slots stay votable** (`· past` is cosmetic). | `SchedulingSlotRow::formatSlotTime` |
| **C-1** | **med** | `Lock this time →` labels **two different actions** on the same screen — submit-my-votes vs end-the-poll-for-everyone. | `submitCopy` vs `SchedulingSlotRow` |
| **F-16** | **med** | The embed cannot answer "did I already vote?" — it is one shared message with no per-viewer state. | `discord-embed-scheduling.helpers.ts` |
| **F-12 / A-2** | **med** | `+ Vote` and `Lock` are `min-h-[36px]` — the codebase's own `min-h-[44px] sm:min-h-[36px]` mobile pattern was not applied to the most-tapped button in the app. | `SchedulingSlotRow.tsx` |
| **A-1** | **med** | No live region: vote registration is silent to assistive tech. | `SchedulingSlotRow` |
| **F-07** | **med** | Non-members see live `+ Vote` buttons; rejection is server-side only, surfacing as a toast after the optimistic update rolls back. | `standalone-poll-auth.helpers.ts` |
| **F-10 / F-13** | **med** | 375px row crowding: operator rows carry avatars + count + conflict + two buttons; the toolbar stacks three *operator* actions above the member's own. | `SchedulingSlotRow` / `SchedulingToolbar` |
| **F-09 / A-3** | **med** | Conflict warning is `title=`-only and truncated — invisible on touch. | `SchedulingSlotRow` |
| **F-11** | **med** | `CalendarView` has **no** scheduling-poll affordance: an open poll for a time on the calendar is invisible there. | `web/src/components/calendar/CalendarView.tsx` |
| **F-14** | **low** | Heatmap sizing/breakpoints differ between the poll page and `RescheduleModal` (`compact` passed in one, not the other); three responsive thresholds (`sm`/`md`/767px) across one flow. | — |
| **F-15** | **low** | `buildEmbedSlots` computes `voterNames` that nothing renders — dead payload. | `scheduling-poll-embed.helpers.ts` |
| **F-20** | **low** | **CI blind spot:** `standalone-poll/**` is outside the `discord-smoke` path filter, so embed-affecting poll changes get no Discord CI. | `.github/workflows/*`, `scripts/validate-ci.sh` |
| **C-8** | **low** | "Run a poll" navigates away and silently flips the linked event's Discord card to `RESCHEDULING` with no warning. | `RescheduleModal::handlePoll` |

---

## Usage numbers (Lead to fill from prod)

I did not query prod. These are the questions that should decide which wireframe wins; every table and column below was verified against `api/src/drizzle/schema/`.

Tables: `community_lineups` (`id`, `created_at`, `phase_duration_override` — `->>'standalone' = 'true'` marks a standalone poll), `community_lineup_matches` (`id`, `lineup_id`, `game_id`, `status`, `linked_event_id`, `min_vote_threshold`, `created_at`, `updated_at`), `community_lineup_match_members` (`match_id`, `user_id`, `source` ∈ `voted|bandwagon|added`, `scheduling_submitted_at`), `community_lineup_schedule_slots` (`id`, `match_id`, `proposed_time`, `suggested_by` ∈ `system|user`, `created_at`), `community_lineup_schedule_votes` (`slot_id`, `user_id`, `created_at`).

```sql
-- Q1. Polls per week, split standalone vs from-lineup.
SELECT date_trunc('week', m.created_at) AS wk,
       COALESCE(l.phase_duration_override->>'standalone','false') = 'true' AS standalone,
       count(*) AS polls
FROM community_lineup_matches m
JOIN community_lineups l ON l.id = m.lineup_id
WHERE m.created_at > now() - interval '180 days'
GROUP BY 1,2 ORDER BY 1 DESC;

-- Q2. Votes per poll (distinct voters, and raw slot-votes) + slot count.
SELECT m.id AS match_id,
       count(DISTINCT v.user_id) AS distinct_voters,
       count(v.id)               AS slot_votes,
       count(DISTINCT s.id)      AS slots,
       count(DISTINCT mm.user_id) AS members
FROM community_lineup_matches m
LEFT JOIN community_lineup_schedule_slots s ON s.match_id = m.id
LEFT JOIN community_lineup_schedule_votes v ON v.slot_id = s.id
LEFT JOIN community_lineup_match_members mm ON mm.match_id = m.id
WHERE m.created_at > now() - interval '180 days'
GROUP BY 1 ORDER BY distinct_voters DESC;
-- then: SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY distinct_voters) over that set.

-- Q3. Median time to lock-in (poll created -> status flipped to 'scheduled').
-- CAVEAT: updated_at is the *last* touch, so this is an upper bound. If a
-- tighter number is needed, derive from the linked event's created_at instead
-- (second expression) and report both.
SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(epoch FROM m.updated_at - m.created_at))/3600 AS median_hours_updated_at,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(epoch FROM e.created_at - m.created_at))/3600 AS median_hours_via_event
FROM community_lineup_matches m
LEFT JOIN events e ON e.id = m.linked_event_id
WHERE m.status = 'scheduled' AND m.created_at > now() - interval '180 days';

-- Q4. Participation funnel: invited -> voted -> submitted.
SELECT count(*) FILTER (WHERE TRUE)                                 AS members,
       count(*) FILTER (WHERE voted)                                AS voted,
       count(*) FILTER (WHERE mm.scheduling_submitted_at IS NOT NULL) AS submitted
FROM community_lineup_match_members mm
JOIN community_lineup_matches m ON m.id = mm.match_id
LEFT JOIN LATERAL (
  SELECT TRUE AS voted FROM community_lineup_schedule_votes v
  JOIN community_lineup_schedule_slots s ON s.id = v.slot_id
  WHERE s.match_id = mm.match_id AND v.user_id = mm.user_id LIMIT 1
) vv ON TRUE
WHERE m.created_at > now() - interval '180 days';
-- The voted-but-never-submitted gap is the direct cost of F-06.

-- Q5. Slot provenance (does anyone use the suggest form, or is it all system slots?).
SELECT suggested_by, count(*) FROM community_lineup_schedule_slots
WHERE created_at > now() - interval '180 days' GROUP BY 1;

-- Q6. Late joiners: members created after the first vote on their match.
SELECT count(*) FROM community_lineup_match_members mm
JOIN LATERAL (
  SELECT min(v.created_at) AS first_vote FROM community_lineup_schedule_votes v
  JOIN community_lineup_schedule_slots s ON s.id = v.slot_id WHERE s.match_id = mm.match_id
) f ON TRUE
WHERE f.first_vote IS NOT NULL AND mm.created_at > f.first_vote;
```

**Not answerable from the DB as it stands: "share of votes cast from Discord vs web."** There is no referrer/source column on `community_lineup_schedule_votes`, and votes cannot be cast in Discord at all (F-17), so the honest answer today is **100% web**. The useful proxy is *how many web votes were initiated by a Discord click*, which needs one of:
1. a `source text` column on `community_lineup_schedule_votes` (cheapest — 1 migration, set from a `?src=discord` query param the embed's `buildPollUrl` appends); or
2. a UTM-style param counted in `activity_log`.
**Recommend (1) as part of phase 1** so the phase-2 Discord-voting work has a baseline to beat. Flag to the Lead: until that column exists, any "Discord vs web" number is a guess.

---

## Principles

Six rules. Every wireframe below is scored against them; a layout that fails P-1 or P-2 is not a candidate.

**P-1 — One glance answers "when are we playing?"**
Above the fold, before any interaction, on a 375px screen: the leading time, its vote count, how far it is from deciding, and when the poll closes. Today the leading slot is one row among N below a hero, a deadline banner, and a full week heatmap. The heatmap is *analysis*; the leader is *the answer*. Ranked answer first, analysis on demand.

**P-2 — Vote is the primary action: one tap on mobile, and it is done.**
No submit step. The vote persists on tap and the UI says so. `scheduling_submitted_at` keeps its quorum meaning by being stamped on first vote (server-side), not by a second button. This **supersedes the Cycle 4 U4 SubmitBar for the scheduling surface only** — Nominating and Voting keep it, because there the user spends a *budget* and "I'm finished" is real information. Changing a vote is one tap, same as casting it.

**P-3 — Live updates without reload.**
Other people's votes appear while you are looking. Socket if the infrastructure supports it; otherwise a `refetchInterval` while the tab is focused and the poll is open. The counter that says "6 of 9 voted" must be true, not 15-second-stale. Optimistic writes stay; they stop being the *only* source of motion.

**P-4 — One visual language, no new primitives.**
Tokens from `web/src/index.css`; primitives from `web/src/components/ui/` — `modal`, `bottom-sheet` (mobile sheets, as `RescheduleModal` already does), `filter-panel`, `nav-chip`, `fab`, `scroll-collapsible` — plus the shipped `JourneyHero` and `MemberAvatarGroup`. **Invent nothing.** This lands next to the ROK-1539 design system; a bespoke component here is debt on day one. Hit targets follow the established `min-h-[44px] sm:min-h-[36px]`.

**P-5 — Discord and the web tell the same story.**
Same status grammar (`POLL OPEN` / `LOCKED IN · <time>` / `POLL CLOSED` / `CANCELLED`), same slot order including the tiebreak, same counts, same words. The embed re-renders on votes, not only on lifecycle events. Long-run: a vote is castable from Discord — the surface where the community already lives (F-17).

**P-6 — Late joiners are never lost.**
Arriving at minute 50 of a 60-minute poll must be as legible as arriving at minute 1: what is winning, what is still open, how long is left, and the single next tap. No state renders as "an empty form you missed the context for."

### Superseding Cycle 4 (Ss/Sx)

`web/src/dev/simplify-wireframes/README.md` remains in force **except**:

| Cycle 4 rule | ROK-1540 ruling | Why |
|---|---|---|
| **U4 SubmitBar on Ss/Sx** ("SubmitBar at bottom for bulk 'Lock all my matches'") — already partially diverged when ROK-1300 moved submit into the sticky toolbar | **Removed on this surface.** Vote is the commit (P-2). `scheduling_submitted_at` stamped server-side on first vote. | The submit ritual closes a "did that count?" loop that only exists where there is a vote budget. Scheduling has none; the ritual is pure cost (F-06). |
| **"Group availability heatmap"** as the page's primary body | **Demoted.** The ranked slot list is primary; the heatmap is a secondary "Find a better time" view. | P-1. The heatmap answers "when *could* we play"; the poll's job is "when *are* we playing". |
| **Glossary: "Schedule is the time-picking phase"** | Unchanged, and tightened: `Lock` means *end the poll* and nowhere else (fixes C-1). | The label collision post-dates the glossary rule. |
| Everything else (JourneyHero, U2 game ref, noRibbon standalone mode, one component two entry points) | **Unchanged and required.** | Shipped and working. |
