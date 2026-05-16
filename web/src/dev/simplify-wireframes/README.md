# Cycle 4 — Unify the Lineup Loop

**Canonical design doc for all stories in this cycle. Read this first.**

**Wireframe (DEMO_MODE-gated):** `http://localhost:5173/dev/wireframes/simplify`

**Wireframe source:** `web/src/dev/simplify-wireframes/`

**Theme:** Make the lineup loop legible and ritually complete, end-to-end. The loop today is broken across two dimensions: (a) page-by-page chrome is inconsistent so users can't tell where they are, what to do, or whether they're done; (b) game references are inert so members vote/nominate blind on titles they don't know. Cycle 4 unifies both — one through-line component (U1), one universal research drawer (U2), one tone system for done states (U3), one Submit ritual (U4), composited page redesigns built on top (S-stories).

---

## Reusable components (foundation — ship first)

These are NEW components introduced this cycle. Every page composite below depends on them. Build foundation in Wave 1, composites in Wave 2+.

### U1 — Journey Hero (`<JourneyHero />`)
One component renders at the top of every phase-relevant page. Replaces 4 inconsistent banner shapes ("Advance to Voting" / "Open voting" / "Sit tight" / "Open scheduling").

**Props:** `active: 0..4`, `badge`, `task`, `sub?`, `cta?`, `hint?`, `tone?: 'action'|'waiting'|'set'`, `exitCondition?`, `cue?`, `donePillLabel?`, `noRibbon?: boolean`.

**Phase morphs:** Nominating / Voting / Decided / Scheduling / Done (5 active values).

**Wireframe anchor:** `/dev/wireframes/simplify#u1`

### U2 — Game research drawer
Universal slide-in drawer triggered from any game reference (thumbnail / name / mention). Drawer contains: cover artwork, description, genre/ownership/sale pills, screenshots, store links, context-aware action CTA. Closes on Esc / outside-click. Action commits without navigating away.

**Trigger affordance:** subtle `ⓘ` indicator on hover; whole tile/row clickable except for the inline action button.

**Context-aware CTA:**
- From Nominate grid → `+ Nominate this`
- From Voting list → `Vote for this`
- From Decided podium / Scheduling card / Event detail → `View full game page →`

**Wireframe anchor:** `/dev/wireframes/simplify#u2`

### U3 — Hero tone variants
JourneyHero `tone` prop with 3 values:
- **`action`** (default) — bright emerald border, primary CTA. User has something to do. Decided ALWAYS lives here; Scheduling-mid (1 of 2 voted) too.
- **`waiting`** — soft edge border, "✓ You're done here" pill, ghost CTA. User has acted; group still working. Required: `exitCondition` (concrete trigger — "Auto-advances when 15 of 20 have voted, or at deadline Thu 11:59 PM") + `cue` (notification promise — "🔔 We'll DM you when matches are decided").
- **`set`** — amber celebratory border, "✓ You're set" pill, event preview + future-reminder cue. Only renders when every match the user is in has a locked time.

**Selector logic** (`getHeroState`): given `{phase, userActions, groupProgress, lineupConfig}`, returns `{tone, exitCondition, cue}`. Pure function, easily unit-tested. ~30 lines.

**Wireframe anchor:** `/dev/wireframes/simplify#u3`

### U4 — Universal SubmitBar
Sits at the bottom of every page-with-actions (S1, Sv, S3 has none, Ss, Sx). Closes the "did that count?" cognitive loop.

**4 kinds:**
- **`empty`** — muted, disabled CTA. "0 of 3 votes used · vote on a game" → `Submit (disabled)`. Member hasn't done anything to submit.
- **`partial`** — lighter emerald, primary CTA, nudge line. "1 of 3 votes used · autosaved" → `Submit (1 of 3) →` + nudge "You have 2 votes left — use them or submit early." Member can submit early.
- **`pre`** — bright emerald, primary CTA. Cleanest pre-submit state. "3 of 3 votes used · autosaved" → `Submit my votes →`.
- **`post`** — soft edge, ghost CTA. "✓ Submitted Thu 7:15 PM · 14 of 20 have submitted" → `Change my votes`.

**Schema additions:** `nominations_submitted_at`, `votes_submitted_at`, `match_scheduling_submitted_at` (per match-membership row). Quorum-rules count *submissions*, NOT autosave touches.

**STRICT — Decided has NO page-level Submit.** The per-match Schedule CTA on each match card IS the commit. A separate Decided Submit would be ceremonial duplication of the vote. Do not add one.

**Submit triggers the U3 tone shift** from `action` → `waiting`. The `getHeroState` selector reads from `*_submitted_at` columns.

**Wireframe anchor:** `/dev/wireframes/simplify#u4`

---

## Composited page redesigns (Wave 2+)

Each S-story below assumes U1/U2/U3/U4 are shipped. Composites import the foundation components.

### S1 — Nominating page with Common Ground multi-row
**Wireframe:** `/dev/wireframes/simplify#s1`

- U1 Journey Hero at top (`active=0`, badge "Step 1 of 4 · Nominating · 2d left")
- Tabs: All (n) / Yours (n) / Trending
- Existing nominations rendered as game refs (U2 drawer on tap)
- **Common Ground hero section** — 3 themed rows × 4 tiles = 12 total:
  - Owned by your group (ownership signal)
  - Matches your taste (taste-vector signal)
  - Trending or on sale (recency/price signal)
  - Each tile: cover (3:2 aspect), name, `★ why` reason annotation, `+ Nominate` CTA
  - `↻ Regenerate` + `Why these?` affordances next to the section header
- "Or search any game" fallback row demoted to 5-up smaller tiles below
- SubmitBar at bottom (`kind=pre` when ≥1 nomination; `kind=empty` when 0; `kind=post` after submit)

### Sv — Voting page composite (NEW)
**Wireframe:** `/dev/wireframes/simplify#sv`

- U1 Journey Hero at top (`active=1`)
- Per-row game refs with vote toggle: `<game ref + voted state checkmark-circle>`
- **Vote bars normalized to VOTER count, not max-votes.** Fixes today's "bar fills to 100% with 1 vote" bug.
- Tapping anywhere on row except the vote circle opens the U2 drawer; vote stays on the row.
- Voted state is a checkmark-circle button **with proper aria-label** (fixes today's "(no name)" a11y bug).
- SubmitBar at bottom (kinds per voting state matrix in U4)

### S3 — Decided page with multi-match output
**Wireframe:** `/dev/wireframes/simplify#s3`

- U1 Journey Hero `active=2`, `tone=action` (Decided is ALWAYS action — schedule is required)
- **Your matches (n)** — personal-first match cards. Each card: game ref (U2 drawer), `X of Y players`, sub "You + N others (or 'group is full')", primary `Pick a time →` CTA per match
- **Other matches in this lineup (n)** — group context list (no CTAs, just info)
- "2 voters didn't match → Suggest more games?" leftover-voters CTA
- **NO page-level SubmitBar** — per-match Schedule CTA IS the commit
- Replaces today's "Champion / Silver / Bronze podium" framing (implies single winner; matches are PARALLEL not ranked)

### Ss — Scheduling Poll page from a lineup match
**Wireframe:** `/dev/wireframes/simplify#ss`

- U1 Journey Hero `active=3`, badge "Step 4 of 4 · Scheduling · 1 of 2 done · Match N of M"
- Game ref banner (U2 drawer on tap)
- **Group availability heatmap auto-populated from each participant's profile availability** (per S5 — no per-poll re-painting)
- Suggested times list with inline `+ Vote` per row and `Lock this time →` primary CTA per row
- "Suggest another → [datetime input] [Suggest]"
- SubmitBar at bottom for bulk "Lock all my matches" ritual (per-match lock per row also works)

### Sx — Standalone Scheduling Poll page (from "Schedule a Game" button)
**Wireframe:** `/dev/wireframes/simplify#sx`

- Same layout as Ss BUT:
  - U1 Journey Hero uses `noRibbon` mode — replaces 4-phase ribbon with "🗓 SCHEDULING POLL · started by you" badge
  - Single-game framing (no "Match N of M" cross-references)
  - Operator perspective in sub-line ("You invited 5 members · 1 of 5 have voted on times so far")
- Same component, different config — ONE implementation, two entry points (from-lineup + standalone)

### S4 — Start Lineup modal collapse
**Wireframe:** `/dev/wireframes/simplify#s4`

- Modal asks 10 questions today. Move 6 behind "More options."
- **Keep visible:** Title + match-shape settings (Match Threshold + Votes per Player + per-game Player Caps) + Preset chooser ("Tonight / This Week / Series / Custom")
- **Hide behind expander:** Description, Visibility, Public share link toggle, Channel, Phase durations, Tiebreaker mode
- **Rationale:** match-shape settings determine HOW the lineup clusters voters into matches at Decided — hiding them surprises the operator at S3. The Preset chooser is the ROK-1265 ask landing here.

### S5 — Weekly availability becomes a profile setting
**Wireframe:** `/dev/wireframes/simplify#s5`

- Move "When Do You Play?" weekly-availability painter from the scheduling wizard Step 1 to `/settings/availability` (user profile)
- Ask once at signup OR when user first hits a scheduling poll; reuse across every lineup forever
- **Removes wizard Step 1 entirely.** Scheduling wizard goes from 3 steps to 2 (Group Availability + Suggested Times become one page — see Ss).
- **Fixes the paint-doesn't-persist bug** observed in the live walk (painted on wizard step 1, didn't appear on the group availability page — single-source-of-truth fix).
- DB migration: new `user_weekly_availability` table (or column on `users`); back-fill from existing per-poll data where present.

### S6 — Create Event confirm card
**Wireframe:** `/dev/wireframes/simplify#s6`

- Replace `/events/new` full form (~15 fields) with a confirm card when arrived via `?gameId=X&startTime=Y&matchId=Z` (pre-filled from scheduling poll)
- Card: 3-line summary (game / time / duration · player count) + `[Customize…]` ghost + `[Create event]` primary
- "Customize…" routes to the full form (existing) for the operator who needs to tweak
- Embeds a U2 trigger on the game name so the operator can double-check

### S7 — /events unified entry CTA
**Wireframe:** `/dev/wireframes/simplify#s7`

- Replace `[📅 Schedule a Game]` + `[+ Create Event]` two-CTA fragmentation with one `[+ New event]` primary button
- On click, present 2-option chooser:
  - "Pick a time for a known game" → opens `Schedule a Game` modal (existing flow)
  - "Run a poll to pick a game first" → opens `Start Community Lineup` modal (existing flow)
- Also: pin "Active scheduling polls" panel ONLY when user has unvoted polls (default render: no pin)

### S9 — /calendar filter chip collapse
**Wireframe:** `/dev/wireframes/simplify#s9`

- Today's calendar viewport has ~111 interactive elements (mostly filter chrome): Select-all / Deselect-all / All-genres dropdown / "Show all 1918 games" / month nav / view tabs.
- Collapse all filters behind a single `[Filter: All games]` chip → opens a sheet/drawer with filter options.
- Default render is the calendar grid itself, minimal chrome.

---

## Don't-lie bug fixes (must ship parallel)

These are HIGH-severity bugs the composite redesigns cannot work around. Ship in parallel with foundation Wave.

### ROK-1258 — Voting auto-advance broken when invitees > voters
Pre-existing HIGH. Voting phase silently fails to auto-advance when the invitee roster exceeds the active voter set — which is the **normal case** for guild raids. Currently a lineup-loop blocker.

### ROK-NEW — Lineup-to-scheduling routing bug
Captured in the live walkthrough on 2026-05-15. Lineup #115 with Valheim winner was incorrectly linked to scheduling poll #9 (an existing ORBITALIS poll), causing the wrong game to flow all the way through to event creation. Either:
- Each new lineup match should spawn a fresh scheduling poll
- Or the existing routing should validate that schedule-poll belongs to the lineup before rendering
File reference: see `walk-2026-05-15` notes in chat history.

---

## Wave sequencing

7-day cycle, max 2-3 parallel dev agents per batch (operator preference).

**Wave 1 — Foundation (parallel, 3 lanes):**
- U1 + U3 bundled (JourneyHero with tone variants + selector) — one dev
- U2 (Game research drawer) — one dev
- U4 (SubmitBar component + schema migration) — one dev

**Wave 2 — Composites (parallel, 3 lanes — disjoint files):**
- S1 (Nominating + Common Ground hero)
- Sv (Voting page rebuild)
- S3 (Decided multi-match)

**Wave 3 — Scheduling family (parallel, 2 lanes — coupled):**
- Ss + Sx bundled (one component, two entry points)
- S5 (availability to profile — DB migration + UI)

**Wave 4 — Subtractions + entry (parallel, 3 lanes):**
- S4 (Start Lineup modal collapse with preset chooser)
- S6 (Create Event confirm card)
- S7 (/events unified CTA)
- S9 (calendar filter chip) — drop first if cycle fills

**Parallel anytime — HIGH bug fixes:**
- ROK-1258
- ROK-NEW (lineup→scheduling routing)

---

## Rules for agents picking up cycle 4 stories

1. **Read this doc first.** It captures the design intent that the wireframes embody.
2. **Preview the wireframe.** Run `./scripts/deploy_dev.sh --ci` from your worktree, then open `http://localhost:5173/dev/wireframes/simplify`. Use the section anchor in your assigned story to jump.
3. **Match the AFTER column exactly.** PR description must include before/after element counts (e.g., "header chrome rows: 5 → 1"). Reviewer rejects PRs that exceed the delta target.
4. **DO NOT add a Decided Submit.** That ritual was deliberately removed; per-match Schedule IS the commit. If you find yourself adding a "Confirm matches" step, stop and re-read U4.
5. **DO NOT re-introduce the "Champion / Silver / Bronze" podium.** Decided output is parallel matches, not ranked positions. See S3 spec.
6. **Use the shared components.** Composite pages MUST import U1/U2/U3/U4 — don't duplicate the JourneyHero / drawer / SubmitBar inline.
7. **Glossary lockdown.** One term per concept. "Schedule" is the time-picking phase. "Lineup" is the whole loop. "Match" is the per-game grouping at Decided. Don't introduce "poll" / "matched" / "decided" as alternates.
8. **A11y required.** Every interactive element must have an accessible name. Today's voting toggle is `button "(no name)"` — Sv MUST fix this.

---

## Where this doc lives + how to find it

- **Tracked copy (this file):** `web/src/dev/simplify-wireframes/README.md` — committed, available to all agents on `main`
- **Operator-local copy:** `planning-artifacts/specs/cycle-4-unify-lineup.md` (gitignored)
- **Wireframe source:** `web/src/dev/simplify-wireframes/*`
- **Operator memory pointer:** [`reference_cycle_4_unify_design.md`](`~/.claude/projects/-Users-sdodge-Documents-Projects-Raid-Ledger/memory/`)
- **Indexed in:** `planning-artifacts/next-sprint.md` (cycle plan) and the per-story Linear issue bodies

---

## Linear ledger (filed 2026-05-16, Cycle 4)

| Slot | ID | Status |
|---|---|---|
| U1+U3 | ROK-1294 | Todo |
| U2 | ROK-1295 | Todo |
| U4 | ROK-1296 | Todo |
| S1 | ROK-1297 | Todo |
| Sv | ROK-1298 | Todo |
| S3 | ROK-1299 | Todo |
| Ss+Sx | ROK-1300 | Todo |
| S5 | ROK-1301 | Todo |
| S4 | ROK-1302 | Todo (closes ROK-1265) |
| S6 | ROK-1303 | Todo |
| S7 | ROK-1304 | Todo |
| S9 | ROK-1305 | Todo |
| Bug — lineup→scheduling routing | ROK-1306 | Todo |
| Bug — voting auto-advance | ROK-1258 | Todo (reassigned to Cycle 4) |

### Pre-existing in Cycle 4 (not new from this design pass, but still in cycle)

- **ROK-1212** — `feat: lineups index page with Active/Past/Mine tabs` (HIGH, ROK-1193 → Page 1). Not subsumed by S1's per-page tab switcher (which is All/Yours/Trending). Still needed.
- **ROK-1215** — `feat: public-lineup join CTA for uninvited users` (HIGH, ROK-1193 → F-27). Recruiting funnel via public share links. Independent of foundation; can ride Wave 4.
- **ROK-1208** — `feat: decided-view "your next step" rollup with single-CTA hierarchy` (ROK-1193 → F-19, F-21). Partial overlap with S3 (ROK-1299) which provides "Your matches" + per-match CTAs. Implementer should check if S3 already satisfies this before doing extra work.
- **ROK-1210, ROK-1211, ROK-1213, ROK-1214, ROK-1219, ROK-1220** — other ROK-1193 audit items. None subsumed by Cycle 4 foundation; keep open.
- **ROK-1122** (Share/Rally button silent failure), **ROK-1032** (scheduling conflict warnings), **ROK-1201** (perf), **ROK-1204** (Radix Colors + shadcn/ui), **ROK-1203** (light-mode contrast audit) — independent stories.
- **~20 tech-debt + bug-fix items** (ROK-1284–1290, ROK-1287, ROK-1164, ROK-1165, ROK-1160, ROK-1293) — ride-along carry items.

### Cancellations from this audit (subsumed by new stories)

| Cancelled | Subsumed by | Reason |
|---|---|---|
| ROK-1254 | ROK-1302 (S4) | Configurable lineup sliders — folded into S4's preset chooser + match-shape settings |
| ROK-1256 | ROK-1295 (U2) | Research-during-voting — solved by universal game-research drawer |
| ROK-1265 | ROK-1302 (S4) | Lineup template presets — IS the S4 preset chooser |
| ROK-1216 | ROK-1300 (Ss+Sx) | "Unify scheduling inside lineup detail" — exactly what Ss composite does |
| ROK-1009 | ROK-1303 (S6) | "Scheduling poll Create Event navigates with pre-filled data" — confirm card is this pattern improved |
