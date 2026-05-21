# Step 1: Setup — Cleanup, Profile Milestones, Init State

Lead does everything directly. No agents spawned.

This mirrors `/build`'s step-1 but profiles milestones FROM THE PLAN FILE instead of fresh from Linear.

---

## 1a. Quick Workspace Cleanup (same as /build 1a)

```bash
git worktree list
git fetch --prune
git branch --merged main | grep -v '^\*\|main' | xargs -r git branch -d
```

Sync main with origin: `git pull --rebase origin main`. Resolve any merge conflicts (operator config files ride along per CLAUDE.md).

---

## 1b. Self-Recovery Check (same as /build 1b)

```bash
for wt in ../Raid-Ledger--rok-*; do
  [ -f "$wt/build-state.yaml" ] && echo "$wt: $(grep 'current_step\|skill:' "$wt/build-state.yaml")"
done
```

If a `<worktree>/build-state.yaml` exists for the target story AND `skill: build-batch` → resume from the state file's `current_step` + `current_wave`. Skip the rest of step 1 and jump to step 2.

If not present → fresh batch build, continue.

---

## 1c. Read the Plan File AND Re-Query Linear

Required input: `planning-artifacts/specs/<STORY>-plan.md`. If missing → STOP, tell operator the plan is required and `/build-batch` cannot proceed without it. Suggest running planner pass first.

Also read the spec source: `planning-artifacts/specs/<STORY>.md`.

### 1c.1 — Re-query Linear for the latest issue state + comments (STRICT — mirrors /build 1c.1)

The plan + spec on disk are SNAPSHOTS from when they were written. Comments and description edits since then may add scope, escalate severity, or block the build entirely.

```
mcp__linear__get_issue({ id: "<STORY>" })
mcp__linear__list_comments({ issueId: "<STORY>" })
```

Diff against the spec file:
- **Description changed since spec written?** Update `planning-artifacts/specs/<STORY>.md` to match the current Linear description before proceeding. Note the diff in a state-file comment so the architect pre-dev pass sees it.
- **New comments since spec written?** Read each one. Categorize:
  - Triage / log evidence → fold into the affected milestone's spec OR escalate severity
  - Operator-added context ("actually this is blocked by X") → flag, possibly defer story
  - Cross-story coordination ("ship with Y first") → flag, possibly resequence with operator
  - Approval / decision on an open design question → fold into the plan, mark the open Q as DECIDED

If a comment materially changes scope (new milestone needed, scope removed, dependency added) → STOP and surface to operator before proceeding. Do NOT silently adjust the wave structure based on a comment without operator confirmation.

Print a one-line summary: `<STORY>: <N> comments, <N> new since spec ts <ts>, <N> material to scope`.

### 1c.2 — Verify open design questions resolved

Verify all open design questions in the plan are resolved (grep for `OPEN` — should be 0 entries, other than research-task ones like "check SDK source"). New comments may have answered previously-open questions — re-check after 1c.1.

---

## 1d. Profile Milestones from the Plan

For each milestone in the plan, extract:
- `id` (e.g. M1, M2, M5a)
- `title`
- `sizing_hours`
- `depends_on: [...]`
- `file_set: [...]` (from the "Files" sub-section — list of paths)
- `parallelizable_with: [...]`
- `pre_requisite_operator_actions: [...]`

If any milestone is `sizing_hours > 20` → STOP. Tell operator the plan needs revision (split that milestone) before /build-batch can proceed. Per `_notes.md` long-pole rule.

---

## 1e. Compute Wave Structure

Topologically sort by `depends_on`. Then for milestones in the same dependency-rank, group into waves:

1. **Disjoint file sets** → same wave (parallel-safe).
2. **Overlapping file sets** → push the smaller (lower sizing_hours) milestone to the NEXT wave OR split into non-overlapping + overlapping sub-parts (only if the plan explicitly says so).
3. **Cap each wave at 3 dev agents** per memory `general conventions`.

Write the wave plan to a scratch table; you'll persist it to `build-state.yaml::waves[]` after worktree creation in 1g.

Example output for ROK-1331:
```
Wave 2: M1 (foundation, alone)
Wave 3: M2 + M3 + M4 (parallel — disjoint files)
Wave 4: M5a + M6a (parallel — disjoint files)
Wave 5: M6b (alone — overlaps with M5b)
Wave 6: M5b (alone — overlaps with M6b)
```

(Wave 0 = spec wave, Wave 1 = TDD wave — both fully parallel by default.)

---

## 1f. Present Batch Plan to Operator

```
## /build-batch <STORY> — Wave Plan

Spec wave (0): <N> parallel spec agents
TDD wave (1):  <N> parallel test agents

Dev waves:
| Wave | Members        | Parallel | Long-pole hrs |
|------|----------------|----------|---------------|
| 2    | M1             | 1        | 8             |
| 3    | M2 + M3 + M4   | 3        | 14            |
| 4    | M5a + M6a      | 2        | 14            |
| 5    | M6b            | 1        | 5             |
| 6    | M5b            | 1        | 8             |

Total dev wallclock: <sum of long-poles> hrs of dev work.
Total agents over lifecycle: <count>.

Pre-req operator actions before this run:
- <list any from the plan>
```

Wait for operator approval. Approval during discussion ("go", "let's do it") IS confirmation. Don't re-ask.

---

## 1g. Create Worktree + Branch + Team

```bash
# Branch name from plan or default
BRANCH=<branch-from-plan>
WORKTREE="../Raid-Ledger--${BRANCH#sjdodge123/}"

# Create worktree
git worktree add -b "$BRANCH" "$WORKTREE" origin/main

# Copy .env files using mcp-env tool
# mcp__mcp-env__env_copy with source=main, destination=$WORKTREE

# Install deps
cd "$WORKTREE" && npm install
```

**Create the team:**
```
mcp__teams__create({ name: "build-batch-<STORY>", description: "..." })
```

(Or use TeamCreate equivalent.)

---

## 1h. Initialize State File

Write `<worktree>/build-state.yaml` with the schema documented in `SKILL.md`. Populate `milestones[*]` from the plan, `waves[]` from the structure computed in 1e.

Set:
- `pipeline.skill: build-batch`
- `pipeline.current_step: implement`
- `pipeline.current_wave: 0`
- `pipeline.next_action: "Read step-2-implement.md, sub-phase 2a. Spawn N parallel spec agents."`
- Every milestone `status: queued`, all gates `PENDING`.
- Every wave `status: pending`.

---

## 1i. Update Linear to "In Progress"

```
mcp__linear__save_issue({ issueId: "<linear_id>", statusName: "In Progress" })
```

Add a comment summarizing the wave plan so the operator can audit from Linear:

```markdown
**/build-batch started 2026-MM-DD** — <N> milestones in ONE PR.

Wave plan:
- Wave 0 (spec): M1..MN parallel
- Wave 1 (TDD): M1..MN parallel
- Wave 2 (dev): M1 alone
- Wave 3 (dev): M2 + M3 + M4 parallel
- ...

Branch: `<branch>`
Worktree: `<path>`
```

Proceed to **Step 2 — Implement.**
