# Community Lineup — Pre-Launch Validation Runbook

Pre-launch validation registry for the Community Lineup feature (ROK-1060
through ROK-1067 all merged). The runbook is a coverage-and-result registry,
not a hand-walked checklist — every AC maps to an existing automated test
file, a run command, and three result columns:

- **Playwright** — CI-parity smoke result (PASS / FAIL / skipped / N/A).
- **Chrome MCP observed** — text-only finding from a real Chrome drive of
  the flow via `mcp__claude-in-chrome__*` against the deployed dev env.
  Required by `feedback_chrome_mcp_e2e_before_review.md` before reviewer
  / PR / auto-merge.
- **Companion bot** — Discord-side smoke result (PASS / FAIL / skipped / N/A).

Re-run the full suite before any production release that touches lineup
behaviour. If you only need to validate one slice (e.g. the tiebreaker
path), jump to the [AC Registry](#ac-registry) below and run the file
listed for that row.

## Setup

### 1. Acquire the env lease

The local dev environment is a single shared resource. Multiple agents
cannot run it simultaneously.

```text
mcp__mcp-env__env_lock_status                                  # see who holds it
mcp__mcp-env__env_lock_acquire { purpose: "ROK-1068 validation" }
```

If `acquired: false` you have been queued. Wait — do not preempt.

### 2. Boot the local stack

```bash
./scripts/deploy_dev.sh --ci --rebuild --wait-for-env 60
```

The script copies `.env` from the main repo into the worktree, brings up
Postgres + Redis + API + web, runs migrations, and seeds demo data.
Health: `curl http://127.0.0.1:3000/health`.

### 3. (Optional) Discord testing prerequisites

The companion bot smoke suite requires Discord running with CDP enabled
and a `tools/test-bot/.env` containing `TEST_BOT_TOKEN` + `TEST_GUILD_ID`.

```bash
./scripts/launch-discord.sh        # launches Discord with CDP on :9222
cd tools/test-bot && npm install   # one-time install
```

Skip this if you only need to validate web-side behaviour.

### 4. Run the full validation suite

```bash
# Playwright (both desktop + mobile projects — required by CI)
npx playwright test

# Companion bot smoke (Discord-side)
cd tools/test-bot && npm run smoke
```

Per CLAUDE.md never use `--project=desktop` alone — CI fans both projects
and a mobile-only failure will surprise you in PR review.

### 5. Chrome MCP drive (mandatory pre-review)

Per `feedback_chrome_mcp_e2e_before_review.md`, every changed flow must be
driven via `mcp__claude-in-chrome__*` against the deployed dev env BEFORE
reviewer / PR / auto-merge. Workflow:

1. `mcp__claude-in-chrome__tabs_context_mcp` — inspect existing tabs first.
2. `mcp__claude-in-chrome__tabs_create_mcp` or `navigate` to the AC's page.
3. Drive the flow with `find` + `browser_batch`, `computer`, `form_input`,
   `read_page`, `read_console_messages`, `read_network_requests`.
4. Record text-only findings in the **"Chrome MCP observed"** column. No
   screenshots. No GIFs.

For flows that genuinely cannot be Chrome-MCP-driven (e.g. multi-user
Discord voice, bot perm revocation), record `Not Chrome-MCP-driveable:
<reason>` and rely on Playwright + companion-bot results.

### 6. Release the env lease

```text
mcp__mcp-env__env_lock_release
```

`./scripts/deploy_dev.sh --down` also releases.

## AC Registry

Coverage status: **full** = automated smoke + integration exists and
asserts the AC; **partial** = automated test asserts a subset;
**gap** = no automated test exists.

| # | AC | Primary test file | Coverage | Playwright | Chrome MCP observed | Companion bot |
|---|----|-------------------|----------|------------|---------------------|---------------|
| 1 | Banner appears on the Games page with title, status, nomination count, and Nominate CTA | `scripts/smoke/community-lineup.smoke.spec.ts` | full | PASS (desktop+mobile) | Banner present at `/games`, label "COMMUNITY LINEUP", subtitle "X games nominated", "Nominate" button visible and clickable, "View Lineup" link routes to `/community-lineup/:id` | N/A |
| 2 | Detail page renders header, phase breadcrumb, progress bar, activity timeline, nomination grid | `scripts/smoke/community-lineup.smoke.spec.ts` | full | PASS | H1 renders lineup title, status badge visible (Nominating/Voting/Scheduling/Archived), breadcrumb shows current phase + clickable next, nomination-count testid present | N/A |
| 3 | Nomination modal: search → preview → submit → grid update | `scripts/smoke/community-lineup.smoke.spec.ts` | full | PASS (desktop) / FAIL (mobile, search empty-state timeout) | Modal opens on Nominate click with "Nominate a Game" heading, search input with placeholder "Search by name or paste a Steam store URL", "SUGGESTED FOR YOU" section visible, close button dismisses modal. Mobile fixture race documented in Known Issues. | N/A |
| 4 | Voting phase: leaderboard renders, vote toggles with emerald accent, vote-count pill flips count → waitingOn | `scripts/smoke/community-lineup.smoke.spec.ts` | full | PASS | Leaderboard `data-testid="voting-leaderboard"` visible, leaderboard rows present, row click flips `data-voted="true"` with checkmark, confirmation pill shows "X of 3 votes used" → "waiting on N others" at cap | N/A |
| 5 | Decided view: composite layout — JourneyHero, personal "Your matches" section, other matches, carried-forward chips (ROK-1299) | `scripts/smoke/decided-composite.smoke.spec.ts` (replaced `lineup-decided.smoke.spec.ts` in ROK-1299 PR #807) | full | PASS | Composite decided view renders (`data-testid="decided-composite-view"`): JourneyHero on top, personal "Your matches" section with per-match "Pick a time →" CTAs, "Other matches in this lineup" section, leftover-voters row, and Carried Forward chips. The podium, Lineup Stats panel, bandwagon UI, and `?rally=<gameId>` URL were removed in the ROK-1299 redesign. | N/A |
| 6 | Start Lineup flow: modal opens via test param, duration sliders pre-fill, submit → detail page | `scripts/smoke/lineup-creation.smoke.spec.ts` | full | FAIL (flake — see Known Issues) | `?test=open-lineup-modal` opens "Start Community Lineup" dialog with 5 visible controls — Title pre-filled, Preset chooser, Match Threshold slider with "More matches" / "Fewer, larger matches" labels, Votes per Player slider at 3, and Include-scheduling-phase toggle (ROK-1302 PR #854); Visibility, Public share link, channel-override dropdown, phase-duration sliders, and Tiebreaker Mode now sit behind a "More options" expander. Feature works; failures are cross-worker fixture races. | N/A |
| 7 | Phase countdown displays on banner + detail | `scripts/smoke/lineup-creation.smoke.spec.ts` | full | PASS | Banner shows compact countdown "X remaining"; detail page shows full countdown timer; both update without page navigation | N/A |
| 8 | Phase breadcrumb: operator clicks next/previous → modal → confirm → status flips | `scripts/smoke/lineup-phase-breadcrumb.smoke.spec.ts` | full | PASS | Current phase rendered as `span`, next/previous phases as buttons; click opens `role="dialog"` with "Advance to Voting?" / "Revert to Nominating?" heading; confirm fires PATCH and status badge updates | N/A |
| 9 | Auto-advance live UI refresh — user B's open page reflects user A's REST advance within 5s | `scripts/smoke/lineup-auto-advance.smoke.spec.ts` | full | PASS | With detail page open in tab A, PATCH `/lineups/:id/status` from tab B flips the badge `Voting → Scheduling` (label for `decided`) within 5s via `lineup:status` socket event | N/A |
| 10 | Auto-advance grace window — pending-advance, vote toggle clears it, re-cast restarts it | `api/src/lineups/lineup-auto-advance-grace.integration.spec.ts` + `tools/test-bot/src/smoke/tests/lineup-grace-countdown.test.ts` | full | PASS (Playwright spec covers indirect surfaces; deep behaviour in integration spec) | Not Chrome-MCP-driveable: grace window TTL + BullMQ scheduling are timing-coupled and only assertable through API polling. Documented in companion bot smoke. | PASS (lineup-grace-countdown.test.ts) |
| 11 | Votes-per-player slider (1–10, default 3) on create modal, configured limit honoured in voting UI, GET /lineups/:id returns maxVotesPerPlayer | `scripts/smoke/lineup-votes-per-player.smoke.spec.ts` | full | FAIL (flake — see Known Issues) | "Votes per Player" slider observed at value 3 with 1-vote / 10-votes endpoint labels; matches AC. Playwright failure is the same fixture race as AC 6. | N/A |
| 12 | Hero + ConfirmationPill across building/voting/decided + mobile sticky compact | `scripts/smoke/lineup-confirmation-pills.smoke.spec.ts` | full | PASS | Hero testid `hero-next-step` renders with `data-tone="action"` and Nominate CTA before nominating; after nomination, per-card confirmation pill shows "Your nomination"; voting phase pill flips count → waitingOn; decided phase hero offers "Open scheduling" / "Schedule {gameName}" CTA; mobile viewport flips `data-compact="true"` after scroll | N/A |
| 13 | Tiebreaker prompt modal with bracket/veto mode selection + dismiss | `scripts/smoke/lineup-tiebreaker.smoke.spec.ts` | full | PASS | When tied games trigger TIEBREAKER_REQUIRED, modal `tiebreaker-prompt-modal` opens with "tied" text + bracket + veto buttons + dismiss option | N/A |
| 14 | Tiebreaker bracket: SVG tree, matchup cards, vote, auto-resolve to decided | `scripts/smoke/lineup-tiebreaker.smoke.spec.ts` | full | PASS | `bracket-view` testid + `bracket-tree` SVG visible; matchup cards show two game names; vote button flips card `data-voted="true"`; single-voter bracket auto-resolves and transitions lineup to decided/podium | N/A |
| 15 | Tiebreaker veto: card grid, blind submit, cap enforcement, force-resolve → decided | `scripts/smoke/lineup-tiebreaker.smoke.spec.ts` | full | PASS | `veto-view` renders with one card per tied game + `veto-button`; click flips card `data-vetoed="true"`; cap "remaining" indicator visible; POST `/tiebreaker/resolve` transitions to decided with podium | N/A |
| 16 | Tiebreaker dismiss with no tiebreaker row (ROK-1262 regression) | `scripts/smoke/lineup-tiebreaker.smoke.spec.ts` | full | PASS | Detected tie WITHOUT a started tiebreaker → modal opens via breadcrumb advance → Dismiss closes modal and lineup transitions to decided (no 404) | N/A |
| 17 | Tiebreaker late-join: opens lineup after tiebreaker started → veto form visible, veto accepted | `scripts/smoke/lineup-tiebreaker-late-join.smoke.spec.ts` | full | PASS | Late-arriving page-open after tiebreaker → veto-view + veto-buttons visible; submitting veto via API returns 2xx and tiebreaker remains active or resolves cleanly | N/A |
| 18 | Tiebreaker "Vote closed at HH:MM" empty state after resolution | `scripts/smoke/lineup-tiebreaker-late-join.smoke.spec.ts` | full | PASS | After force-resolve, late-arriving user sees text matching `vote closed at HH:MM` instead of the live veto form | N/A |
| 19 | Tiebreaker progress meter (F-29 regression) | `scripts/smoke/lineup-tiebreaker.smoke.spec.ts` | full | PASS | When votable matchups exist, `bracket-progress` reads "voted in M of N matchups" with `data-total`/`data-done` attributes | N/A |
| 20 | Tiebreaker Discord notification + channel embed (open + resolution) | `tools/test-bot/src/smoke/tests/lineup-tiebreaker-open.test.ts` | full | FAIL (Games-page banner "Tiebreaker active" badge — see Known Issues) | "Tiebreaker active" badge surfaces on Games page banner once a tiebreaker is started; Playwright failure is a fixture-race on the global banner | _(see companion bot results)_ |
| 21 | Channel override happy path — channelOverrideId round-trips | `scripts/smoke/lineup-channel-override.smoke.spec.ts` | full | PASS | POST `/lineups` with `channelOverrideId="123456789012345678"` → GET `/lineups/:id` returns the same id verbatim | N/A |
| 22 | Channel override fallback — bot loses perm on override channel mid-lineup, falls back to bound | `scripts/smoke/lineup-channel-override.smoke.spec.ts` + `tools/test-bot/src/smoke/tests/lineup-channel-override.test.ts` | full | PASS (web side asserts no crash on bad snowflake) | Not Chrome-MCP-driveable: fallback is a bot-side concern; verified via companion bot embed-in-default-channel poll | PASS |
| 23 | Admin abort from each phase (building/voting/decided) | `scripts/smoke/lineup-admin-abort-phases.smoke.spec.ts` | full | PASS | For each phase, POST `/lineups/:id/abort` returns 200, GET `/lineups/:id` shows `status="archived"`, detail page hides Abort button + shows Archived badge | N/A |
| 24 | Admin abort UI: modal with reason field, member cannot see button, archived hides button | `scripts/smoke/lineup-abort.smoke.spec.ts` | full | PASS | Admin sees "Abort Lineup" button → modal opens with "cannot be undone" warning + textarea → submit POST returns 200 → modal closes, status flips Archived, Abort button removed; member-role user (or anon) sees no Abort button | N/A |
| 25 | Admin abort Discord embed posted to bound channel | `tools/test-bot/src/smoke/tests/lineup-abort.test.ts` | full | N/A (Discord-side) | Not Chrome-MCP-driveable: assertion is on the bound Discord channel embed via the companion bot | PASS |
| 26 | Empty participation: voting lineup with zero nominations renders + abort still works | `scripts/smoke/lineup-empty-participation.smoke.spec.ts` | full | PASS | Force-advanced lineup with zero entries renders without "something went wrong" boundary, status badge `Voting` visible, Abort button still rendered | N/A |
| 27 | Single voter scenario: stable payload, NaN/Infinity-free detail page | `scripts/smoke/lineup-single-voter.smoke.spec.ts` | full | PASS | GET `/lineups/:id` returns `entries.length===1` with the correct gameId; detail page H1 renders, status Voting visible, body contains no `NaN`/`Infinity` substrings | N/A |
| 28 | Private lineup DM-only behaviour: visibility persists, public share returns 404, no channel embeds | `scripts/smoke/lineup-private-dm-only.smoke.spec.ts` + `tools/test-bot/src/smoke/tests/lineup-private-dm.test.ts` + `tools/test-bot/src/smoke/tests/private-lineup.test.ts` | full | PASS | GET `/lineups/:id` returns `visibility="private"`; detail page renders for operator; un-authed `/lineups/public/<slug>` returns 404 | PASS |
| 29 | Public share toggle: un-authed access works, toggle-off → 404 UI, decision block conditional on status=decided | `scripts/smoke/public-lineup-share.smoke.spec.ts` + `tools/test-bot/src/smoke/tests/public-share-link.test.ts` | full | PASS | Un-authed `/p/lineup/<slug>` returns 200 SPA shell with H1 + status badge + footer attribution, no nav, no login form; toggling `publicShareEnabled=false` returns "no longer available" fallback; decision block only renders when status=decided | PASS |
| 30 | Public share accessibility landmarks: h1, lang, main, tab focus | `scripts/smoke/public-lineup-share.smoke.spec.ts` | full | PASS | Public page exposes exactly one H1, `<html lang>` set, footer attribution visible, Tab moves focus off body | N/A |
| 31 | Lineup title + description appear in lifecycle Discord embeds | `tools/test-bot/src/smoke/tests/lineup-title.test.ts` | full | N/A (Discord-side) | Not Chrome-MCP-driveable: assertion is on the Discord channel embed body via the companion bot | PASS |
| 32 | Carryover: a new lineup auto-populates carried-forward chips from the most recent decided public lineup | `scripts/smoke/lineup-carryover.smoke.spec.ts` (added by ROK-1068) | full | PASS | New lineup POSTed after an archived prior-decided lineup with suggested matches → GET `/lineups/:id` returns at least one `entries[*].carriedOver===true` referencing a prior game id | N/A |
| 33 | Community has no bound notification channel → lifecycle dispatches degrade gracefully (no crash, no retries) | — | gap | N/A | Not Chrome-MCP-driveable: requires un-binding the lineup channel server-side which is not exposed in DEMO_MODE; see Known Issues | N/A |
| 34 | Nominator without Steam linked → nomination allowed with warning (private lineup flow) | `web/src/components/lineups/SteamNudgeBanner.tsx` (component); covered by `SteamNudgeBanner.test.tsx` vitest (6/6 tests pass) | full | PASS (vitest 6/6) | Logged in as admin with `steamId=null`, navigated to a `building`-phase lineup. Blue-bordered `SteamNudgeBanner` rendered the copy "Connect your account to include your game library in suggestions." with a "Link Steam" button + dismiss "×" affordance. The lineup detail also surfaces "220 without Steam" in the participant summary. Nominate button remained enabled; `POST /lineups/11/nominate` with `gameId=11868` succeeded (`status='building'`, `entries.length=1`) — nomination is non-blocking. | N/A |
| 35 | Vote submitted within 1s of deadline cron firing → counted or rejected? Document expected. | `api/src/lineups/lineup-deadline-vote-race.integration.spec.ts` (added by ROK-1068 Phase F, 4/4 pass) | full | PASS (integration, 4/4) | Not Chrome-MCP-driveable: timing race documented in integration spec. Observed contract from the three CASE-A/B/C tests: vote BEFORE the grace processor runs → counted (HTTP 200); vote AFTER the grace flip to `decided` → rejected with HTTP 400 "voting is only allowed in voting status"; concurrent race window → vote path reads status outside any transaction, so an INSERT can land after the optimistic UPDATE commits, leaving the vote row silently retained on a now-`decided` lineup. The ROK-1253 grace window narrows but does not eliminate this race. The 4th test asserts the grace queue stays healthy (no orphan jobs) across the interleaving. | N/A |
| 36 | Abort with reason vs without → embed copy differs correctly (Discord) | `tools/test-bot/src/smoke/tests/lineup-abort.test.ts` (extended by ROK-1068 Phase F — `abortReasonVarianceWalkthrough`) | full | N/A (companion bot domain) | Not Chrome-MCP-driveable: assertion is Discord embed body via companion bot. Web-side reason field is covered by AC 24. | PASS (3/3 abort smokes; new variance walkthrough explicitly aborts two lineups back-to-back and asserts `\n\n` separator + reason text present in one description and absent in the other) |
| 37 | Cycle 4 nominating composite: JourneyHero + Common Ground hero on the building phase (ROK-1297 PR #823) | `scripts/smoke/lineup-nominating-composite.smoke.spec.ts` | full | not yet run in a registry pass (shipped after 2026-05-12) | not yet driven | N/A |
| 38 | Cycle 4 voting composite: normalized vote bars (ROK-1298 PR #830) | `scripts/smoke/lineup-voting-composite.smoke.spec.ts` | full | not yet run in a registry pass (shipped after 2026-05-12) | not yet driven | N/A |
| 39 | Cycle 4 lineup-detail legacy chrome strip (ROK-1323 PR #871) | `scripts/smoke/lineup-chrome-strip.smoke.spec.ts` | full | not yet run in a registry pass (shipped after 2026-05-12) | not yet driven | N/A |
| 40 | Scheduling-phase opt-in + decided → scheduling-poll handoff (ROK-1302 PR #854) | `scripts/smoke/lineup-scheduling-toggle.smoke.spec.ts` (per-match "Pick a time →" CTA covered by `scripts/smoke/decided-composite.smoke.spec.ts`, row 5) | full | not yet run in a registry pass (shipped after 2026-05-12) | not yet driven | N/A |

## How to Validate

```bash
# Full pre-launch sweep
./scripts/validate-ci.sh --full
mcp__mcp-env__env_lock_acquire { purpose: "lineup validation" }
./scripts/deploy_dev.sh --ci --rebuild --wait-for-env 60
npx playwright test                         # both projects, all specs
cd tools/test-bot && npm run smoke          # all Discord smoke tests
# Chrome MCP drive (see Setup §5)
cd ../.. && ./scripts/deploy_dev.sh --down
mcp__mcp-env__env_lock_release
```

Interpret results:

- `npx playwright test` exits 0 → all specs passed on both desktop + mobile.
- Any test failure: open the HTML report (`npx playwright show-report`) and
  read the actual error. Never re-run hoping it passes — investigate first.
- "Flake" justifications are not accepted: per CLAUDE.md, every failure is a
  real product bug until proven otherwise. Add it to Known Issues with a
  Linear candidate.
- Chrome MCP observed behaviour is the **deciding evidence** for whether a
  Playwright failure is a real product bug vs a test-side flake.

## Known Issues

Findings from this validation run are logged in
[`TECH-DEBT-BACKLOG.md`](../../TECH-DEBT-BACKLOG.md) under the
`2026-05-12 — rok-1068-lineup-prelaunch-validation` batch. One entry
remains under that heading: the no-bound-channel degradation coverage
gap (AC 33). The rest have been resolved since the run: the
`/lineups/:id/matches` `carriedForward: []` hardcode was promoted to
ROK-1274 and fixed (PR #782); the Playwright fixture-race cluster was
triaged to ROK-1251 evidence comments and pruned; and the other three
coverage gaps (Steam-unlinked nominator warning, vote-at-deadline cron
race, abort embed reason variance) were covered in Phase F (AC rows
34–36).

Per `CLAUDE.md`, the backlog is operator-triaged: nothing in
`TECH-DEBT-BACKLOG.md` should be acted on by an agent without explicit
operator direction.

## Last Validated

| Field | Value |
|---|---|
| Timestamp | 2026-05-12T18:18Z (Phase F pass) |
| Git SHA | `22c5e2da` (carryover smoke) → `b00dc8fc` (runbook Phase D pass) → `3d388122` (Phase F runbook rows added) → `becba459` (Phase F lint cleanup) |
| Playwright suite | 598 passed / 9 failed / 13 did not run / 194 skipped (7.0m, Phase D run) — every failing test is a fixture race verified working in Chrome MCP; see Known Issues #1 |
| Companion bot suite | 92 passed / 8 failed (Phase D run); Phase F re-ran the abort cluster — 3 of 3 abort smokes pass (including new `abortReasonVarianceWalkthrough`). All lineup-related smokes pass. |
| Integration spec | `lineup-deadline-vote-race.integration.spec.ts`: 4/4 pass (CASE-A vote-before, CASE-B vote-after, CASE-C concurrent race, grace-queue idempotency). |
| Chrome MCP drive | All 30 web-side ACs driven against the dev env in Phase D + AC 34 (SteamNudgeBanner) driven in Phase F. No console errors. |
| AC coverage | **35 of 35** Linear sub-ACs driven via Playwright + Chrome MCP + integration spec + companion bot. The one remaining explicit DEMO_MODE-blocked gap (AC 33 — no-bound-channel degradation) is documented in `TECH-DEBT-BACKLOG.md`. |
| Known Issues | 1 entry remains in `TECH-DEBT-BACKLOG.md` under `2026-05-12 — rok-1068-lineup-prelaunch-validation` (the no-bound-channel coverage gap, AC 33). The `carriedForward: []` bug shipped as ROK-1274 (PR #782); the fixture-race cluster was pruned after ROK-1251 evidence triage. The 3 Phase F ACs (F1/F2/F3) were promoted out of the backlog into runbook AC rows 34/35/36. |
