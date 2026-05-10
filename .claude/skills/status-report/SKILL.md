---
name: status-report
description: "Print a consistent, scannable status report. On a story branch (matches `rok-\\d+`): per-agent snapshot — story ID, phase, what's done, what's next, blockers; during Reviewing also drives the work forward (implements undelivered ACs, runs missing e2e). On `main` (no story branch): global mode — reconciles the 'Raid Ledger — Active State' Linear doc by re-deriving env lock, in-flight stories, recently shipped, open follow-ups, and known stale state. Use when the operator asks for a status update ('status', 'where are we', 'what's the state', 'update', 'sync state')."
---

# Status Report — Per-Agent Snapshot or Global State Sync

**Two modes**, dispatched by branch:

1. **Story-branch mode** (`rok-\d+` in branch name) — per-agent snapshot. The operator runs 10+ agent windows in parallel and forgets which window is which; this skill produces a 10-second-readable snapshot of THIS agent's work so they can identify the window and decide whether to interact. Output MUST match the template exactly — same fields, same order, same labels — every invocation. Consistency is the entire point. If a field has no content, write `none`. Never substitute "no progress yet" or other prose for missing fields.

2. **Global mode** (`main` or any branch with no `rok-\d+`) — reconcile the cross-session "Active State" Linear doc. Reads current doc, re-derives env lock + in-flight + recently shipped + open follow-ups + known stale state from authoritative sources, overwrites the Derived section, preserves Strategic and Conventions sections verbatim, prints a brief 3-line summary.

---

## Step 0: Branch-mode dispatch (run first)

Run `git branch --show-current`. Pick the path:

- Branch matches `rok-\d+` → **Story-branch mode**: continue with Steps 1–4 below.
- Branch is `main` (or any branch with no `rok-\d+`) → **Global mode**: jump to the "Global mode" section near the end of this file. Do **not** run Steps 1–4.

---

## Step 1: Gather Signals (only what you need)

Pull from these sources, stopping as soon as you can fill the template:

1. **In-conversation tasks** — call `TaskList`. In-progress tasks → `NOW`, pending → `NEXT`, completed → `DONE`.
2. **Branch name** — `git branch --show-current`. Extract story ID via `rok-\d+` (uppercase for display).
3. **`task.md`** at repo root (created by `/build` Step 1) — source for story title + acceptance criteria.
4. **`planning-artifacts/specs/ROK-XXX.md`** (created by `/build`) — fuller spec if present.
5. **Linear story** — only call `mcp__linear__get_issue` if no local artifact has the title.
6. **Git status** — `git status --porcelain` for uncommitted work, `git log -5 --oneline` for recent commits.
7. **PR state** — `gh pr list --head <branch> --json number,state,isDraft` if a branch exists. If a PR exists AND Phase will be `PR-Open`, fetch the full snapshot in Step 2.5 — don't pre-fetch here.

Do not run an exhaustive sweep. Stop the moment you have enough to fill the template.

---

## Step 2: Pick Phase (one word)

Choose the latest phase in the lifecycle that still has work outstanding:

| Phase | When to use |
|---|---|
| `Planning` | Spec or plan being drafted, no implementation yet |
| `Implementing` | Code being written or edited |
| `Validating` | Running local CI / tests / typecheck |
| `Reviewing` | Review pass active, or addressing review findings |
| `Pushing` | Local CI green, push in progress |
| `PR-Open` | PR exists, CI running or awaiting merge |
| `Merged` | PR merged, branch cleanup pending |
| `Idle` | No active work, awaiting operator input |
| `Blocked` | Use **only** if a `BLOCKERS` entry is preventing all forward motion |

If multiple apply, pick the latest in the list above that still has outstanding work.

---

## Step 2.5: Phase-Conditional Self-Checks (mandatory)

Before printing, run the checks that match the chosen phase. These exist because agents routinely declare a phase done without verifying — this step forces self-interrogation. Findings feed `AC TRACE` (Reviewing only), `BLOCKERS`, and may force a phase downgrade.

### If Phase == `Reviewing`

You are about to claim review-readiness. Answer **both** questions honestly. Do not soften, do not assume.

1. **Have ALL acceptance criteria been delivered?**
   - Enumerate every AC from `task.md`, `planning-artifacts/specs/ROK-XXX.md`, or the Linear story (in that order of preference).
   - For each AC: mark `delivered` only if there is committed code that implements it. Pending edits, mocks, or "will do next" do **not** count.
2. **Have end-to-end tests been performed AND validated those ACs?**
   - For each AC, identify the e2e test that exercises it: Playwright smoke (`npx playwright test`), Discord smoke (`tools/test-bot/npm run smoke`), or NestJS integration test (`npm run test:integration -w api`) — choose by surface per `CLAUDE.md`.
   - Mark `validated` only if the test has been **run** in this conversation (or referenced commit) and passed. Test exists ≠ test ran ≠ test passed. All three must be true.
   - Per the project memory rule "every feature/fix MUST include an end-to-end test" — UI → Playwright, Discord → companion bot smoke, API → integration, pure logic → unit. An AC without the matching surface's e2e is **not validated**.

**Consequences of the answers:**

- Any AC not `delivered` → add a BLOCKERS bullet `AC <n> not delivered: <one-line gap>` AND downgrade Phase to `Implementing`.
- Any AC `delivered` but not `validated` → add a BLOCKERS bullet `AC <n> not e2e-validated: <missing test or unrun test>` AND downgrade Phase to `Validating`.
- Both questions answered "yes" for every AC → Phase stays `Reviewing` and the AC TRACE block confirms it.

The `AC TRACE` block (see Step 3) is **mandatory** when Phase is `Reviewing` — including the case where it gets downgraded. The trace explains the downgrade.

After the report prints, **Step 4 fires** for any invocation whose originally-chosen phase was `Reviewing` (regardless of downgrade). Step 4 acts on the gaps surfaced here.

### If Phase == `PR-Open`

You are about to claim a PR is open. Pull the live state and translate any failure signal into a BLOCKERS bullet — "PR is open" without details wastes the operator's next decision.

**Freshness mandate (STRICT — read this before fetching):**

CI moves under you. A PR that was "2 checks running" five minutes ago may now be merged, failed, or have a new review. Therefore:

- You **MUST** run the `gh pr view` command in this turn, every invocation. Treat any earlier fetch in this conversation as expired.
- You **MUST NOT** infer PR state from prior tool results, prior reports you generated, or summary tables produced by upstream skills (`/build`, `/bulk`, `/fix-batch`, `/push`). Those are snapshots from when *they* ran — not now.
- If `gh pr view` fails (network, auth, rate-limit) → do **not** substitute remembered state. Add a BLOCKERS bullet `PR state unverified — gh pr view failed: <error>` and stop the PR-Open block. A stale "all green" claim is worse than an honest "unknown."

1. **Fetch the snapshot (right now, in this turn):**

   ```
   gh pr view <branch> --json number,state,isDraft,mergeable,mergeStateStatus,reviewDecision,autoMergeRequest,statusCheckRollup,url
   ```

   Run this command every time the skill fires. Do not skip it because "the operator just saw a PR summary a moment ago."

2. **Read each field and decide:**

   | Field | What to look for | Translation |
   |---|---|---|
   | `state` | `MERGED` | Downgrade Phase to `Merged`; this skill is mis-phased. |
   | `state` | `CLOSED` (not merged) | Phase → `Blocked`; BLOCKERS bullet `PR #N closed without merge`. |
   | `isDraft` | `true` | BLOCKERS bullet `PR #N is still draft — convert when ready`. |
   | `autoMergeRequest` | `null` | BLOCKERS bullet `auto-merge not enabled — run gh pr merge <branch> --auto --squash` (per CLAUDE.md). |
   | `reviewDecision` | `CHANGES_REQUESTED` | BLOCKERS bullet `review requested changes — address before merge`. |
   | `reviewDecision` | `REVIEW_REQUIRED` | Informational, not a blocker — note in PR STATUS. |
   | `mergeable` | `CONFLICTING` | BLOCKERS bullet `merge conflicts — rebase onto origin/main`. |
   | `mergeStateStatus` | `BLOCKED` / `BEHIND` / `DIRTY` | BLOCKERS bullet describing the specific state. |
   | `statusCheckRollup` | any check with `conclusion: FAILURE` or `state: FAILURE` | BLOCKERS bullet per failing check `CI failing: <check name>`. |
   | `statusCheckRollup` | checks with `status: IN_PROGRESS` / `PENDING` | Informational — count them in PR STATUS, not a blocker. |

3. **Tally the checks** for the PR STATUS block. **Bucket each check exactly once, in this order** — `conclusion` wins over `status`, because GitHub leaves `status: COMPLETED` (or even `IN_PROGRESS` briefly) on checks whose `conclusion` is already `FAILURE`:
   * If `conclusion in (FAILURE, CANCELLED, TIMED_OUT, ACTION_REQUIRED)` → **failing** (regardless of `status`).
   * Else if `conclusion in (SUCCESS, NEUTRAL, SKIPPED)` → **passing**.
   * Else if `status in (IN_PROGRESS, QUEUED, PENDING, WAITING)` → **running**.
   * Else → still running (treat as `running`, never silently drop a check from the tally).
   * Total = sum of the three. Sanity-check: total must equal the rollup length; if it doesn't, you mis-bucketed and the report is wrong — re-tally before printing.

The `PR STATUS` block (see Step 3) is **mandatory** when Phase is `PR-Open` (including when downgraded to `Merged` / `Blocked` — the trace explains why).

### Other phases

No additional self-checks today. Do not invent them.

---

## Step 3: Print the Report

Print **this template exactly**. No prose before, no commentary after. The report ends with the `BLOCKERS` section.

**Base template (every phase):**

```
═══ STATUS ═══
Story:    <ROK-XXX> — <story title, or "no story" if none>
Branch:   <branch name, or "none">
Phase:    <one phase word from Step 2 (post-downgrade)>

DONE
- <bullet>
- <bullet>

NEXT
- <single next concrete action>

BLOCKERS
- <bullet, or "none">
```

**Reviewing addendum (insert AC TRACE between NEXT and BLOCKERS, only when Step 2.5 ran):**

```
AC TRACE
- AC1 <one-line summary>     — delivered: yes/no  | e2e: <test ref or "missing">  | validated: yes/no
- AC2 <one-line summary>     — delivered: yes/no  | e2e: <test ref or "missing">  | validated: yes/no
- ...
```

The block must list **every** AC, not just the failing ones. The operator scans for any `no` or `missing` and knows immediately what's left.

**PR-Open addendum (insert PR STATUS between NEXT and BLOCKERS, only when Step 2.5 ran the PR-Open checks):**

```
PR STATUS
- PR #<n>          <url>
- State:           OPEN | MERGED | CLOSED  (draft: yes/no)
- Auto-merge:      enabled (squash) | not enabled
- Review:          APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED | none
- Mergeable:       MERGEABLE | CONFLICTING | UNKNOWN  (state: <mergeStateStatus>)
- CI:              <passing>/<total> passing, <failing> failing, <running> running
- Failing checks:  <name1>, <name2>  (omit line if zero)
```

Cite check names verbatim from `statusCheckRollup` so the operator can `gh run view` directly. If `state: MERGED`, write the same block (now under Phase `Merged`) and add a single `BLOCKERS` line `branch cleanup pending` if local branch still exists.

### Rules

- **Story line** — uppercase ID + em-dash + title. If no Linear story is associated, write `Story:    no story — <one-line description of work>`.
- **Phase line** — print the **post-downgrade** value from Step 2.5, not the originally chosen phase.
- **DONE** — work completed **in this conversation**, not historical commits. Max 5 bullets, oldest first. Each ≤80 chars.
- **NEXT** — the single next concrete action, not a roadmap. 1–3 bullets max. Each ≤80 chars.
- **BLOCKERS** — anything preventing forward progress: failing tests, missing decisions, missing creds, awaiting operator approval, unresolved questions, plus every AC-trace gap surfaced in Step 2.5. Write `none` if there are none.
- **AC TRACE** — required when Phase started as `Reviewing` in Step 2 (even if downgraded by Step 2.5). Omit entirely for any other phase. One line per AC, ≤120 chars per line. The `e2e` field cites the actual test path (e.g. `web/e2e/lineup-vote.spec.ts`) or writes `missing`.
- **PR STATUS** — required when Phase started as `PR-Open` in Step 2 (even if downgraded to `Merged` or `Blocked` by Step 2.5). Omit entirely for any other phase. Field labels are fixed; values come straight from `gh pr view --json` output.
- Do **not** add summary, recommendations, or "let me know if…" lines after the template. Stop **printing text** at `BLOCKERS`. Tool calls invoked from Step 4 (Drive Forward) are not text and do not violate this rule — they fire silently after the report renders.
- Do **not** wrap the report in additional markdown headers, code fences, or callouts. Print it as-is.
- If invoked twice in the same conversation, the report should be reproducible — same phase + same DONE list as last time, plus any new entries.

---

## Step 4: Phase-Conditional Drive Forward (post-print)

After the report renders, run the action that matches the originally-chosen phase from Step 2. These are the **action counterpart to Step 2.5's checks** — same per-phase structure, same "If Phase == X / Other phases: do not invent" voice, just running *after* the operator sees the snapshot rather than before. Step 4 may invoke tools (commits, tests, env management) but never prints additional text — the report still ends at `BLOCKERS`.

### If Phase == `Reviewing`

The operator invoked `/status-report` on a Reviewing-phase window because they want forward motion, not narration. Pick the action by **post-Step-2.5** phase (Step 2.5 may have downgraded `Reviewing` → `Implementing` or `Validating`):

**If post-downgrade Phase is `Implementing` (some AC not delivered):**

The Step 2.5 trace already enumerated the gaps. Pick them up directly.

- Work gaps in spec order. Lead-direct edits per memory `feedback_lead_does_small_fixes.md` — small fixes don't need a respawned dev agent.
- Commit-cluster cadence per memory `feedback_commit_often_dev_agents.md` — ≤4–5 files per commit, message style matching recent log.
- After implementation completes, run `./scripts/validate-ci.sh --full` per memory `feedback_pre_push_checks.md`.
- Re-invoke `/status-report` to print a fresh snapshot. The next pass lands in the `Validating` or `Reviewing` (no-downgrade) case below.

Halts inside this case:

- Architectural decision, missing creds, or operator approval needed → stop, do not invent. Re-invoke; BLOCKERS will surface it.
- `validate-ci.sh` fails on something *outside* the gap you implemented → stop. Do not stack fixes (memory `feedback_one_fix_per_outage.md`).
- Gap touches infrastructure (Dockerfile, entrypoints, nginx) → stop. Memory `feedback_infrastructure_changes.md` requires its own PR + local container validation; this skill is not the vehicle.

**If post-downgrade Phase is `Validating` (ACs delivered, e2e missing/unrun):**

Run the e2e suite(s) for the story's surface(s), but only if the env is genuinely available.

1. **Determine suite(s)** from `git diff --name-only origin/main..HEAD` per `CLAUDE.md` mapping:
   - `web/**` (esp. `*.tsx`) → Playwright (UI surface)
   - `api/src/discord-bot/**`, `api/src/notifications/**`, `api/src/events/signups*`, `api/src/events/event-lifecycle*`, `api/src/admin/demo-test*`, `tools/test-bot/**` → Discord smoke
   - Other `api/**` → integration tests
   - Pure-logic only → unit tests already cover it; no e2e needed. Re-invoke (the next trace will return Phase to `Reviewing`).
   - Multiple surfaces → run all applicable, cheapest-first per step 4 below.
2. **Stage uncommitted work first.** `git status --porcelain` must be clean before running tests.
3. **Check env availability** — `mcp__mcp-env__env_service_status` (fallback `./scripts/deploy_dev.sh --status`):
   - Up on this branch → proceed.
   - Down → bring it up: `./scripts/deploy_dev.sh --ci` (add `--rebuild` if `packages/contract` or generated types changed; never `--fresh` unless story explicitly requires a reset).
   - Up on a *different* branch → stop, do not seize (memory `feedback_deploy_env_etiquette.md`). Re-invoke; BLOCKERS gains `env occupied by <other-branch> — release with deploy_dev.sh --down or skip auto-test, then re-run /status-report`.
4. **Run cheapest-first** so failures surface fast:
   1. Integration: `npm run test:integration -w api`
   2. Discord smoke: `cd tools/test-bot && npm run smoke` — requires Discord launched with CDP per `scripts/launch-discord.sh`; if CDP isn't up, treat as env-unavailable for that suite and surface as a BLOCKER (do not auto-launch Discord — operator must approve).
   3. Playwright: `npx playwright test` — **both** `desktop` and `mobile` projects, never `--project=desktop` (memory rule from ROK-935 incident).
5. **All pass** → re-invoke `/status-report`; the next trace lands in the no-downgrade case below.
6. **Any fail** → never retry, never stack fixes (memory `feedback_smoke_tests.md`). Capture failing test name + first error line, re-invoke; BLOCKERS gains `e2e failing: <suite> <test name> — <one-line cause>`. Operator decides next step.

**If post-downgrade Phase stayed `Reviewing` (ACs delivered AND validated):**

No action. The report stands and the agent waits — the window is genuinely ready for operator review.

### Other phases

No driving today. Do not invent it.

### Halts that override every phase

- Operator has explicitly asked in *this conversation* for a passive snapshot ("just give me the status, don't do anything") → skip Step 4 entirely.
- No story is associated (`Story: no story — ...`) → skip; without ACs, "drive forward" has no target.

(Note: `main` no longer halts — Step 0 routes main-branch invocations to Global mode below.)

---

## Global mode — reconcile the Active State Linear doc

Trigger: Step 0 routed here because branch is `main` (or any branch with no `rok-\d+`).

**Goal:** keep the cross-session "Raid Ledger — Active State" Linear doc current by re-deriving the auto-managed sections from authoritative sources, while preserving operator/agent-authored strategic context untouched.

**Doc reference (stable):** see memory `reference_active_state_doc.md`.
- URL: `https://linear.app/roknua-projects/document/raid-ledger-active-state-7a4ddc5652c9`
- Doc ID for `mcp__linear__save_document`: `bbacd5ae-0c99-4eaf-bbd7-24e7eb90ffce`
- Slug: `7a4ddc5652c9`

### Step G1: Read the current doc

`mcp__linear__get_document` with the slug above. Capture the full content. **Identify three section anchors** by markdown heading:
- `## Derived (auto-overwritten by ...)` — to be replaced
- `## Strategic (operator + agent updates ...)` — preserve verbatim
- `## Conventions` — preserve verbatim

If any anchor is missing or out of order, **stop and surface a BLOCKER** (`active state doc structure broken: <which anchor>`). Do not write a malformed doc.

### Step G2: Re-derive each Derived bucket

Run these in parallel where possible. Each bucket maps to a labelled subsection in the new Derived block.

| Bucket | Source command(s) | Notes |
|---|---|---|
| **Env lock** | `cat ~/.raid-ledger/env-lock.json` | If `holder: null` and queue empty, write "Holder: `null` / Queue: empty". Otherwise list holder branch + purpose + acquired_at, then queued branches in order. |
| **In flight** | `gh pr list --state open --json number,title,headRefName,createdAt` AND `mcp__linear__list_issues` for statuses `In Progress`, `Code Review` AND `git worktree list` | Cross-reference: a worktree on a non-main commit + an active Linear story = "in flight." Include architectural verdict if it's been recorded in Strategic (helpful for resumption). |
| **Recently shipped** | `git log --oneline --since="7 days ago" origin/main` AND `gh pr list --state merged --search "merged:>=$(date -u -v-7d +%Y-%m-%d)" --json number,title,headRefName` | Match commits to PRs to story IDs. Newest first. Cap at ~10 entries. |
| **Open follow-ups (last 7 days)** | `mcp__linear__list_issues --createdAt -P7D` filtered to states `Backlog`, `Todo` | Skip stories already in flight (covered above). Brief why-it-matters one-liner per entry. |
| **Known stale state** | Cross-reference `git worktree list` against `git log --oneline origin/main` | Worktrees on commits that aren't on main AND whose corresponding story is shipped → flag as cleanable. Worktrees on commits that aren't on main AND whose story is in flight → not stale, skip. |

If any source command fails (network, auth, missing file), surface the failure as a BLOCKER in the print summary AND skip that bucket (write the literal text `(unavailable — <one-line reason>)`). Do not invent values.

### Step G3: Construct the new Derived section

Use this exact layout:

```markdown
## Derived (auto-overwritten by `/status-report` on `main`)

### Env lock
- Holder: <holder block or `null`>
- Queue: <queue block or `empty`>

### In flight
- **<ROK-XXXX>** — <title>. Status: <Linear status>. Branch <branch> in worktree <worktree>. <PR or "No PR yet">. <one-line architectural note if relevant>.

### Recently shipped (last 7 days, newest first)
- `<sha>` PR #<n> — <ROK-XXXX> <title>

### Open follow-ups filed last 7 days
- **<ROK-XXXX>** (<status> / <priority>) — <one-line why-it-matters>

### Known stale state
- <description, OR "none">
```

If a subsection has no content, write `- none` rather than omitting the subsection — readers should see the structure even when the bucket is empty.

### Step G4: Write back

Reassemble the full doc:

```
<header up to and including the two intro blockquotes>
---
<new ## Derived section from Step G3>
---
<preserved ## Strategic section from Step G1, byte-for-byte>
---
<preserved ## Conventions section from Step G1, byte-for-byte>
```

The horizontal rules (`---`) between sections are part of the layout; preserve them. Update the `**Last derived update:**` date at the top to today's ISO-8601 date (UTC).

Call `mcp__linear__save_document` with `id: bbacd5ae-0c99-4eaf-bbd7-24e7eb90ffce` and the reassembled content.

### Step G5: Print a 3-line summary

Output **exactly** this format (no template, no addenda — global mode has its own minimal output):

```
═══ ACTIVE STATE SYNCED ═══
Doc:      https://linear.app/roknua-projects/document/raid-ledger-active-state-7a4ddc5652c9
Derived:  <N> in-flight | <M> shipped 7d | <K> follow-ups | <S> stale items
Note:     <one-line — anything that warranted attention, or "no anomalies">
```

The `Note:` line is for things the operator should see at a glance — e.g. "ROK-1250 in flight 24h+ without PR", "env lock held by ROK-XXXX since <time>", "stale --rok-XXXX worktree can be removed". One sentence max. If nothing is notable, write `no anomalies`.

### Halts specific to Global mode

- Doc structure broken (Step G1 anchor check failed) → print BLOCKER and stop without writing.
- `mcp__linear__save_document` returns an error → print BLOCKER `doc save failed: <error>`. The next invocation will re-derive and retry.
- Operator explicitly says "don't update the doc" in this conversation → run Steps G1–G3, print Step G5's summary with `Note: doc-write skipped per operator request`, but skip Step G4 entirely.
