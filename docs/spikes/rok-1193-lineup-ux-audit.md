# Lineup UX Audit — ROK-1193

**Spike scope:** flow clarity per `(page × persona × phase-state)`. Output is the input for follow-up implementation tickets — no fixes are made here. Sister deliverable: previewable React wireframes at `/dev/wireframes/lineup/...` (DEMO_MODE-gated).

**Method:** code-walk of `web/src/pages/lineup-detail-page.tsx`, `web/src/pages/scheduling-poll-page.tsx`, and `web/src/components/lineups/**`, plus a smoke pass through the live dev env at http://localhost:5173. Severity is heuristic and based on impact to the "what do I do next?" question — not visual polish.

## Codebase reality

The Linear ticket references paths that don't exist. Real layout (verified in worktree, 2026-04-29):

| Linear says | Actual file / status |
|---|---|
| `web/src/pages/lineups/index.tsx` | **Does NOT exist.** No `/lineups` index page. |
| `web/src/pages/community-lineups/...` | **Does NOT exist.** Detail lives at `web/src/pages/lineup-detail-page.tsx`. |
| Scheduling poll | `web/src/pages/scheduling-poll-page.tsx` |
| Insights / community tab | `web/src/pages/insights-community-tab.tsx` |
| Lineup primitives | `web/src/components/lineups/` (banner, leaderboard, etc.) |

**Active routes** (`web/src/app-routes.tsx`):
- `/community-lineup/:id` → `LineupDetailPage` (handles all phases through one component)
- `/community-lineup/:lineupId/schedule/:matchId` → `SchedulingPollPage`
- `/insights/community` → `InsightsCommunityTab`

**Lineup discovery today:** the only entry point is the `LineupBanner` rendered on `/games`. There is no list view of past or other concurrent lineups beyond `OtherActiveLineups` (also on `/games` via the banner) and `PastLineups` rendered at the bottom of `LineupDetailPage`. The matrix's "Lineups index" page is therefore treated as a **proposed future page** in this audit and the wireframes — every cell for that page is a "gap" rather than a "finding."

## Phase vocabulary (from `web/src/components/lineups/lineup-phases.ts`)

API status → user-facing label:
- `building` → "Nominating"
- `voting` → "Voting"
- `decided` → "Scheduling"
- `archived` → "Archived"

The mapping is itself a mild UX hazard (label vs. status drift) — surfaced as Finding F-13 below.

## Personas (5)

- **P1 — Invitee, not yet acted.** On the invite list (or in the public guild for public lineups), has not nominated/voted/joined a match.
- **P2 — Invitee, already acted.** Has cast at least one vote, joined a match, suggested a slot, etc., for the current phase.
- **P3 — Organizer / Operator.** Lineup creator OR `isOperatorOrAdmin === true`. Can advance phases via `LineupDetailHeader` breadcrumb, edit metadata, manage invitees, force-resolve tiebreakers, cancel the lineup.
- **P4 — Admin (global).** Same permissions as P3 but may not be a participant. Distinct from P3 because the "primary CTA" question shifts: P4 is governing, not playing.
- **P5 — Uninvited member.** Logged in, not on the invite list. For private lineups: read-only with a "Private — ask creator for invite" notice (`canParticipate === false`). For public lineups: same as P1.

## Phase-state cross-cuts (5)

- **S1 — Phase active, plenty of time** (deadline > 24h or no deadline)
- **S2 — Phase active, deadline <24h**
- **S3 — Phase active, deadline missed (auto-advance pending)**
- **S4 — Phase complete (read-only retrospective)**
- **S5 — Lineup aborted** (admin kill-switch, ROK-1062)

## Audit Matrix — Aggressive Collapse

The 8 × 5 × 5 = 200-cell raw matrix collapses to ~40 unique findings/gaps. Collapsing rules:

- **R1** — When the UX is identical across all personas in a phase, the row is a single line ("All personas: …").
- **R2** — When `canParticipate` is `false` (uninvited on private), the experience collapses to "read-only + private notice" regardless of phase. Single row.
- **R3** — Phase-states S1 and S2 are usually identical except for deadline urgency styling. Collapsed unless they materially change the "what next" verb.
- **R4** — Phase-state S5 ("aborted") is uniformly read-only with a kill-switch notice. Single row.
- **R5** — P3 (organizer) and P4 (admin) collapse when their action set is identical. Diverged when not.

---

### Page 1 — Lineups index (`/lineups`, **PROPOSED, does not exist today**)

This page does not exist. There is no central list of active or recent lineups; users find lineups via:
- the `/games` page banner (`LineupBanner` for the primary lineup, `OtherActiveLineups` for parallels)
- `PastLineups` rendered at the bottom of an open lineup
- direct URL `/community-lineup/:id` (e.g. from Discord embeds)

Every cell in this row is therefore a **gap, not a finding**. The wireframe represents what the page could look like.

| Cell | What's there today | What user should do | Gap | Sev |
|---|---|---|---|---|
| All personas, all states | Page does not exist. | (proposed) Browse active lineups, jump to one I belong to, see history. | No central "where are my lineups" view. Discovery only via banner on `/games` or direct link. | **high** |
| P3/P4 ops cell | Page does not exist. | (proposed) Spot stuck/aborted lineups, jump to admin-tier housekeeping. | No ops-level lineup index. | medium |

Severity: medium-to-high overall — works around it via Discord embeds and banner, but onboarding new members is opaque.

---

### Page 2 — Lineup detail shell (`/community-lineup/:id` cross-phase wrapper)

Cross-phase chrome: header (`LineupDetailHeader`), phase breadcrumb + circle, optional `PrivateInviteesSection`, optional `SteamNudgeBanner`, `ActivityTimeline`, `PastLineups` footer.

| Cell | What's there today | What user should do | Gap | Sev |
|---|---|---|---|---|
| All personas, S1–S2 (active) | Phase circle + breadcrumb (operators can click to advance/revert), title, status badge, countdown if deadline set, started-by line. | Understand what phase I'm in and how far I've progressed. | **F-1** Phase progress is two parallel indicators (breadcrumb arrows + circle %) — neither calls out "Step 2 of 4" in plain language. Operator confirm-on-double-click is cool but invisible to non-operators. | medium |
| All personas, S2 (deadline <24h) | `PhaseCountdown` colors red when close. | Act before the deadline. | **F-2** Countdown urgency is conveyed only by color in the header — there's no banner or sticky-CTA reminding the invitee they haven't acted. | **high** |
| All personas, S3 (deadline missed, awaiting auto-advance) | Header still reads as the previous phase; countdown shows negative or "expired". | Wait. (Operator: advance now.) | **F-3** No "this phase ended N minutes ago, advancing automatically" affordance. User sees stale UI and may try to re-act. | **high** |
| All, S4 (phase complete / archived) | Header shows `archived` badge; breadcrumb shows last reached phase. | Read retrospective. | **F-4** No retrospective summary on the shell — the archived view drops users straight into the last phase rendering. | medium |
| All, S5 (aborted) | No dedicated UI. Lineup either disappears from listings or presents as last-rendered phase with no abort indicator (per ROK-1062 scope check below). | Acknowledge cancellation, optionally see why. | **F-5** **No abort indicator on the detail page.** ROK-1062 added the kill-switch backend but the frontend has no banner/state for it. Confusing for invitees who follow a Discord link. | **blocker** |
| P3/P4 ops, all states | Phase breadcrumb is clickable for adjacent phases with confirm-on-double-click. Edit button. | Advance, revert, or edit. | **F-6** "Why is the next-phase button disabled?" has no inline explanation when the API rejects the transition (e.g. tiebreaker required). Generic toast "Transition failed" appears via mutation onError unless the special TIEBREAKER_REQUIRED string is present. | medium |
| P5 (uninvited, private), all | Detail page renders with limited data (`canParticipate === false`); "Private lineup — ask the creator" notice appears in nominate/vote sections. | Ask the creator for an invite. | **F-7** The notice is only embedded in the participation surface (NominateModal trigger area, voting leaderboard) — nothing on the page header explains "you're viewing this read-only because you're not invited." | medium |

---

### Page 3 — Building / Nominating phase (mode of detail page)

Renders `CommonGroundPanel` + Nominate button + `NominationGrid` (or `LineupEmptyState` if no entries).

| Cell | What's there today | What user should do | Gap | Sev |
|---|---|---|---|---|
| P1 (not nominated), S1 | "Nominate" emerald button top-right, `CommonGroundPanel` invites, empty state if zero entries. | Nominate. | **F-8** Primary CTA is in the header row, but it's not visually loudest — the `CommonGroundPanel` and `SteamNudgeBanner` compete. The Nominate button is the same emerald accent as several side actions. | medium |
| P2 (already nominated), S1 | Same UI; their entry shows in the grid with an X to remove. | Wait for others, optionally nominate more (up to 20 cap). | **F-9** **No "✓ You nominated X" confirmation pill** anywhere — only the entry being in the grid. Same root issue as ROK-1125 (vote confirmation). | **high** |
| All, S2 (<24h to deadline) | `PhaseCountdown` reds out. | Hurry. | **F-10** No banner like "Voting starts in 4h — last chance to nominate" — only the countdown widget. | medium |
| All, S3 (deadline missed) | Phase still reads `building`; banner unchanged. | Wait for auto-advance. | (covered by F-3) | high |
| P3/P4 ops, all states | Nominate button + breadcrumb advance to "Voting". | Advance phase OR nominate themselves. | **F-11** Operator has two equal-loud emerald CTAs ("Nominate" + "Advance to Voting" via breadcrumb) competing. No "you've decided to advance" confirmation flow. | low |
| P5 (uninvited, private) | "Private lineup — ask creator" notice. Read-only grid. | Request invite. | (covered by F-7) | medium |

---

### Page 4 — Voting phase (mode of detail page)

Renders `VotingLeaderboard` (with `VoteStatusBar`, `LeaderboardRow`s) OR `TiebreakerView` if a tiebreaker is `active|pending|resolved`.

| Cell | What's there today | What user should do | Gap | Sev |
|---|---|---|---|---|
| P1 (no votes cast), S1 | `VoteStatusBar` shows "0 / 3 votes used". Each row has heart-style toggle. | Vote on up to 3 games. | **F-12** No empty-state coaching ("You have 3 votes — pick your favorites"). New users can mistake toggle row for a "favorite" action vs. a vote. | medium |
| P2 (some votes cast), S1 | `VoteStatusBar` shows "2 / 3"; voted rows have filled heart styling. Atlimit disables remaining unvoted rows. | Optionally vote more, or wait. | **F-13** **Disabled-at-limit rows give no tooltip** explaining why ("you've used all 3 votes — unvote one to switch"). Just renders disabled. (Direct overlap with ROK-1125 scope.) | **high** |
| P2 (all 3 votes cast), S1 | Same UI, all toggle buttons either filled-voted or disabled. | Wait, OR change votes. | **F-14** No "✓ You've voted — waiting for others" empty-state-style confirmation; same flat leaderboard. (ROK-1125.) | **high** |
| All, S2 (<24h) | Countdown reds out. | Vote now. | **F-15** No sticky reminder for users who haven't voted yet. | medium |
| All, S3 (deadline missed) | Banner unchanged, votes still toggleable until backend transition fires. | Wait. | (F-3) | high |
| Tiebreaker active (any persona) | `TiebreakerView` replaces leaderboard, renders `BracketView` or `VetoView`. `TiebreakerCountdown` at top. | Engage in bracket / veto. | **F-16** Switch from leaderboard → bracket is jarring; no transitional explainer ("There was a tie — pick a side"). The `TiebreakerBadge` only renders on the games-page banner, not on the detail header. | high |
| Tiebreaker pending (operator only) | `TiebreakerPromptModal` opens on advance attempt. | Choose mode and confirm. | **F-17** Modal appears as a side-effect of clicking "Advance to Decided" with TIEBREAKER_REQUIRED error. From the operator's POV, there's no proactive warning ahead of time — they only learn ties exist by trying to advance and being rejected. | high |
| P3/P4 (operator), all | Same leaderboard PLUS phase-advance breadcrumb. Tiebreaker prompt described above. | Watch quorum, advance when ready, mediate ties. | **F-18** No "X of Y voted — quorum reached" advance-readiness signal. Operator has to eyeball `VoteStatusBar`. | medium |
| P5 (uninvited, private) | "Private — ask creator" notice. Read-only leaderboard. | Request invite. | (F-7) | medium |

---

### Page 5 — Decided phase (mode of detail page)

Renders `DecidedView`: `VotingPodium` (top-3) → `PodiumActionButtons` (Share) → `AlsoRanList` → `DecidedMatchesView` (3 tiers: Scheduling Now, Almost There, Rally Your Crew) → `LineupStatsPanel`.

| Cell | What's there today | What user should do | Gap | Sev |
|---|---|---|---|---|
| All, S1 — Tier 1 match exists for me | `SchedulingMatchCard` with cover, vote bar, member avatars, "Schedule This →" CTA. | Schedule it. | **F-19** Many simultaneous CTAs on the page (Schedule This, Join This Match, I'm interested, Share) without a unified "what's MY single next step" hierarchy. (Direct overlap with ROK-1119 scope.) | **blocker** |
| P1 (tier-1 game user voted for) | Tier-1 card; user is in members list. | Schedule. | **F-20** No "your top pick advanced to Tier 1" callout linking voter intent to outcome — they just see a podium and a card. | medium |
| P2 (tier-1 game user voted for, AND voted on another tier-2 game) | Two separate sections compete. | Either schedule (T1) or join (T2). | **F-21** No single "your next best step" — relies on the user to scan three tiers and decide. | high |
| P1 (tier-2 game user voted for) | `AlmostThereCard` with progress ring, "Join This Match" button. | Join the match. | **F-22** "Join This Match" copy makes more sense for non-members. For voters, this is "see if you can rally enough to play your pick" — copy doesn't differentiate. | medium |
| P2 (already joined a match) | Button shows "Joined" disabled. | Wait. | **F-23** Same flat layout as not-joined; no "you're in 2 matches — they need 3 more players combined" rollup. | medium |
| P1/P2 (tier-3 game user voted for) | `RallyRow` compact row + "I'm interested" button + Share icon. | Rally friends via share link. | **F-24** Action verb ambiguity — "I'm interested" reads weaker than "Join". The expectation that you should *also* share to recruit is implicit, not surfaced. | medium |
| P3/P4 (operator), all | Same view PLUS a tiny "Advance" button on each `RallyRow`. | Decide whether to keep growing matches or advance them. | **F-25** Operator advance button is tiny and ungrouped — no "you have 3 matches ready to schedule, here's what to do" overview. | medium |
| All, S2 (deadline <24h on the decided phase) | No deadline shown — `decided` is a holding state, not deadlined by default. | (no action expected) | **F-26** If `phaseDeadline` is set on `decided`, the countdown still renders but there's no copy explaining what happens at deadline (auto-archive? rollover?). | low |
| All, S3 (decided phase past deadline) | Same as S2. | Wait. | (F-3) | medium |
| P5 (uninvited, public lineup) | Full read-only podium and matches; can browse but not join. | View; possibly join. | **F-27** No "Join this lineup" call-to-action for uninvited public-lineup users — they hit a dead end at the podium. (Adjacent to ROK-1067 share view.) | high |

---

### Page 6 — Scheduling phase (in-lineup slot picker for the decided game)

The audit originally folded this into Page 8 (Standalone Scheduling Poll) because the detail page never enters a dedicated scheduling mode in the current code — users are redirected out to the standalone poll. The rework wireframe **proposes the missing in-lineup Scheduling page** as the canonical scheduling experience, repurposing the standalone poll as a lean share-link variant only. F-28 (scheduling has two faces) is treated as the highest-priority gap; the proposal is to **collapse them** so users stay in the lineup context.

| Cell | What's there today | What user should do | Gap | Sev |
|---|---|---|---|---|
| All personas, S1 | NO dedicated in-lineup scheduling — clicking "Schedule this →" on the Decided view bounces users to the standalone poll page. | Pick the times you can play. | **F-28-A** Context loss on transition: lineup chrome (header, breadcrumb, member list, activity timeline) disappears when the user is sent to the standalone page. Disorients. | **high** |
| P1, S1 | n/a (page doesn't exist) | Open the slot picker for the decided game. | **F-28-B** No clear "this is where I pick when to play" affordance from the Decided phase — it looks like another match action rather than a phase transition. | high |
| P2 (already picked some slots), S1 | n/a | Wait or refine picks. | **F-28-C** No participation rollup like "you picked 3 slots" inside the lineup; the rollup only exists on the standalone poll. | medium |
| P3/P4 (operator), S1 | n/a | Lock in the winning slot when ready. | **F-28-D** Operator's "create event from poll" CTA only exists on the standalone page. They have to leave the lineup to lock things in. | high |
| All, S2/S3 | n/a | Hurry / wait. | (covered by F-2, F-3) | medium |
| P5 (uninvited, public lineup) | n/a (and on the standalone page voting probably API-blocked but UI doesn't pre-disable) | Browse / request invite. | (covered by F-7, F-40) | medium |

> **Audit takeaway:** the rework's Scheduling wireframe demonstrates the consolidated experience. The Standalone Poll wireframe is now the lean share-link variant — same slot grid, no lineup chrome, used for direct-link access (Discord embed, calendar widget, etc.). F-28 is closed by collapse.

---

### Page 7 — Tiebreaker (bracket / veto modes)

Routes through `TiebreakerView` which dispatches to `BracketView` or `VetoView`. Renders inside the voting-mode detail page, NOT a separate route.

| Cell | What's there today | What user should do | Gap | Sev |
|---|---|---|---|---|
| All, bracket-active | Bracket UI with matchups, `myVote` indicator, countdown. | Vote in each active matchup. | **F-29** No "you've voted in 2 of 3 matchups" progress meter. User must scan visually. | high |
| All, veto-active | Veto UI with vetoStatus, single veto per user. | Cast veto OR wait. | **F-30** "Veto" verb is harsh and unintuitive — "remove one game from contention" is the actual intent and isn't surfaced. | medium |
| P2 (already voted/vetoed) | UI is the same; just the cast vote is marked. | Wait for others. | **F-31** Same as F-13/F-14 — no "you're done — waiting for the others" empty-state. | high |
| Tiebreaker resolved (any persona) | `TiebreakerClosedNotice` on the decided view shows "Vote closed at HH:MM" once advanced. | Read history, move to decided actions. | (handled — only minor copy gap; not flagged) | low |
| P3/P4, all | Same view + can force-resolve via API (no UI?). | Mediate. | **F-32** Operator force-resolve appears to have no UI button at all (only `TiebreakerPromptModal` for choosing mode). If a tiebreaker stalls past deadline with no votes, operator has no in-app override. | high |

---

### Page 8 — Standalone Scheduling Poll (`/community-lineup/:lineupId/schedule/:matchId`)

`SchedulingPollPage` renders `MatchContextCard`, `AvailabilityHeatmapSection`, `SuggestedTimes`, `CreateEventSection`, `OtherPollsSection`. Has its own wizard gate (`SchedulingWizard`) for users with stale game-time prefs.

| Cell | What's there today | What user should do | Gap | Sev |
|---|---|---|---|---|
| P1 (haven't voted), S1 | Heatmap + suggested time list with vote toggles + "suggest a time" input. | Vote on a suggested time OR suggest one. | **F-33** Two equally-prominent paths (vote on existing, suggest new) with no recommended-default. (Adjacent to ROK-1121 scope.) | **high** |
| P2 (voted on at least one slot), S1 | Voted slots are visually marked. | Wait, or vote on more. | **F-34** No "✓ You voted for these N times" pill collected at the top — same recurring confirmation gap as voting/nominating. | high |
| All, S1 (slot has unanimous quorum) | UI doesn't change — match is `scheduling` until manually scheduled. Operator must click "Create Event" in `CreateEventSection`. | Operator creates event; everyone else waits. | **F-35** Quorum-reached state has no celebratory affordance ("Quorum reached at 7pm Friday — schedule now"). Just a row with N votes. | high |
| All, S2 (<24h) | Date countdown unclear; no event yet. | Hurry. | **F-36** Standalone poll has no phase-level deadline countdown like the detail page. | medium |
| All, S3 (deadline missed) | Match transitions; UI re-renders. | Wait or revote. | (F-3) | high |
| Match status `scheduled` (S4 within scheduling) | `CompletedPollState` — green "Poll Complete" card with link to event. | View event. | **F-37** Read-only celebration UI is fine, but the "view event →" link takes users out of the lineup context entirely — no breadcrumb back. | low |
| P3/P4 (operator), all | All of above + "Cancel Poll" red button + "Create Event" CTA in CreateEventSection. | Make a call. | **F-38** Cancel-poll button has no second-confirm; one click cancels. ROK-1062 added kill-switch but the per-match cancellation is its own button without the same protection. | high |
| Match status `read-only` (poll voting closed but no event) | `ReadOnlyBanner` "This poll is read-only. Voting is closed." | Wait or escalate. | **F-39** "Voting is closed" with no "...because: deadline / operator cancelled / quorum reached" reason. | medium |
| P5 (uninvited public) | Page loads if the match is on a public lineup; voting probably blocked by API but UI doesn't pre-disable. | Watch or request invite. | **F-40** Same gating logic should mirror lineup detail page; appears to lack the `canParticipate` notice. | medium |

---

## Findings Summary

| Sev | Count |
|---|---|
| blocker | 3 (F-5, F-19, plus the Lineups-index gap if treated as blocker) |
| high | 17 |
| medium | 17 |
| low | 3 |

Total unique findings: **40**.

## Cross-cutting themes

- **Theme A — "I did it" confirmation** missing on every action surface (nominate, vote, suggest slot, join match, veto, bracket vote). Same root cause as ROK-1125. F-9, F-13, F-14, F-23, F-31, F-34.
- **Theme B — "Waiting" empty-states** missing. The user has finished their action but the UI looks identical to before they acted. F-14, F-31, F-34.
- **Theme C — Phase boundary clarity.** Auto-advance (S3) is silent; phase change isn't celebrated; the decided→scheduling boundary spans two pages. F-3, F-4, F-15, F-28.
- **Theme D — Single-CTA hierarchy.** The decided view has 3+ tiers each with their own CTAs and no "your next step is X" rollup. F-19, F-21, F-25.
- **Theme E — Read-only / aborted states.** Lineup-aborted (S5) has no UI. Read-only-poll has no reason. Uninvited has only an inline notice. F-5, F-7, F-27, F-39, F-40.
- **Theme F — Operator-mediation surface area.** Tiebreakers, force-resolve, advance-readiness signals, second-confirm on destructive ops are all underdeveloped. F-17, F-25, F-32, F-38.

---

## Proposed Follow-up Stories

Listed only — do **not** auto-create. Note overlap with existing tickets where applicable. Title prefix per memory convention (`feat:` / `fix:` / `tech-debt:`).

> ### MANDATORY for the agent / dev picking up any of these stories
>
> **Open the wireframes BEFORE writing code.** The wireframes ship in this same PR (#696) and are the operator-approved "simplified flow" target — these stories are *implementations of the wireframe targets*, not greenfield design.
>
> 1. Run `./scripts/deploy_dev.sh --ci` (any worktree, DEMO_MODE on).
> 2. Open the relevant wireframe at:
>    `http://localhost:5173/dev/wireframes/lineup/:page/:persona/:state`
>    where:
>    - `:page` ∈ `index | lineup-detail | building | voting | decided | tiebreaker | scheduling | standalone-poll`
>    - `:persona` ∈ `invitee-not-acted | invitee-acted | organizer | admin | uninvited`
>    - `:state` ∈ `plenty-of-time | deadline-soon | deadline-missed | phase-complete | aborted`
> 3. Click through the persona/state combinations relevant to the story. Match the implementation to the wireframe — do not redesign.
> 4. The audit page-section above (`### Page N — …`) lists the F-numbers feeding each story. Use those to drill into the specific finding context.
>
> If your Linear story body does not cite a wireframe URL or this audit, **stop and ask the operator before coding** — likely the story was filed without context and the spec is incomplete.

### Blocker

1. **`fix:` Surface aborted-lineup state on detail page (ROK-1193 → F-5)** — banner + read-only mode when lineup is killed. Closes the ROK-1062 frontend gap.
2. **`feat:` Decided-view "your next step" rollup (F-19, F-21)** — single-CTA hierarchy that picks Schedule / Join / Rally per persona based on their voted games and existing match memberships. **Overlaps with ROK-1119** (scope-check needed).

### High

3. **`feat:` "You voted ✓" confirmation pills + waiting empty-states (Theme A/B, F-9/F-13/F-14/F-23/F-31/F-34)** — single design pattern reused across all action surfaces. **Overlaps with ROK-1125.**
4. **`feat:` Phase-deadline last-chance banner (F-2, F-15, F-36)** — sticky banner when user hasn't acted and deadline <24h.
5. **`feat:` Auto-advance pending state (F-3)** — banner "this phase ended, advancing in N minutes" instead of stale UI.
6. **`feat:` Lineups index page (F — Page 1 row)** — `/lineups` listing with tabs (Active / Past / Mine). Includes ops view of stuck lineups.
7. **`feat:` Tiebreaker warning + readiness signal for operators (F-17, F-18)** — "ties detected — choose mode" banner before they try to advance, plus quorum readiness.
8. **`feat:` Force-resolve tiebreaker UI for operators (F-32)** — admin override when bracket/veto stalls past deadline.
9. **`feat:` Public-lineup join CTA for uninvited users (F-27)** — "Join this lineup" button. **Adjacent to ROK-1067.**
10. **`tech-debt:` Unify scheduling experience (F-28)** — either embed scheduling in detail page or signpost the boundary with a sticky "← back to lineup" header.
11. **`fix:` Standalone poll deadline display (F-36)**.
12. **`fix:` Bracket vote progress meter (F-29)** — "voted in 2 of 3 matchups" progress.
13. **`feat:` Cancel-poll second confirm (F-38)** — same ROK-1062 second-click pattern.
14. **`feat:` Tier-1 voter-intent callout (F-20)** — "Your top pick advanced!" badge linking the voter's individual choice to outcome.

### Medium

15. **`feat:` Phase progress as plain language (F-1)** — "Step 2 of 4: Voting" alongside the visual circle.
16. **`feat:` Decided-phase deadline copy (F-26)** — explain what happens at deadline.
17. **`feat:` Operator quorum readiness (F-18)** — "Y voters of Z (quorum reached)".
18. **`feat:` "Why disabled" tooltips on operator phase advance + voted-out rows (F-6, F-13)**.
19. **`feat:` Privacy-state header banner for uninvited users (F-7)** — page-level explanation, not just inline.
20. **`feat:` Veto verb rename + explainer (F-30)** — replace "Veto" with "Eliminate"; tooltip on entering the mode.
21. **`feat:` Member rollup on join states (F-23)** — "you're in 2 matches".
22. **`feat:` Read-only-reason copy (F-39)** — "Voting closed because deadline reached / operator cancelled / quorum reached".
23. **`feat:` `canParticipate` notice on standalone poll (F-40)**.
24. **`feat:` Building-phase last-chance banner (F-10)**.
25. **`feat:` Nominate-vs-Advance CTA hierarchy for operators (F-11)** — soft-rank the actions.
26. **`feat:` Empty-state coaching for first-time voters (F-12)** — "you have 3 votes; pick your favorites".
27. **`tech-debt:` Match-tier action verb consistency (F-22, F-24)** — "Schedule" / "Join" / "Rally" each have a clear meaning; codify in design.

### Low

28. **`feat:` Archived retrospective summary (F-4)** — total participants, winning game, link to scheduled event.
29. **`feat:` Scheduling poll back-to-lineup breadcrumb (F-37)**.
30. **`feat:` Operator status badge ungrouping refresh on rally rows (F-25)**.

---

## Wireframes (sister deliverable)

Live at `/dev/wireframes/lineup/:page/:persona/:state` with persona + phase switchers and a breadcrumb sidebar (DEMO_MODE-gated). Each wireframe demonstrates the proposed solution shape for the highest-severity findings on that page. They are **not implementations** — they are clickable mockups for stakeholder review before tickets are filed.

**Universal pattern across every page:** a hero "Your next step:" banner is the visually loudest element. The banner pins to the top on mobile and fades to a compact form on scroll-down (mobile only — desktop stays in flow). The banner CTA is the page's primary action; everything else (breadcrumbs, vote results, history) is de-emphasized. This pattern was the operator's headline rework feedback (REWORK pass 1, 2026-04-29).

Pages covered (8 unique routes):
- `index` — proposed `/lineups` list view (focused on the active lineup card)
- `lineup-detail` — cross-phase shell with compact metadata strip + hero
- `building` — nominating phase with hero CTA driving the action; nomination grid as body
- `voting` — leaderboard as the action surface; vote-confirmation pill as inline empty-state
- `decided` — hero CTA absorbs the "your next step" rollup; matches grid as body; podium collapsed
- `tiebreaker` — bracket + veto with progress meter; force-resolve as ghost tail
- `scheduling` — **NEW** in-lineup slot picker (closes F-28 gap, replaces previous redirect to standalone)
- `standalone-poll` — share-link variant: same slot grid, no lineup chrome

**Aborted is a phase-state, not a page.** When `?state=aborted` is selected on any page, the page renders the aborted hero ("Nothing to do — this lineup was cancelled") and the body collapses to a final-state snapshot. This closes F-5 (ROK-1062 frontend gap).

Persona switcher: P1–P5. Phase-state switcher: S1–S5. URL params control all three.

## Out of scope (per spec)

- Implementation of any finding (each is a separate ticket).
- Visual consistency / theme polish (ROK-286, ROK-279).
- Discord embed UX (web-only audit).
- A/B testing or user research (heuristic expert review only).
