# ROK-1540 — Scheduling poll experience: audit, principles, wireframes, plan

**Spike.** Operator framing: the scheduling poll is *"probably the most used function of the entire app"* and it must be *"top tier."* Operator ruled **both** poll surfaces in scope.

**Method.** Derived from source + tests on `origin/main@6e828478` — no browser session. Every claim below carries a `file:symbol` anchor so the landing lane can verify without re-deriving. **Re-verified against `main` on 2026-09-13** in the landing lane's review pass; three findings were corrected against the code at that point (F-18, F-20, C-7/C-8) and carry an inline note saying so. Usage numbers are **measured** against prod (read-only psql, 2026-09-13 17:05Z), not guessed; two of them are marked *not measured* rather than estimated: see [Usage numbers](#usage-numbers-measured-on-prod-2026-09-13).

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
2. **Reschedule *poll*** — the same modal's `PollBanner` ("Poll for Best Time") calls `useCreateSchedulingPoll({ gameId, linkedEventId })` and **navigates to Surface A** (`/community-lineup/:lineupId/schedule/:matchId`). The linked event's Discord card flips to `RESCHEDULING`; lock-in (`StandalonePollService.complete`) restores it and enqueues an explicit embed sync (ROK-1392).

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
| 10 | **Viewer without vote rights** | not a member | Vote is **not** gated client-side; the server owns enrolment (`scheduling-guard.helpers.ts::assertCallerMayVote`). On a **public** lineup the vote succeeds and self-enrols the voter (`scheduling.service.ts:207-211`, `ensureMatchMember` inside the vote transaction) — that is intended. Only on a **private** lineup is it rejected. | F-07 |
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

**Freshness.** The embed is push-rendered from `fireUpdateEmbed(matchId)`, which **is** called on every mutation — `suggestSlot` (`scheduling.service.ts:155`), both branches of `toggleVote` (`:213` insert, `:217` delete), `retractAllVotes` (`:227`), `createEventFromSlot` (`:263`) and `cancelPoll` (`:332`) — and `updateEmbed` does a full rebuild + `editEmbed` whenever `embedMessageId` is set. So the counts are **not** stale. The defect is the opposite one: the call is `void this.updateEmbed(...).catch(logger.error)` (`scheduling-poll-embed.service.ts:130-134`) — **fire-and-forget and un-debounced**, so a burst of votes fans out one full rebuild + Discord edit each, and every failure is swallowed into a log line the poll never recovers from. F-18.

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
| C-7 | Discord | "Vote for the best time to play!" | Both entry points sell *best* — the web's own `PollBanner` says "post a Discord poll for the **best** time" / "Poll for Best Time" (`reschedule-controls.tsx:6,9`) — but the poll page you land on asks for **all** times that work. The pitch and the task disagree. |
| C-8 | `RescheduleModal` `PollBanner` | "Poll for Best Time" (`reschedule-controls.tsx:9`) | Creates a standalone scheduling poll and navigates away from the event; nothing warns that the event card flips to `RESCHEDULING` in Discord. |

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
- **[RESOLVED for `standalone-poll`, still open for `scheduling`]** The `discord-smoke` path filters were extended to `api/src/lineups/standalone-poll/**` on 2026-07-17 (`.github/workflows/discord-smoke.yml:31`, `scripts/validate-ci.sh:400`; `TECH-DEBT-BACKLOG.md:205` marks it RESOLVED). **But `api/src/lineups/scheduling/**` is in neither filter** — and that is where `scheduling-poll-embed.service.ts`, the file that actually builds and edits the poll embed, lives. An embed-affecting change there still merges with **zero** Discord CI signal. **Any phase of this revamp that touches the poll embed must fix that filter first.**
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
| **F-18** | **med** | **Embed re-render is fire-and-forget and un-debounced.** Every vote triggers a full rebuild + Discord `editEmbed`; a vote burst fans out one edit each (rate-limit exposure), and a failed render is only `logger.error`'d — the embed then stays wrong with nothing to retry it. *(Corrected 2026-09-13: an earlier draft claimed votes do not re-render the embed at all. They do — `toggleVote` calls `fireUpdateEmbed` on both branches.)* | `scheduling-poll-embed.service.ts::fireUpdateEmbed` |
| **F-02** | **high** | **Cancelled is indistinguishable from locked-in** on the web, and the operator's cancellation *reason* — collected by `CancelPollModal`, DM'd to voters — is never shown on the page voters land on. | `CancelPollModal.tsx` + read-only banner |
| **F-03** | **high** | **Tie order disagrees between surfaces.** Web `sortSlots` breaks ties by `proposedTime` asc; the embed's `sortedSlots` has no secondary key (`Array.prototype.sort` stability → DB order). Lock-in's fallback picks `sortedSlots[0]`. Same poll, two "winners". | `SchedulingSlotList::sortSlots` vs `discord-embed-scheduling.helpers.ts::sortedSlots` |
| **F-05** | **high** | **Late joiners get no orientation.** Added/self-enrolled members see the unvoted page with no "you joined late · 7 already voted · Thursday is leading" summary. On a poll near lock-in this is the difference between a vote and a bounce. | — |
| **F-08** | **high** | **The mobile submit button scrolls away.** The toolbar auto-hides on scroll-down and the submit lives in it; no secondary affordance exists lower in the page. | `use-scheduling-sticky.ts` |
| **F-04** | **med** | Deadline is web-only, and **past slots stay votable** (`· past` is cosmetic). | `SchedulingSlotRow::formatSlotTime` |
| **C-1** | **med** | `Lock this time →` labels **two different actions** on the same screen — submit-my-votes vs end-the-poll-for-everyone. | `submitCopy` vs `SchedulingSlotRow` |
| **F-16** | **med** | The embed cannot answer "did I already vote?" — it is one shared message with no per-viewer state. | `discord-embed-scheduling.helpers.ts` |
| **F-12 / A-2** | **med** | `+ Vote` and `Lock` are `min-h-[36px]` — the codebase's own `min-h-[44px] sm:min-h-[36px]` mobile pattern was not applied to the most-tapped button in the app. | `SchedulingSlotRow.tsx` |
| **A-1** | **med** | No live region: vote registration is silent to assistive tech. | `SchedulingSlotRow` |
| **F-07** | **med** | Non-members see live `+ Vote` buttons with no indication of which of the two things will happen: on a **public** lineup the vote self-enrols them (intended), on a **private** one it is rejected server-side and surfaces as a toast after the optimistic update rolls back. Same button, two outcomes. | `scheduling-guard.helpers.ts::assertCallerMayVote` |
| **F-10 / F-13** | **med** | 375px row crowding: operator rows carry avatars + count + conflict + two buttons; the toolbar stacks three *operator* actions above the member's own. | `SchedulingSlotRow` / `SchedulingToolbar` |
| **F-09 / A-3** | **med** | Conflict warning is `title=`-only and truncated — invisible on touch. | `SchedulingSlotRow` |
| **F-11** | **med** | An event under an active poll is **filtered out of the calendar entirely** — `CalendarView.tsx:92` does `if (event.reschedulingPollId) return false;`. It is not that the poll has no affordance on the calendar; the event itself vanishes from it for the whole life of the poll. | `web/src/components/calendar/CalendarView.tsx:92` |
| **F-14** | **low** | Heatmap sizing/breakpoints differ between the poll page and `RescheduleModal` (`compact` passed in one, not the other); three responsive thresholds (`sm`/`md`/767px) across one flow. | — |
| **F-15** | **low** | `buildEmbedSlots` computes `voterNames` that nothing renders — dead payload. | `scheduling-poll-embed.helpers.ts` |
| **F-20** | **low** | **CI blind spot:** `api/src/lineups/scheduling/**` — home of `scheduling-poll-embed.service.ts` — is outside the `discord-smoke` path filter, so embed-affecting poll changes get no Discord CI. *(Corrected 2026-09-13: the `standalone-poll/**` half of this gap was closed on 2026-07-17; the `scheduling/**` half was never opened.)* | `.github/workflows/discord-smoke.yml:31`, `scripts/validate-ci.sh:400` |
| **C-8** | **low** | "Poll for Best Time" navigates away and silently flips the linked event's Discord card to `RESCHEDULING` with no warning. | `reschedule-controls.tsx::PollBanner` |

---

## Usage numbers (measured on prod 2026-09-13)

**Measured on prod (raid-ledger allinone, read-only psql) at 2026-09-13 17:05Z.** Window = last 180 days unless stated. The queries below are kept verbatim so any number here can be re-derived; every table and column was verified against `api/src/drizzle/schema/`.

### Results

| Q | Question | Measured |
|---|---|---|
| **Q1** | Polls per week | **53 polls / 180 days across 27 lineups** (~2/wk, very bursty). By week start: `09-07` 4 · `08-31` 2 · `08-24` 2 · `08-17` 1 · `08-03` 2 · `07-20` 2 · `07-06` 2 · `06-29` 1 · `06-22` 1 · `06-15` 8 · `05-11` 10 · `05-04` 8 · `04-27` 1 · `04-20` 4 · `04-06` 5. **Standalone-vs-lineup split not run**; proxy = 6 polls linked to an event, 47 unlinked. Status, all time: suggested 24 · scheduled 15 · archived 7 · scheduling (open) 7. |
| **Q2** | Votes per poll | median distinct voters **0** (mean 1.42) · median slot-votes **0** · median slots **0** · median members **2**. **30 of 53 polls (57%) got zero votes.** |
| **Q3** | Median time to lock-in | **Not measured** — the query was not obtained this pass. Treat lock-in latency as unknown; the `updated_at` caveat below still applies whenever it is run. |
| **Q4** | Funnel invited → voted → submitted | **140 members → 67 voted → 9 submitted.** 58 voted but never submitted: **87% of voters never press Submit.** This is F-06 measured, not inferred. |
| **Q5** | Slot provenance | **user 91 · system 0** — nobody is ever offered a system-suggested slot; every slot is hand-typed. |
| **Q6** | Late joiners | **7** members joined after the first vote on their match. |
| — | Discord-vs-web vote share | **100% web** — unmeasurable otherwise, see the note at the end of this section (F-17). |

**What the numbers change.** Q2 and Q4 are the load-bearing ones. A median poll with **zero** votes and two members means the ranked-list-first candidates (B, C) are optimising the right thing — there is no dense availability grid to render, and a heatmap-first layout (A) spends the fold on data that usually does not exist. Q4 turns F-06 from a UX opinion into an 87% drop-off. Q5 says the suggest form is the only slot source, so it cannot be demoted below the fold.

**Two gaps, stated rather than guessed:** Q3 (time to lock-in) and the standalone-vs-lineup split of Q1 were not obtained this pass — they are marked *not measured*, not estimated.



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
| **The poll header** — `JourneyHero` "🗓 SCHEDULING POLL · STARTED BY …", the **Participants · N** avatar button, **ADD PARTICIPANTS / REMIND VOTERS / CANCEL POLL**, the task line "Pick a time that works for everyone." + "N people in this poll · k of N have voted on times so far", and the game-ref row (cover, game ⓘ, "You + 3 members", avatar stack; its **Lock this time →** button is the member submit today — see the Header sub-section for what it becomes) | **Kept as-is — operator ruling 2026-09-13** ("I'm happy with this section"). | The redesign changes what sits BELOW the header: leader card, slot ladder, heatmap sheet, terminal states. |

### Header — kept as-is (operator ruling 2026-09-13)

Binding on every phase-1 story (P1-1 … P1-4). Implementers use the shipped `JourneyHero` +
`SchedulingToolbar` + `LineupParticipantsButton` + `SchedulingGameRefBanner` unchanged; the
wireframes' own header blocks (Layout B's status/deadline `Header`, the "shipped header" strip
above every layout) are NOT a replacement for them. Findings that touch the header are scoped
accordingly:

| Finding | Scope under the ruling |
|---|---|
| **F-13** (toolbar stacks three operator actions above the member's own on 375px) | Resolved by **removing the member Submit** from the toolbar (P1-2), not by moving or restyling Add Participants / Remind Voters / Cancel Poll. |
| **F-08 / A-4** (auto-hiding toolbar takes the submit with it) | After P1-2 the toolbar carries only operator actions; P1-4 AC5 keeps the operator's lock reachable — the auto-hide behaviour and the header's layout are unchanged. |
| **A-5** (toolbar has no landmark/name) | Add `role`/accessible name only; no visual change. |
| **C-2** (hero task copy differs between modes) | "Pick a time that works for everyone." is the approved wording; unify the from-match copy to it only with an explicit operator OK — do not invent a third phrase. |
| **P1-2 AC4** (`Lock this time →` survives only as the operator's end-the-poll action) | **Careful:** the `Lock this time →` button in the game-ref row of the screenshot is `StickyHeroScheduleSubmitButton` — the MEMBER submit that P1-2 retires (C-1: same label as the operator's per-slot lock in `SchedulingSlotRow`). The row itself (cover, game ⓘ, "You + 3 members", avatar stack) stays. Its button becomes the **operator/creator-only** "Lock this time →" that ends the poll on the leading slot (same action as the per-slot lock, surfaced once in the header), and is hidden for plain members. If the operator prefers the row without a button, drop it — but never keep a member-submit there. |


---

## Wireframes

**Route:** `/dev/wireframes/scheduling` (DEMO_MODE-gated, redirects to `/` otherwise — same `useSystemStatus().demoMode` gate and `lazy-routes.ts` registration as `/dev/wireframes/simplify`).
**Source:** `web/src/dev/scheduling-wireframes/` — `SchedulingWireframesPage.tsx` (gate + switchers), `wireframe-states.ts` (the 11 mocked states, pure), `wireframe-chrome.tsx` (device frames, switchers, rationale, shared bits), `LayoutAHeatmap.tsx`, `LayoutBLadder.tsx`, `LayoutCTimeline.tsx`.
**Tests:** `web/src/dev/scheduling-wireframes/__tests__/scheduling-wireframes.test.tsx` — 43 test cases: every layout × every state mounts, the gate redirects, both switchers change the render, and the tiebreak comparator is pinned (by `id`, which the mocks assign chronologically — the real rule sorts on `proposedTime`; see the JSDoc on `leader()`).

Each candidate renders desktop **and** 375px mobile side by side, for whichever of the 11 audited states the switcher selects, off mocked data with no API. Each carries its own in-page pitch/wins/trade-offs block.

| | A — Calendar-first heatmap | B — Slot cards / vote ladder | C — Conversation timeline |
|---|---|---|---|
| Vote gesture | tap a grid cell | tap a full-width row | tap "I'm in" |
| P-1 one glance | answer strip above the grid | leader promoted to a card | sticky verdict bar |
| P-2 one tap mobile | yes, but the target is a grid cell | **yes, 56px rows** | yes, 44px button |
| Late joiners (P-6) | weakest — grid has no narrative | leader card + "joined late" line | **strongest — catch-up line is native** |
| Build cost | medium (reuses `GameTimeGrid`) | **lowest — closest to shipped tree** | highest |
| Main risk | 7 columns do not fit 375px | demotes the heatmap Cycle 4 made primary | invites comments (real scope) |

**My read, for the operator to overrule:** **B** is the safest primary and the cheapest to ship; **C**'s catch-up line and "who hasn't voted" panel are its best ideas and should be folded into B rather than built separately; **A** should be kept as the *"Find a better time"* sheet inside B, which is exactly where the wireframe puts it. That would be one shipped layout, not three.

---

## Implementation plan

Four phases. Every story is **`standard` tier** — each touches `packages/contract/**` or a rendered user-facing flow, so none qualifies for the trivial fast lane. Phases are strictly ordered: phase 2 asserts parity against whatever phase 1 shipped, and phase 3's live updates are meaningless before the page is worth watching. The Lead files these once the operator picks a layout; the ACs below assume **B**, and the phase-1 ACs that name a layout are the only ones that change if the operator picks otherwise.

### Phase 1 — The web page

**P1-1 · `feat: scheduling poll answers "when are we playing?" in one glance`**
- AC0 The shipped header (see *Header — kept as-is*) is untouched; the leader card renders directly below it, above the slot list.
- AC1 On any viewport, the leading time, its vote count, the members count, and the deadline are visible without scrolling, above the slot list.
- AC2 Tie is explicit: when the top two slots are level, the page says so and names the rule (earliest time wins).
- AC3 The heatmap is no longer the primary body; it opens from one affordance — `BottomSheet` below 768px, `Modal` above, per `RescheduleModal`'s existing pattern.
- AC4 No new design primitives: only `web/src/index.css` tokens and `web/src/components/ui/**` + the shipped `JourneyHero` / `MemberAvatarGroup`.
- Contract: **none.**

**P1-2 · `feat: one-tap voting — retire the scheduling submit step`**
- AC1 Tapping a slot casts or withdraws the vote and is the complete action; no Submit button remains on the scheduling surface.
- AC2 Changing a vote after having voted costs **one** tap (today: three). Prove it with a test that counts interactions.
- AC3 `scheduling_submitted_at` is stamped **server-side on the member's first vote** and cleared on their last withdrawal, so quorum, `SchedulingVoteProgress`, the reminder cron's non-voter query and `getHeroState`'s `waiting` tone keep working unchanged.
- AC4 `scheduling-submit-copy.ts` / `use-schedule-submit-state.ts` are deleted or reduced to the hero-tone selector; `Lock this time →` survives **only** as the operator's end-the-poll action (fixes C-1).
- AC5 The nudge, the `empty`/`partial`/`pre`/`post` machine and the sticky-toolbar submit are removed from this surface only — Nominating and Voting are untouched.
- Contract: `SchedulePollPageResponseSchema` — no shape change required, but confirm `members[].schedulingSubmittedAt` consumers.
- **Migration: none** (the column stays; only who writes it changes).
- Doc: update `web/src/dev/simplify-wireframes/README.md` §Ss/Sx to point at §Superseding Cycle 4 so the next agent does not "restore" the SubmitBar.

**P1-3 · `feat: terminal poll states say what happened`**
- AC1 Locked-in renders the winning time and a link to the created event, not "Voting is closed" (F-01).
- AC2 Cancelled is visually and textually distinct from locked-in and renders the operator's reason (F-02).
- AC3 Expired renders "the deadline passed without a lock-in" plus the next action; past slots are **not** votable (F-04).
- AC4 On a **private** lineup a non-member sees no vote affordance rather than one that fails server-side. On a **public** lineup the button stays and says it will add them to the poll — self-enrolment is deliberate (`ensureMatchMember`) and must not be removed (F-07).
- AC5 A member who joined after voting started gets a catch-up line: leader, votes-so-far, time remaining (F-05, P-6).
- Contract: `SchedulePollPageResponseSchema` **+** `pollStatus: z.enum(['open','locked_in','cancelled','closed'])`, `lockedInTime: z.string().nullable()`, `cancelReason: z.string().nullable()`, `canVote: z.boolean()`, `joinedAt: z.string()` on the viewer's member row. Server derives `pollStatus` from `match.status` + the cancellation record using the **same** helper the embed uses (`pollStatusFromMatch`, extended for `cancelled`) — one function, both surfaces.
- **Migration: one.** `cancelReason` has no source of truth today — `scheduling-cancel.helpers.ts:100-112` writes only `status: 'archived'` and hands the reason to `buildCancelNotifications`, which DMs it and drops it. AC2 therefore needs the reason persisted (a `cancellation_reason` column on `community_lineup_matches`, or an audit row). Budget for it up front rather than discovering it mid-story.

**P1-4 · `fix: scheduling poll accessibility and mobile hit targets`**
- AC1 `+ Vote` / row targets are `min-h-[44px] sm:min-h-[36px]`, matching `sticky-hero-buttons.tsx` (A-2).
- AC2 A polite live region announces the viewer's own vote and the leader changing (A-1).
- AC3 Conflict warnings are visible text, not `title=`-only, and name every conflicting event (A-3, F-09).
- AC4 The read-only / terminal banner is `role="status"` (A-6).
- AC5 No primary action can be scrolled out of reach on mobile with no keyboard-reachable equivalent (F-08, A-4).
- Contract: **none.**

**Playwright, phase 1** (`scripts/smoke/scheduling-poll.smoke.spec.ts` + `standalone-scheduling-poll.smoke.spec.ts`, **desktop + mobile**): vote in one tap and assert the count without a submit; change the vote in one tap; assert leader + deadline visible without scrolling at 375px; assert each terminal state's copy; assert a non-member sees no vote button. Run the full suite — new rows on a shared page break selectors elsewhere.

### Phase 2 — Discord parity

**P2-0 · `chore(ci): put lineups/scheduling under the discord-smoke path filter`** — **do this first.** `api/src/lineups/standalone-poll/**` is already covered (2026-07-17). Add `api/src/lineups/scheduling/**` — which holds `scheduling-poll-embed.service.ts` — to the GitHub `discord-smoke` `paths:` filter (`.github/workflows/discord-smoke.yml:31`) *and* the mirrored detector (`scripts/validate-ci.sh:400`), plus the CLAUDE.md trigger list. Without it the rest of phase 2 merges with zero Discord CI signal (F-20).

**P2-1 · `fix: one slot order across web and Discord`**
- AC1 One exported comparator — votes desc, then `proposedTime` asc, then `id` — imported by `SchedulingSlotList::sortSlots`, `discord-embed-scheduling.helpers.ts::sortedSlots` **and** the lock-in fallback in `schedulingPollAuthorLine`.
- AC2 A unit test pins that a constructed tie orders identically in all three call sites (F-03).
- AC3 `buildEmbedSlots`'s unused `voterNames` is either rendered or removed (F-15).

**P2-2 · `perf: debounce the poll embed re-render and stop swallowing its failures`**
- AC1 A vote enqueues an embed sync for the poll's message, debounced so a burst of votes does not fan out one full rebuild + `editEmbed` each. (The re-render itself already happens — see F-18 — so this story is about the fan-out, not about adding the call.)
- AC2 A render that fails is retried rather than swallowed by `fireUpdateEmbed`'s `.catch(logger.error)`; the embed never silently keeps a stale body (F-18).
- AC3 The embed carries the deadline (F-04) and the cancellation reason on a cancelled poll (F-02).
- AC4 Status grammar is generated from the same helper as the web page's `pollStatus`, including a `CANCELLED` state the embed does not have today (P-5).
- Contract: none; `SchedulingPollStatus` in `discord-embed-scheduling.types.ts` gains `'cancelled'`.
- **Companion-bot smoke required** (`tools/test-bot/src/smoke/tests/`): vote → assert the embed's counts move; cancel → assert `POLL CANCELLED` + reason; lock in → assert `LOCKED IN · <time>` and that the linked event's card leaves `RESCHEDULING` (the ROK-1392 regression — keep it).

**P2-3 · `chore: instrument where poll votes come from`** — add `source text` to `community_lineup_schedule_votes` (default `'web'`), set from a `?src=discord` param appended by `buildPollUrl`. One migration, self-contained, no app-side backfill. This is what makes the phase-4 decision evidence-based instead of a guess; see [Usage numbers](#usage-numbers-measured-on-prod-2026-09-13).

### Phase 3 — Live updates

**P3-1 · `feat: poll votes appear without a reload`**
- AC1 A second participant's vote appears on an open poll within a bounded interval, with no user action.
- AC2 Polling (or the socket subscription) is active **only** while the tab is focused and the poll is open — no background traffic on a locked/cancelled poll.
- AC3 Optimistic local writes still apply instantly and are never clobbered by an in-flight refetch.
- AC4 The operator's lock-in confirm reads a fresh distinct-voter count, not a stale one (the double-lock race in §6).
- Decision to make in the story, not here: `refetchInterval` (cheap, no infra) vs. a socket channel (correct, but check what the app already runs). Default to `refetchInterval` unless a socket layer already exists — this phase must not become an infrastructure project.
- Contract: none.
- **Playwright:** two browser contexts, one poll — context A votes, context B observes the count change without reloading.

### Phase 4 — Vote from Discord (gated on numbers)

**P4-1 · `feat: cast a scheduling vote from the Discord embed`**
- Restores an action row to the scheduling-poll embed family — deliberately removed by ROK-1461, so this needs an explicit operator ruling before it is filed, and the ROK-1461 rationale must be read first.
- Per-viewer state is the hard part: one shared message cannot show "you voted" (F-16). The tractable shape is buttons that open an **ephemeral** reply carrying the viewer's own state, mirroring how the reschedule DM already handles per-user confirm/decline (`reschedule-response.listener.ts`).
- **Do not file until P2-3's `source` column has a few weeks of data.** If the masked "Vote now ↗" link already converts, this is a large change for a small delta; if it does not, F-17 is the single highest-impact item in this audit and this phase is the whole point.
- **Companion-bot smoke required**, and note bots cannot click other bots' components — the button *handler* is tested in a NestJS integration test, the embed shape in smoke.

### Sequencing

P1-1 → P1-2 → P1-3 are one lane in order (they touch the same files); P1-4 can ride the last of them. P2-0 is a one-line CI change that must land before any other phase-2 work. P2-1 is independent of phase 1 and can start any time. P3 waits for phase 1. P4 waits for data.
