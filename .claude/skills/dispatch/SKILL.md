---
name: dispatch
description: "Resolve in-flight work, pull ready stories from Linear, spawn parallel dev agents via Agent Teams"
argument-hint: "[ROK-XXX | rework | todo | all]"
---

# Dispatch — Parallel Agent Teams Orchestrator

Checks for in-flight work first (and finishes it), then pulls dispatchable stories from Linear, presents everything for user approval, and spawns implementation agents **in parallel via Agent Teams and git worktrees**. Handles both **new work** (Dispatch Ready) and **rework** (Changes Requested).

**Linear Project:** Raid Ledger (ID: `1bc39f98-abaa-4d85-912f-ba62c8da1532`)
**Team:** Roknua's projects (ID: `0728c19f-5268-4e16-aa45-c944349ce386`)

---

## How to Execute This Skill

Each step has detailed instructions in a separate file under `steps/`. **Read each step file when you reach that step** — do NOT read all steps upfront.

The dispatch flow is: clean up workspace -> check in-flight work -> finish it -> gather new stories -> present batch -> create worktrees -> spawn parallel team -> operator tests -> review agents -> merge to main.

### ⛔ MANDATORY Pipeline Order (DO NOT SKIP GATES)

```
Dev completes → Test agent → CI passes → Push branch → Deploy locally
  → QA agent generates test cases (posts to Linear)
  → ⛔ Playwright gate — uses QA test cases (if UI changes) ⛔
    → FAIL: send back to dev → loop until passing
    → PASS (or skip for non-UI): Linear "In Review"
  → ⛔ STOP — WAIT for operator to test and update Linear ⛔
  → Operator moves to "Code Review" (approved) or "Changes Requested" (rework)
  → Code review agent reviews diff
  → ⛔ ONLY AFTER reviewer approves → Push reviewer fixes → Create PR → Auto-merge
  → Linear "Done"
```

**Three gates before a PR is created:**
1. **Playwright gate** — automated browser tests must pass before operator sees the story
2. **Operator gate** — operator must manually test and approve in Linear
3. **Code review gate** — reviewer must approve the diff

PRs are NEVER created until AFTER all three gates pass (Step 8).
Creating a PR with auto-merge before review causes unreviewed code to ship to main.
"In Review" = Playwright passed, branch pushed, awaiting operator — it does NOT mean a PR exists.

---

## Parallel Execution via Agent Teams

Dev agents run **in parallel**, each in its own git worktree (sibling directory).

```
Lead (main worktree — orchestrates, creates batch PR, syncs Linear)
  |- Dev Teammate 1 (worktree ../Raid-Ledger--rok-XXX)
  |- Dev Teammate 2 (worktree ../Raid-Ledger--rok-YYY)
  |- Build Teammate (main worktree — CI validation, push, deploys)
  +- Review Agent (per-story, in story worktree — code-reviews, auto-fixes)
```

**Concurrency limit:** Max 2-3 dev teammates per batch.

**Can run in parallel:** Stories with no file overlap, review agents (one per story worktree).

**Must be serialized (separate batches):** Stories modifying `packages/contract/`, stories generating DB migrations, stories touching the same files.

---

## Steps

Execute steps in order. Read each step's file when you reach it.

| Step | File | Description |
|------|------|-------------|
| 0 | `steps/step-0-workspace-cleanup.md` | Clean up stale worktrees, merged branches, and team artifacts |
| 1 | `steps/step-1-gather-stories.md` | Check in-flight work (finish first), then gather new stories |
| 2 | `steps/step-2-enrich-stories.md` | Fetch comments/feedback for rework; extract spec details for new work |
| 3 | `steps/step-3-present-dispatch.md` | Present dispatch summary, assign parallel batches |
| 4 | `steps/step-4-confirm-dispatch.md` | Get user approval to dispatch |
| 5 | `steps/step-5-parallel-dispatch.md` | Create worktrees, spawn dev + build teammates |
| 6 | `steps/step-6-dev-test-pipeline.md` | Event-driven: test agents, CI, push, Playwright gate, then "In Review" |
| 7 | `steps/step-7-review-pipeline.md` | Poll Linear for operator results, handle changes/approvals |
| 8 | `steps/step-8-review-outcomes.md` | Handle review outcomes; queue approved stories; batch or individual PRs |
| 9 | `steps/step-9-batch-completion.md` | Shut down teammates, clean up, present next batch |
| 10 | `steps/step-10-final-summary.md` | Final dispatch summary after all batches |

---

## Agent Prompt Templates

All agent prompt templates are in the `templates/` directory. Read the appropriate template when spawning each agent type:

| Agent | Template | When to Spawn |
|-------|----------|---------------|
| Dev (rework) | `templates/dev-rework.md` | Step 5c — for Changes Requested stories |
| Dev (new) | `templates/dev-new-ready.md` | Step 5c — for Dispatch Ready stories |
| Build agent | `templates/build-agent.md` | Step 5d — one per batch |
| Test agent | `templates/test-agent.md` | Step 6a — after dev completes |
| QA test cases | `templates/qa-test-cases.md` | Step 6d — blocking, generates test plan for Playwright |
| Playwright tester | `templates/playwright-tester.md` | Step 6d — Playwright gate (blocking, per-story, before "In Review") |
| Reviewer | `templates/reviewer.md` | Step 7c — after operator approves |
