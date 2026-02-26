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

The dispatch flow is: clean up workspace -> sprint sync -> check in-flight work -> finish it -> gather new stories -> orchestrator profiles -> present batch -> create worktrees -> spawn parallel team -> operator tests -> review agents -> smoke test -> merge to main.

### MANDATORY Pipeline Order (DO NOT SKIP GATES)

```
Dev completes → Test agent → Test Engineer review → Quality Checker gate
  → CI passes → Push branch → Deploy locally
  → QA agent generates test cases (posts to Linear via Sprint Planner)
  → Playwright gate (if UI changes)
  → UX Reviewer gate (if UI changes + mockups exist)
  → Linear "In Review" (via Sprint Planner)
  → STOP — WAIT for operator to test and update Linear
  → Commit operator testing changes (7a.5 — MANDATORY)
  → Operator moves to "Code Review" (approved) or "Changes Requested" (rework)
    → Minor rework: Co-Lead Dev quick fix → push → "In Review"
    → Major rework: Full dev re-spawn → full pipeline
  → Code review agent reviews diff
  → Architect final alignment check (SEQUENTIAL — if needs_architect)
  → Smoke Tester: broad regression tests (SEQUENTIAL — LAST GATE before PR)
  → ONLY AFTER all gates pass → Create PR → Auto-merge
  → Linear "Done" (via Sprint Planner, deferred)
```

**Eight gates before a PR is created:**
1. **Test Engineer gate** — test quality enforcement (BLOCKING for standard/full, advisory for light)
2. **Quality Checker gate** — ACs met, tests meaningful, code complete (skipped for light)
3. **Playwright gate** — automated browser tests (if UI changes)
4. **UX Reviewer gate** — visual design validation (if UI changes + mockups exist)
5. **Operator gate** — operator must manually test and approve in Linear
6. **Code review gate** — reviewer must approve the diff
7. **Architect gate** — final alignment check (SEQUENTIAL, if needs_architect)
8. **Smoke test gate** — broad regression tests (SEQUENTIAL, NEVER skipped, even for light)

**CRITICAL: Gates 7 and 8 are SEQUENTIAL. Architect must complete BEFORE smoke tester starts. Parallel execution caused missed issues in the trial run.**

PRs are NEVER created until AFTER all applicable gates pass (Step 8).
Creating a PR with auto-merge before review causes unreviewed code to ship to main.
"In Review" = Playwright passed, branch pushed, awaiting operator — it does NOT mean a PR exists.

**Auto-merge is the LAST action in the pipeline.** NEVER enable `gh pr merge --auto --squash` at PR creation. Create the PR first (no auto-merge) → complete all remaining gates → enable auto-merge as the final step only after everything passes. Auto-merge is a one-way door — once CI passes, it merges automatically and cannot be recalled.

---

## STOP Protocol

If the operator sends **STOP**, **PAUSE**, or **halt**: immediately cease ALL tool calls. Do not finish the current action chain. Do not run "one more" command. Send one acknowledgment message ("Stopped.") and wait for further instructions. No exceptions.

---

## Post-Compaction Startup Checklist

After any context compaction event, the lead MUST execute this checklist before taking ANY pipeline action:

1. **Verify Sprint Planner alive** — `SendMessage` ping, confirm it can read/write Linear
2. **Verify Orchestrator alive** — `SendMessage` ping, confirm it has pipeline state (reads `planning-artifacts/pipeline-state.yaml`)
3. **Verify Scrum Master alive** — `SendMessage` ping, send brief status update
3b. **Send Scrum Master catch-up checkpoint** — After confirming the Scrum Master is alive, send a `CATCH_UP_CHECKPOINT` summarizing ALL gates completed during the compacted window:
   ```
   SendMessage(type: "message", recipient: "scrum-master",
     content: "CATCH_UP_CHECKPOINT: Context was compacted. Summary of gates completed during compacted window:
     - ROK-XXX: [list each gate that passed with evidence]
     - ROK-YYY: [same]
     Update your pipeline state records accordingly.",
     summary: "Scrum Master catch-up after compaction")
   ```
   Construct this from: `planning-artifacts/pipeline-state.yaml`, `planning-artifacts/sprint-status.yaml`, and any gate messages visible in the current context. **Wait for Scrum Master acknowledgment before proceeding.**
4. **Read sprint-status.yaml** — get current story states from local cache (do NOT call Linear directly)
5. **Ask Orchestrator for STATUS** — get pipeline state for all stories
6. **Scrum Master validates** — Scrum Master confirms Orchestrator's state matches SKILL.md gate order before lead proceeds

If any advisory agent is dead, re-spawn it BEFORE proceeding. If the Orchestrator's `pipeline-state.yaml` is missing, re-establish state by sending current story statuses to the Orchestrator before requesting any WHATS_NEXT directions.

**The lead NEVER calls `mcp__linear__*` tools directly.** All Linear I/O routes through the Sprint Planner. If the Sprint Planner is unreachable, re-spawn it. If it cannot be re-spawned, ask the operator — do not self-route.

---

## Destructive Operations

The following operations require a **pre-execution checkpoint with the Scrum Master AND operator approval** before running:

- `deploy_dev.sh --fresh` (wipes DB volume)
- `git push --force` / `git reset --hard`
- `rm -rf` on any project directory
- DB volume deletes, table drops
- Any operation the lead is unsure about

Rule: If in doubt whether an operation is destructive, it is. Ask first.

---

## Three-Way Validation

For all pipeline decisions: **Orchestrator decides → Scrum Master validates against SKILL.md gate order → Lead executes.** When the Orchestrator's direction conflicts with the mandatory gate order above, SKILL.md is the law. The Scrum Master flags discrepancies before the lead acts.

---

## Dispatch Standing Rules (for all branch-touching agents)

These rules apply to ALL agents that work in worktrees (dev, co-lead dev, build agent, fix agents, reviewers). They are repeated in each agent template but the source of truth is here:

1. **NEVER enable auto-merge** (`gh pr merge --auto --squash`). Only the lead enables auto-merge as the LAST pipeline action after ALL gates pass.
2. **NEVER force-push** (`git push --force`, `git push --force-with-lease`). Only the lead force-pushes when necessary (e.g., after rebase), with Scrum Master checkpoint.
3. **NEVER create pull requests.** Only the lead creates PRs in Step 8b.
4. **NEVER call `mcp__linear__*` tools.** All Linear I/O routes through the Sprint Planner.
5. **NEVER run destructive operations** (`deploy_dev.sh --fresh`, `rm -rf`, `git reset --hard`, DB drops). Escalate to the lead.
6. **ALWAYS stay in your assigned worktree.** Do not `cd` to sibling worktrees or the main worktree.

---

## Step 3+4 Collapse Rule

If the operator explicitly approves a batch plan during Step 3 discussion (e.g., "let's go with that", "sounds good", "dispatch all"), skip the formal Step 4 confirmation prompt. Operator approval during discussion IS the confirmation. Do not re-ask.

---

## Team Agent Communication

Team agents (spawned via `Task` with `team_name`) communicate via the **mailbox system** (`SendMessage`). They are NOT background shell tasks.

**Rules:**
- **NEVER use `TaskOutput` to check on team agents.** `TaskOutput` is for background shell tasks (`run_in_background: true`). It will always return "No task found" for team agents.
- **NEVER poll with `sleep + stat`** to check if an agent has written a file. Team agents send a message when they're done — the system delivers it automatically.
- **Agent bootstrap takes 5-10+ turns.** Agents need to: load ToolSearch → find MCP tools → execute initial task → write files → send message. Don't expect instant results.
- **While waiting for agents to bootstrap, do useful parallel work:** read the next step file, check git worktree state, verify CI status on existing branches, review sprint-status.yaml cache. Do NOT wait idle.

---

## Git Pull Strategy

Always use `git pull --rebase origin/main` or `git rebase origin/main` instead of `git pull origin main`. After a squash-merge PR, local and remote have different commit hashes for the same changes, causing divergent branch errors with regular pull.

---

## Team Hierarchy

```
Lead (main worktree — lightweight bridge, relays between operator and orchestrator)
  ├── Scrum Master (long-lived — pipeline guardian, advises lead, tracks token costs)
  ├── Sprint Planner (long-lived — ALL Linear I/O, local cache)
  ├── Orchestrator (long-lived — story profiling, scope decisions, THE BRAIN)
  ├── Janitor (Step 0 + Step 9b — deep cleanup pre/post dispatch)
  ├── Architect (per-batch — infra alignment, approach/vision sign-off, doc maintenance)
  ├── Product Manager (per-batch — product validation, doc maintenance)
  ├── Test Engineer (per-batch — STRICT test quality enforcement, doc maintenance)
  ├── Planner (per-story, large only — pre-dev implementation plan)
  ├── Dev Teammate (per-story — implementation)
  ├── Co-Lead Dev (per-fix — quick changes from operator feedback)
  ├── Build Teammate (per-batch — CI/push/deploy)
  ├── Test Agent (per-story — writes unit tests)
  ├── Quality Checker (per-story — AC/test/code review before "In Review")
  ├── QA Agent (per-story — generates test cases)
  ├── Playwright Tester (per-story — browser testing gate)
  ├── UX Reviewer (per-story, UI only — validates against design mockups)
  ├── Reviewer (per-story — code review after operator approval)
  ├── Smoke Tester (per-story — regression tests before PR creation)
  └── Retrospective Analyst (per-dispatch — continuous improvement, suggests optimizations)
```

**Concurrency limit:** Max 2-3 dev teammates per batch.

**Can run in parallel:** Stories with no file overlap, review agents (one per story worktree).

**Must be serialized (separate batches):** Stories modifying `packages/contract/`, stories generating DB migrations, stories touching the same files.

**MUST be spawned (not optional):** Orchestrator (Step 2), Scrum Master (Step 0). These were missed in the trial run, causing process drift.

---

## Steps

Execute steps in order. Read each step's file when you reach it.

| Step | File | Description |
|------|------|-------------|
| 0 | `steps/step-0-workspace-cleanup.md` | Spawn janitor for deep cleanup, then spawn scrum master |
| 0b | `steps/step-0b-sprint-sync-down.md` | Spawn sprint planner, sync Linear → local cache |
| 1 | `steps/step-1-gather-stories.md` | Read from sprint planner cache; check in-flight work (finish first) |
| 2 | `steps/step-2-enrich-stories.md` | Enrich stories; then orchestrator produces story profiles (Step 2b) |
| 3 | `steps/step-3-present-dispatch.md` | Present dispatch summary with orchestrator profiles |
| 4 | `steps/step-4-confirm-dispatch.md` | Get user approval to dispatch |
| 5 | `steps/step-5-parallel-dispatch.md` | Viability check, spawn advisory agents, planner/architect gates, dev + build teammates |
| 6 | `steps/step-6-dev-test-pipeline.md` | Test engineer, quality checker, CI, Playwright, UX review gates |
| 7 | `steps/step-7-review-pipeline.md` | Commit operator changes (7a.5), sprint planner polls; minor (co-lead) vs major (dev) rework |
| 8 | `steps/step-8-review-outcomes.md` | Architect final check (SEQUENTIAL), smoke test gate (SEQUENTIAL), then batch PR creation |
| 9 | `steps/step-9-batch-completion.md` | Advisory agents update docs, shut down, janitor post-batch cleanup, cost report |
| 9b | `steps/step-9b-janitor-post-batch.md` | Janitor cleans worktrees + branches (local + remote, with PR merge verification) |
| 10 | `steps/step-10-final-summary.md` | Sprint planner sync-up (Step 10b), retrospective analyst, then enriched final summary |
| 10b | `steps/step-10b-sprint-sync-up.md` | Flush deferred Linear updates, shut down long-lived agents |

---

## Agent Prompt Templates

All agent prompt templates are in the `templates/` directory. Read the appropriate template when spawning each agent type:

| Agent | Template | When to Spawn | Model | Lifetime |
|-------|----------|---------------|-------|----------|
| Sprint Planner | `templates/sprint-planner.md` | Step 0b (sync-down) | sonnet | Full dispatch |
| Janitor | `templates/janitor.md` | Step 0 (pre-dispatch), Step 9b (post-batch) | sonnet | Step 0 + Step 9 |
| Orchestrator | `templates/orchestrator.md` | Step 2 (after enrichment) — **MUST spawn** | sonnet | Full dispatch |
| Scrum Master | `templates/scrum-master.md` | Step 0 (after janitor) — **MUST spawn** | sonnet | Full dispatch |
| Planner | `templates/planner.md` | Step 5b (large stories only) | sonnet | Per-story |
| Architect | `templates/architect.md` | Step 5a (batch start) | sonnet | Per-batch (until Step 9 docs) |
| Product Manager | `templates/pm.md` | Step 5a (batch start) | sonnet | Per-batch (until Step 9 docs) |
| Test Engineer | `templates/test-engineer.md` | Step 5a (batch start) | sonnet | Per-batch (until Step 9 docs) |
| Dev (rework) | `templates/dev-rework.md` | Step 5d — for Changes Requested stories | opus | Per-story |
| Dev (new) | `templates/dev-new-ready.md` | Step 5d — for Dispatch Ready stories | opus | Per-story |
| Co-Lead Dev | `templates/co-lead-dev.md` | Step 7b — minor operator fixes | opus | Per-fix |
| Build agent | `templates/build-agent.md` | Step 5d — one per batch | sonnet | Per-batch |
| Test agent | `templates/test-agent.md` | Step 6a — after dev completes | opus | Per-story |
| Quality Checker | `templates/quality-checker.md` | Step 6a.6 — after test engineer | sonnet | Per-story |
| QA test cases | `templates/qa-test-cases.md` | Step 6d — generates test plan for Playwright | sonnet | Per-story |
| Playwright tester | `templates/playwright-tester.md` | Step 6e — Playwright gate (before "In Review") | sonnet | Per-story |
| UX Reviewer | `templates/ux-reviewer.md` | Step 6e.5 — after Playwright (UI stories only) | sonnet | Per-story |
| Reviewer | `templates/reviewer.md` | Step 7c — after operator approves | opus | Per-story |
| Smoke Tester | `templates/smoke-tester.md` | Step 8a.4 — before PR (SEQUENTIAL, after architect) | sonnet | Per-story |
| Retrospective Analyst | `templates/retrospective-analyst.md` | Step 10b — end of dispatch | sonnet | Per-dispatch |
