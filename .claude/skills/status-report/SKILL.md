---
name: status-report
description: "Print a consistent, scannable status report for the current agent's work — story ID, phase, what's done, what's next, blockers. Use when the operator asks for a status update across multiple parallel agent windows ('status', 'where are we', 'what's the state', 'update')."
---

# Status Report — Per-Agent State Snapshot

**Goal:** The operator runs 10+ agent windows in parallel and forgets which window is which. This skill produces a 10-second-readable snapshot of THIS agent's work so they can identify the window and decide whether to interact.

Output **MUST** match the template exactly — same fields, same order, same labels — every invocation. Consistency is the entire point. If a field has no content, write `none`. Never substitute "no progress yet" or other prose for missing fields.

---

## Step 1: Gather Signals (only what you need)

Pull from these sources, stopping as soon as you can fill the template:

1. **In-conversation tasks** — call `TaskList`. In-progress tasks → `NOW`, pending → `NEXT`, completed → `DONE`.
2. **Branch name** — `git branch --show-current`. Extract story ID via `rok-\d+` (uppercase for display).
3. **`task.md`** at repo root (created by `/start`) — source for story title + acceptance criteria.
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

### If Phase == `PR-Open`

You are about to claim a PR is open. Pull the live state once and translate any failure signal into a BLOCKERS bullet — "PR is open" without details wastes the operator's next decision.

1. **Fetch the snapshot:**

   ```
   gh pr view <branch> --json number,state,isDraft,mergeable,mergeStateStatus,reviewDecision,autoMergeRequest,statusCheckRollup,url
   ```

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

3. **Tally the checks** for the PR STATUS block:
   * `passing = checks where conclusion in (SUCCESS, NEUTRAL, SKIPPED)`
   * `failing = checks where conclusion in (FAILURE, CANCELLED, TIMED_OUT, ACTION_REQUIRED)`
   * `running = checks where status in (IN_PROGRESS, QUEUED, PENDING, WAITING)`
   * Total = sum of the three.

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
- Do **not** add summary, recommendations, or "let me know if…" lines after the template. Stop at `BLOCKERS`.
- Do **not** wrap the report in additional markdown headers, code fences, or callouts. Print it as-is.
- If invoked twice in the same conversation, the report should be reproducible — same phase + same DONE list as last time, plus any new entries.
