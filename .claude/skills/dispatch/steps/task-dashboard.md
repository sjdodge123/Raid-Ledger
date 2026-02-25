# Task Dashboard — Operator Visibility

The lead uses `TaskCreate` and `TaskUpdate` to maintain a live task dashboard so the operator can see at a glance where each story is in the pipeline. Tasks appear in the Claude Code UI with spinners showing current activity.

## Design Principles

1. **One task per story** — created at Step 5d when the dev agent spawns
2. **Updated at every gate transition** — the `activeForm` spinner reflects the current gate
3. **Completed when PR merges** — task marked `completed` at Step 8b
4. **Never deleted** — completed tasks stay visible as a record of the batch

## Task Schema

```
TaskCreate(
  subject: "ROK-XXX: <story title>",
  description: "Pipeline: dev → test → test-eng → quality → CI → deploy → QA → playwright → UX → In Review → code review → smoke test → PR",
  activeForm: "Implementing ROK-XXX"
)
```

Store the returned `taskId` — you'll need it for all subsequent updates.

**Metadata:** Track the story's orchestrator profile for reference:
```json
{
  "story": "ROK-XXX",
  "branch": "rok-<num>-<short-name>",
  "worktree": "../Raid-Ledger--rok-<num>",
  "testing_level": "standard",
  "batch": 1
}
```

## Gate Transition Table

Update the task at each transition. Use `TaskUpdate` with the new `activeForm` and optionally update the `subject` to include a progress indicator.

| Gate / Event | activeForm | Notes |
|---|---|---|
| Dev agent spawned (Step 5d) | `Implementing ROK-XXX` | Task created here |
| Dev completes → test agent (Step 6a) | `Writing tests for ROK-XXX` | |
| Test agent completes → test engineer (Step 6a.5) | `Test engineer reviewing ROK-XXX` | |
| Test engineer NEEDS_IMPROVEMENT (Step 6a.5) | `Re-writing tests for ROK-XXX (iteration N)` | |
| Test engineer APPROVED → quality checker (Step 6a.6) | `Quality checking ROK-XXX` | Skip for light |
| Quality checker NEEDS_WORK (Step 6a.6) | `Reworking ROK-XXX (quality feedback)` | Re-spawn dev |
| Quality checker READY → CI (Step 6b) | `Building & pushing ROK-XXX` | |
| CI passed → deploy (Step 6c) | `Deploying ROK-XXX locally` | |
| Deploy done → QA test cases (Step 6d) | `Generating QA test cases for ROK-XXX` | |
| QA done → Playwright (Step 6e) | `Playwright testing ROK-XXX` | Skip if no UI |
| Playwright FAIL → rework (Step 6e) | `Fixing Playwright failures for ROK-XXX` | Re-spawn dev |
| Playwright PASS → UX review (Step 6e.5) | `UX reviewing ROK-XXX` | Skip if no mockups |
| UX deviations → fix (Step 6e.5) | `Fixing UX deviations for ROK-XXX` | |
| All gates pass → In Review (Step 6g) | `Awaiting operator testing — ROK-XXX` | |
| Operator: Changes Requested (Step 7b) | `Applying operator feedback — ROK-XXX` | Minor or major |
| Minor fix applied → re-deploy (Step 7b) | `Re-deploying ROK-XXX after fix` | |
| Major fix → full pipeline (Step 7b) | `Reworking ROK-XXX (operator feedback)` | |
| Operator: Code Review (Step 7c) | `Code reviewing ROK-XXX` | |
| Reviewer APPROVED → architect check (Step 8a) | `Architect final check — ROK-XXX` | If needs_architect |
| Reviewer APPROVED → smoke test (Step 8a.7) | `Smoke testing ROK-XXX` | |
| Smoke test FAIL (Step 8a.7) | `Fixing regressions for ROK-XXX` | |
| Smoke test PASS → PR (Step 8b) | `Creating PR for ROK-XXX` | |
| PR merged (Step 8b) | — | Mark `completed` |

## Example Usage in Steps

**Step 5d — Create task when dev agent spawns:**
```
taskId = TaskCreate(
  subject: "ROK-125: Mobile Responsive Heatmap",
  description: "Pipeline: dev → test → test-eng → quality → CI → deploy → playwright → In Review → code review → smoke → PR\nBranch: rok-125-mobile-responsive-heatmap\nTesting level: standard",
  activeForm: "Implementing ROK-125",
  metadata: { story: "ROK-125", branch: "rok-125-mobile-responsive-heatmap", testing_level: "standard", batch: "1" }
)
```

**Step 6a — Dev completes, test agent spawned:**
```
TaskUpdate(taskId: "<id>", activeForm: "Writing tests for ROK-125")
```

**Step 6g — All gates passed, In Review:**
```
TaskUpdate(taskId: "<id>", activeForm: "Awaiting operator testing — ROK-125")
```

**Step 8b — PR merged:**
```
TaskUpdate(taskId: "<id>", status: "completed", subject: "ROK-125: Mobile Responsive Heatmap — merged")
```

## Batch-Level Task (Optional)

At Step 5, create a batch overview task:
```
TaskCreate(
  subject: "Batch 1: N stories dispatched",
  description: "Stories: ROK-XXX, ROK-YYY\nStatus: in progress",
  activeForm: "Running dispatch batch 1"
)
```

Update at Step 9 when batch completes:
```
TaskUpdate(taskId: "<batch-id>", status: "completed", subject: "Batch 1: N stories merged")
```
