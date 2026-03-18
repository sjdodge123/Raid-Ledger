# Step 1: Setup — Cleanup, Fetch, Profile, Init State

**Lead does everything directly. No agents spawned in this step.**

---

## 1a. Quick Workspace Cleanup

```bash
# Check for stale worktrees
git worktree list
git fetch --prune

# Delete local branches already merged to main
git branch --merged main | grep -v '^\*\|main' | xargs -r git branch -d

# Clean up old planning artifacts
ls planning-artifacts/build-state-batch-*.yaml 2>/dev/null
```

If stale worktrees exist from a previous build, remove them:
```bash
git worktree remove <path> --force  # only if confirmed no in-flight work
```

---

## 1b. Check for In-Flight State

Scan existing worktrees for state files from previous builds:

```bash
for wt in ../Raid-Ledger--rok-*; do
  [ -f "$wt/build-state.yaml" ] && echo "$wt: $(grep 'current_step' "$wt/build-state.yaml")"
done
```

- **If no state files found:** Fresh build. Continue to 1c.
- **If a state file exists for the requested story:** Read it, then **reconcile against origin before trusting any status.**

### Origin Reconciliation (MANDATORY before resuming)

The state file may be stale from a previous session that shipped stories. Always verify:

```bash
git fetch origin

# For each story in the state file, check if its branch was merged to main:
git branch -r --merged origin/main | grep rok-<num>
```

**For each story**, apply this logic in order:

1. **Branch merged to main?** (`git branch -r --merged origin/main | grep rok-<num>`)
   - Yes → story is **done**. Update state: `status: "done"`, all gates → `PASS`. Skip it entirely.
2. **Branch exists on origin but not merged?** (`git ls-remote --heads origin rok-<num>`)
   - Yes → check for an existing PR: `gh pr list --head rok-<num>-<short-name> --json state,url`
     - PR merged → story is **done**
     - PR open → resume from Step 5 (ship)
     - No PR → resume from Step 3 (validate)
3. **Branch does NOT exist on origin?**
   - Check worktree for commits → resume from where the state file says

After reconciliation, update the state file with corrected statuses, then:
  - If all stories are `done` → clean up worktree and start fresh
  - If ANY story has `requirements_gathered: false` → resume Step 1e (requirements interview) for those stories only. Read existing spec files in `planning-artifacts/specs/` for stories already interviewed.
  - If stories are in `dev_active` or `testing` → skip to Step 2 (check agent status)
  - If stories are in `ready_for_validate` → skip to Step 3
  - If stories are in `waiting_for_operator` → skip to Step 4
  - If stories are in `ready_to_ship` → skip to Step 5
  - Present a reconciled summary showing which stories were already shipped vs still in-flight

**IMPORTANT:** Only claim state files for stories YOU are building. If you find state files for OTHER stories, leave them alone — another session may be working on them.

---

## 1c. Fetch Stories from Linear

Use `mcp__linear__list_issues` to fetch dispatchable stories directly.

### Fetch Dispatch Ready stories:
```
mcp__linear__list_issues({
  teamId: "0728c19f-5268-4e16-aa45-c944349ce386",
  statusName: "Dispatch Ready",
  first: 20
})
```

### Fetch Changes Requested stories (rework):
```
mcp__linear__list_issues({
  teamId: "0728c19f-5268-4e16-aa45-c944349ce386",
  statusName: "Changes Requested",
  first: 10
})
```

### If operator specified `ROK-XXX`:
Fetch just that story:
```
mcp__linear__get_issue({ issueId: "ROK-XXX" })
```

### If operator specified `rework`:
Only fetch Changes Requested stories.

---

## 1d. Profile Stories

Apply the profiling matrix from SKILL.md to each story:

For each story, determine:
- **Scope:** light / standard / full (using the decision rules in SKILL.md)
- **needs_planner:** true if scope is `full`
- **needs_architect:** true if scope is `full`
- **Serialization conflicts:** Does it touch `packages/contract`? Add migrations? Overlap files with other stories?

Group stories into batches respecting serialization rules. Max 2-3 dev agents per batch.

---

## 1e. Requirements Interview (Plan Mode)

After profiling, assess **every** story's spec quality. Most stories will NOT pass this bar — that's intentional.

### Spec Completeness Checklist

A story's spec is **only** considered complete if it has **ALL** of the following:

1. **Exact file paths** — every file that will be created or modified is listed by path
2. **Contract changes spelled out** — if any DTO, schema, or endpoint signature changes, the before/after shapes are defined (field names, types, nullability)
3. **DB schema changes spelled out** — new columns/tables defined with types, nullability, defaults, indexes, and migration direction
4. **API endpoint specs** — method, path, request/response shapes, error cases, auth requirements
5. **Behavioral edge cases** — what happens on empty data, nulls, concurrent access, partial failures, unauthorized access
6. **UI state mapping** — for frontend work: loading, empty, error, and success states are all described
7. **Testable acceptance criteria** — each AC maps to a specific, automatable assertion (not vague outcomes like "works correctly" or "displays properly")
8. **Data flow** — how data moves from trigger → backend → persistence → response → UI update

### Assessment

For each story, mark it:
- **SPEC_COMPLETE** — passes ALL 8 checks (rare — most stories won't)
- **SPEC_INCOMPLETE** — fails any check

**If ALL stories are SPEC_COMPLETE:** skip to 1f (present batch).

**If ANY story is SPEC_INCOMPLETE:** enter plan mode and interview the operator.

### Interview Protocol

1. **Enter plan mode** (`EnterPlanMode`)
2. For each incomplete story, present:
   - The story title and current description
   - Which checklist items are missing (be specific)
   - Targeted questions to fill the gaps — ask about behavior, not implementation
3. **Interview one story at a time.** Finish one before starting the next.
4. Ask focused questions — don't dump all gaps at once. Group related gaps into 2-3 questions per round.
5. After each answer, update your understanding and ask follow-up questions until all 8 checklist items are satisfied.
6. When a story's spec is complete, **immediately write the enriched spec** to `planning-artifacts/specs/ROK-XXX.md` using this format:

```markdown
# ROK-XXX: <title>

## Original Description
<paste from Linear>

## Enriched Spec (from operator interview)

### Files Affected
| File | Change Type | Description |
|------|------------|-------------|
| `path/to/file` | modify/create | what changes |

### Contract Changes
<before/after shapes, or "none">

### DB Changes
<columns, types, migration details, or "none">

### API Changes
<endpoints, shapes, errors, or "none">

### UI States
<loading/empty/error/success, or "N/A">

### Edge Cases & Error Handling
- <case 1>
- <case 2>

### Data Flow
<trigger → backend → persistence → response → UI>

### Acceptance Criteria (Testable)
- [ ] <specific, automatable assertion>
- [ ] <specific, automatable assertion>
```

7. **Update `build-state.yaml`** after each story is spec'd — set `requirements_gathered: true` and `spec_file: "planning-artifacts/specs/ROK-XXX.md"` on that story. This is critical for recovery.
8. After ALL stories are spec'd, **exit plan mode** (`ExitPlanMode`) and continue to 1f.

### Context Survival

If the operator needs to "clear context and build" mid-interview:
- The state file tracks which stories have `requirements_gathered: true`
- Enriched specs are on disk in `planning-artifacts/specs/`
- On resume (step 1b), stories with `requirements_gathered: true` skip the interview
- Stories without it re-enter the interview from scratch (the state file knows which ones)

---

## 1f. Present Batch to Operator

Present a summary table:

```
## Build Batch <N>

| # | Story | Scope | Planner | Architect | Notes |
|---|-------|-------|---------|-----------|-------|
| 1 | ROK-XXX: Title | standard | no | no | Single module |
| 2 | ROK-YYY: Title | full | yes | yes | Contract changes |

Serialization: ROK-YYY must complete before batch 2 (contract changes).
Estimated agents: 2 dev (opus) + 2 test (sonnet) + 2 reviewer (sonnet)
```

**Wait for operator approval.** If the operator approves during this discussion (e.g., "go", "let's do it", "sounds good"), that IS the confirmation — do not re-ask.

---

## 1g. Initialize State File

**Note:** The state file will be written to the worktree AFTER it's created in Step 2a. Prepare the state content now, write it after worktree creation.

State file path: `<worktree>/build-state.yaml` (e.g., `../Raid-Ledger--rok-XXX/build-state.yaml`):

```yaml
pipeline:
  current_step: "implement"
  batch: 1
  next_action: |
    Read steps/step-2-implement.md. Create worktrees and spawn dev subagents.
  stories:
    ROK-XXX:
      title: "Story title"
      linear_id: "<uuid from Linear>"
      scope: standard
      status: "queued"
      branch: "rok-xxx-short-name"
      worktree: "../Raid-Ledger--rok-xxx"
      needs_planner: false
      needs_architect: false
      requirements_gathered: true  # false if interview was interrupted
      spec_file: "planning-artifacts/specs/ROK-XXX.md"  # null if spec was already complete
      gates:
        dev: PENDING
        test_agent: PENDING
        ci: PENDING
        operator: PENDING
        reviewer: PENDING
        architect_final: PENDING
        smoke_test: PENDING
      next_action: "Queued. Waiting for worktree creation in Step 2."
      agent_history: []
```

---

## 1h. Update Linear to "In Progress"

**MANDATORY — do this NOW before proceeding to Step 2.**

Move every story in the batch to "In Progress":

```
mcp__linear__save_issue({
  issueId: "<linear_id>",
  statusName: "In Progress"
})
```

This ensures Linear reflects that work has started as soon as the batch is confirmed, not after CI/deploy in Step 3.

Proceed to **Step 2**.
