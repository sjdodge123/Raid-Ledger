# Community Lineup — Pre-Launch Validation Runbook

Pre-launch validation registry for the Community Lineup feature (ROK-1060
through ROK-1067 all merged). The runbook is a coverage-and-result registry,
not a hand-walked checklist — every AC maps to an existing automated test
file, a run command, and the most-recent observed result. Re-run the full
suite before any production release that touches lineup behaviour.

If you only need to validate one slice (e.g. the tiebreaker path), jump to
the [AC Registry](#ac-registry) below and run the file listed for that row.

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
Health: `curl http://127.0.0.1:3000/api/health`.

### 3. (Optional) Discord testing prerequisites

The companion bot smoke suite requires Discord running with CDP enabled
and a `tools/test-bot/.env` containing `DISCORD_TOKEN` + `GUILD_ID`.

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

### 5. Release the env lease

```text
mcp__mcp-env__env_lock_release
```

`./scripts/deploy_dev.sh --down` also releases.

## AC Registry

Each AC maps to a primary test file. "Coverage" is one of:

- **full** — automated smoke + integration test exists and asserts the AC.
- **partial** — automated test exists but asserts a subset of the AC.
- **gap** — no automated test exists.

| # | AC | Primary test file | Coverage | Run command |
|---|----|-------------------|----------|-------------|
| 1 | Banner appears on the Games page with title, status, nomination count, and Nominate CTA | `scripts/smoke/community-lineup.smoke.spec.ts` | full | `npx playwright test community-lineup` |
| 2 | Detail page renders header, phase breadcrumb, progress bar, activity timeline, nomination grid | `scripts/smoke/community-lineup.smoke.spec.ts` | full | `npx playwright test community-lineup` |
| 3 | Nomination modal: search → preview → submit → grid update | `scripts/smoke/community-lineup.smoke.spec.ts` | full | `npx playwright test community-lineup` |
| 4 | Voting phase: leaderboard renders, vote toggles with emerald accent, vote-count pill flips count → waitingOn | `scripts/smoke/community-lineup.smoke.spec.ts` | full | `npx playwright test community-lineup` |
| 5 | Decided view: podium with Champion/Silver/Bronze, tiered match cards, bandwagon UI, rally URL, stats panel | `scripts/smoke/lineup-decided.smoke.spec.ts` | full | `npx playwright test lineup-decided` |
| 6 | Start Lineup flow: modal opens via test param, duration sliders pre-fill, submit → detail page | `scripts/smoke/lineup-creation.smoke.spec.ts` | full | `npx playwright test lineup-creation` |
| 7 | Phase countdown displays on banner + detail | `scripts/smoke/lineup-creation.smoke.spec.ts` | full | `npx playwright test lineup-creation` |
| 8 | Phase breadcrumb: operator clicks next/previous → modal → confirm → status flips | `scripts/smoke/lineup-phase-breadcrumb.smoke.spec.ts` | full | `npx playwright test lineup-phase-breadcrumb` |
| 9 | Auto-advance live UI refresh — user B's open page reflects user A's REST advance within 5s | `scripts/smoke/lineup-auto-advance.smoke.spec.ts` | full | `npx playwright test lineup-auto-advance` |
| 10 | Auto-advance grace window — pending-advance, vote toggle clears it, re-cast restarts it | `api/src/lineups/lineup-auto-advance-grace.integration.spec.ts` + `tools/test-bot/src/smoke/tests/lineup-grace-countdown.test.ts` | full | `npm run test:integration -w api -- lineup-auto-advance-grace` + `cd tools/test-bot && npm run smoke` |
| 11 | Votes-per-player slider (1–10, default 3) on create modal, configured limit honoured in voting UI, GET /lineups/:id returns maxVotesPerPlayer | `scripts/smoke/lineup-votes-per-player.smoke.spec.ts` | full | `npx playwright test lineup-votes-per-player` |
| 12 | Hero + ConfirmationPill across building/voting/decided + mobile sticky compact | `scripts/smoke/lineup-confirmation-pills.smoke.spec.ts` | full | `npx playwright test lineup-confirmation-pills` |
| 13 | Tiebreaker prompt modal with bracket/veto mode selection + dismiss | `scripts/smoke/lineup-tiebreaker.smoke.spec.ts` | full | `npx playwright test lineup-tiebreaker` |
| 14 | Tiebreaker bracket: SVG tree, matchup cards, vote, auto-resolve to decided | `scripts/smoke/lineup-tiebreaker.smoke.spec.ts` | full | `npx playwright test lineup-tiebreaker` |
| 15 | Tiebreaker veto: card grid, blind submit, cap enforcement, force-resolve → decided | `scripts/smoke/lineup-tiebreaker.smoke.spec.ts` | full | `npx playwright test lineup-tiebreaker` |
| 16 | Tiebreaker dismiss with no tiebreaker row (ROK-1262 regression) | `scripts/smoke/lineup-tiebreaker.smoke.spec.ts` | full | `npx playwright test lineup-tiebreaker` |
| 17 | Tiebreaker late-join: opens lineup after tiebreaker started → veto form visible, veto accepted | `scripts/smoke/lineup-tiebreaker-late-join.smoke.spec.ts` | full | `npx playwright test lineup-tiebreaker-late-join` |
| 18 | Tiebreaker "Vote closed at HH:MM" empty state after resolution | `scripts/smoke/lineup-tiebreaker-late-join.smoke.spec.ts` | full | `npx playwright test lineup-tiebreaker-late-join` |
| 19 | Tiebreaker progress meter (F-29 regression) | `scripts/smoke/lineup-tiebreaker.smoke.spec.ts` | full | `npx playwright test lineup-tiebreaker` |
| 20 | Tiebreaker Discord notification + channel embed (open + resolution) | `tools/test-bot/src/smoke/tests/lineup-tiebreaker-open.test.ts` | full | `cd tools/test-bot && npm run smoke` |
| 21 | Channel override happy path — channelOverrideId round-trips | `scripts/smoke/lineup-channel-override.smoke.spec.ts` | full | `npx playwright test lineup-channel-override` |
| 22 | Channel override fallback — bot loses perm on override channel mid-lineup, falls back to bound | `scripts/smoke/lineup-channel-override.smoke.spec.ts` + `tools/test-bot/src/smoke/tests/lineup-channel-override.test.ts` | full | Both commands above |
| 23 | Admin abort from each phase (building/voting/decided) | `scripts/smoke/lineup-admin-abort-phases.smoke.spec.ts` | full | `npx playwright test lineup-admin-abort-phases` |
| 24 | Admin abort UI: modal with reason field, member cannot see button, archived hides button | `scripts/smoke/lineup-abort.smoke.spec.ts` | full | `npx playwright test lineup-abort` |
| 25 | Admin abort Discord embed posted to bound channel | `tools/test-bot/src/smoke/tests/lineup-abort.test.ts` | full | `cd tools/test-bot && npm run smoke` |
| 26 | Empty participation: voting lineup with zero nominations renders + abort still works | `scripts/smoke/lineup-empty-participation.smoke.spec.ts` | full | `npx playwright test lineup-empty-participation` |
| 27 | Single voter scenario: stable payload, NaN/Infinity-free detail page | `scripts/smoke/lineup-single-voter.smoke.spec.ts` | full | `npx playwright test lineup-single-voter` |
| 28 | Private lineup DM-only behaviour: visibility persists, public share returns 404, no channel embeds | `scripts/smoke/lineup-private-dm-only.smoke.spec.ts` + `tools/test-bot/src/smoke/tests/lineup-private-dm.test.ts` + `tools/test-bot/src/smoke/tests/private-lineup.test.ts` | full | Both commands above |
| 29 | Public share toggle: un-authed access works, toggle-off → 404 UI, decision block conditional on status=decided | `scripts/smoke/public-lineup-share.smoke.spec.ts` + `tools/test-bot/src/smoke/tests/public-share-link.test.ts` | full | Both commands above |
| 30 | Public share accessibility landmarks: h1, lang, main, tab focus | `scripts/smoke/public-lineup-share.smoke.spec.ts` | full | `npx playwright test public-lineup-share` |
| 31 | Lineup title + description appear in lifecycle Discord embeds | `tools/test-bot/src/smoke/tests/lineup-title.test.ts` | full | `cd tools/test-bot && npm run smoke` |
| 32 | Carryover: a new lineup auto-populates carried-forward chips from the most recent decided public lineup | `scripts/smoke/lineup-carryover.smoke.spec.ts` (added by ROK-1068) | full | `npx playwright test lineup-carryover` |
| 33 | Community has no bound notification channel → lifecycle dispatches degrade gracefully (no crash, no retries) | — | gap | See [Known Issues](#known-issues) |

## How to Validate

```bash
# Full pre-launch sweep
./scripts/validate-ci.sh --full
mcp__mcp-env__env_lock_acquire { purpose: "lineup validation" }
./scripts/deploy_dev.sh --ci --rebuild --wait-for-env 60
npx playwright test                         # both projects, all specs
cd tools/test-bot && npm run smoke          # all Discord smoke tests
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

## Known Issues

### Candidate: tech-debt — no-bound-channel graceful degradation lacks coverage

**Problem.** When a community has `channel_bindings.lineup` unset (no default
notification channel bound), the lifecycle dispatcher currently warns once and
no-ops. There is no smoke spec exercising this state because every test
fixture uses a channel-bound community. A regression here would be silent
in CI and only surface when an operator self-hosts without binding a
channel before starting their first lineup.

**Acceptance.** Add either (a) an integration test that asserts
`LineupNotificationService.dispatch*` returns gracefully and emits the
`channel-unbound` log line when `channelBindings.lineup === null`, or
(b) a companion-bot smoke that creates a lineup in a guild with no
bound channel and `assertConditionNeverMet` on any channel embed for the
full lineup lifecycle. Operator triages whether this is `tech-debt:` or
`fix:`.

## Last Validated

| Field | Value |
|---|---|
| Timestamp | _(populated by Phase D run)_ |
| Git SHA | _(populated by Phase D run)_ |
| Summary | _(populated by Phase D run)_ |
