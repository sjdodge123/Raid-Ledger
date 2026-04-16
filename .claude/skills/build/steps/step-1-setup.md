# Step 1: Setup — Cleanup, Fetch, Profile, Init State

Lead does everything directly. No agents spawned.

---

## 1a. Quick Workspace Cleanup

```bash
git worktree list
git fetch --prune
git branch --merged main | grep -v '^\*\|main' | xargs -r git branch -d
ls planning-artifacts/build-state-batch-*.yaml 2>/dev/null
```

Remove stale worktrees from previous builds (only if confirmed no in-flight work): `git worktree remove <path> --force`.

---

## 1b. Check for In-Flight State

Scan worktrees for prior state files:

```bash
for wt in ../Raid-Ledger--rok-*; do
  [ -f "$wt/build-state.yaml" ] && echo "$wt: $(grep 'current_step' "$wt/build-state.yaml")"
done
```

If a state file exists for the requested story, **reconcile against origin before trusting status.** Use `mcp__mcp-env__story_status({ stories: ["ROK-XXX", ...] })` — returns verdict per story: `done`, `in_flight`, `not_started`.

- `done` → set `status: "done"`, gates PASS, skip.
- `in_flight` → check PR state, determine resume point.
- `not_started` → resume from state file.

If the MCP is unavailable: `git fetch origin && git branch -r --merged origin/main | grep rok-<num>`.

After reconciliation:
- All stories `done` → clean worktree, start fresh.
- Any story with `requirements_gathered: false` → resume 1e for those only. Read existing specs from `planning-artifacts/specs/` for completed ones.
- Stories in `dev_active`/`testing` → skip to Step 2.
- `ready_for_validate` → Step 3; `waiting_for_operator` → Step 4; `ready_to_ship` → Step 5.

Only claim state files for stories YOU are building — other sessions may own the rest.

---

## 1c. Fetch Stories from Linear

```
mcp__linear__list_issues({ teamId: "0728c19f-5268-4e16-aa45-c944349ce386", statusName: "Dispatch Ready", first: 20 })
```

For rework: `statusName: "Changes Requested"`. For specific story: `mcp__linear__get_issue({ issueId: "ROK-XXX" })`.

---

## 1d. Profile Stories

Apply the profiling matrix from SKILL.md. Per story: scope (light/standard/full), `needs_planner` (true if full), `needs_architect` (true if full), serialization conflicts (touches `packages/contract`? migration? file overlap?).

Group into batches respecting serialization. Max 2-3 devs per batch.

**Migration rule:** if a story adds a DB migration, it MUST be the only story in its batch. Shared Docker Postgres means deploying one worktree's migration affects all in-flight worktrees. Serialize migrations against everything — put them in their own batch.

---

## 1e. Requirements Interview (Plan Mode)

Assess every story's spec quality. Most won't pass — that's intentional.

**Spec is complete only if ALL are true:**
1. Exact file paths listed
2. Contract changes: before/after shapes (fields, types, nullability)
3. DB schema: columns/tables with types, nullability, defaults, indexes, migration direction
4. API endpoints: method, path, req/resp shapes, errors, auth
5. Behavioral edge cases (empty data, nulls, concurrency, partial failures, unauthorized)
6. UI states (loading, empty, error, success) for frontend work
7. Testable ACs (specific, automatable — not "works correctly")
8. Data flow: trigger → backend → persistence → response → UI

Mark each story SPEC_COMPLETE or SPEC_INCOMPLETE. If all complete → skip to 1f. If any incomplete → enter plan mode.

### Interview Protocol

1. `EnterPlanMode`.
2. For each incomplete story: present title, description, missing items, then targeted questions about behavior (not implementation). One story at a time. Group related gaps into 2-3 questions per round.
3. When a story's spec is complete, immediately write `planning-artifacts/specs/ROK-XXX.md`:

```markdown
# ROK-XXX: <title>

## Original Description
<from Linear>

## Enriched Spec (from interview)

### Files Affected
| File | Change Type | Description |

### Contract Changes / DB Changes / API Changes / UI States / Edge Cases / Data Flow / Acceptance Criteria
<sections filled out>
```

4. Update state: set `requirements_gathered: true`, `spec_file: "planning-artifacts/specs/ROK-XXX.md"` per story — critical for recovery.
5. After all stories spec'd → `ExitPlanMode` → continue to 1f.

**Context survival:** state file tracks `requirements_gathered`. Specs live on disk. On resume, completed stories skip the interview automatically.

---

## 1f. Present Batch to Operator

```
## Build Batch <N>
| # | Story | Scope | Planner | Architect | Notes |
|---|-------|-------|---------|-----------|-------|

Serialization: <describe>
Estimated agents: N dev + N test + N reviewer
```

Wait for operator approval. Approval during discussion ("go", "let's do it") IS confirmation — don't re-ask.

---

## 1g. Initialize State File

Write `<worktree>/build-state.yaml` after worktree creation in Step 2a. Schema:

```yaml
pipeline:
  current_step: "implement"
  batch: 1
  next_action: "Read step-2-implement.md. Create worktrees and spawn dev subagents."
  stories:
    ROK-XXX:
      title: "..."
      linear_id: "<uuid>"
      scope: standard  # light | standard | full
      status: "queued"
      branch: "rok-xxx-short-name"
      worktree: "../Raid-Ledger--rok-xxx"
      needs_planner: false
      needs_architect: false
      requirements_gathered: true
      spec_file: "planning-artifacts/specs/ROK-XXX.md"  # null if pre-complete
      e2e_test_type: "playwright"  # playwright | discord_smoke | integration | unit
      e2e_test_file: null  # filled by test agent in 2d
      gates:
        e2e_test_first: PENDING
        dev: PENDING
        ci: PENDING
        playwright: PENDING  # set in 3c.5
        operator: PENDING
        reviewer: PENDING
        architect_final: PENDING
        smoke_test: PENDING  # Lead's final smoke in 4d
      next_action: "Queued."
      agent_history: []
```

---

## 1h. Update Linear to "In Progress"

Mandatory before Step 2. For each story:
```
mcp__linear__save_issue({ issueId: "<linear_id>", statusName: "In Progress" })
```

Proceed to **Step 2**.
