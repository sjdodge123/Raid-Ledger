# Step 5: Parallel Dispatch (Agent Teams)

Process stories in the confirmed batch order. For each batch:

**All Linear updates in this step route through the Sprint Planner with `QUEUE_UPDATE: { priority: "immediate" }`. The lead does NOT call `mcp__linear__*` tools directly.**

---

## 5a. Create Agent Team

```
TeamCreate(team_name: "dispatch-batch-N")
```

Create tasks in the shared task list:
- One **implementation task** per story (assigned to dev teammates)
- One **review task** per story (blocked by implementation — review agents spawn per-story after operator approval)

## 5b. Spawn Build Agent (FIRST — needed for worktree setup)

Spawn one build/deploy teammate for the batch using `templates/build-agent.md`:
```
Task(subagent_type: "general-purpose", team_name: "dispatch-batch-N",
     name: "build-agent", model: "sonnet", mode: "bypassPermissions",
     prompt: <read and fill templates/build-agent.md>)
```

The build agent stays alive for the entire batch. It handles:
- Worktree creation and setup (Task 0)
- Local CI validation (build/lint/test) in feature worktrees
- Pushing branches to remote
- Deploying feature branches locally for operator testing
- Health verification after deploys

## 5c. Setup Worktrees (delegate to Build Agent)

**The lead does NOT manually create worktrees, run `npm install`, or build contract.** Delegate to the build agent:

For each story in the batch:
```
SendMessage(type: "message", recipient: "build-agent",
  content: "Setup worktree ROK-<num> on branch rok-<num>-<short-name>",
  summary: "Setup worktree ROK-<num>")
```

The build agent will: create worktree -> npm install -> build contract -> copy .env -> build API + web (viability check) -> message back with results.

**If setup fails:** The build agent messages back with exact errors. The lead flags to the operator — do NOT waste tokens spawning a dev agent for a broken worktree.

**If setup succeeds:** The worktree is ready for dev at `../Raid-Ledger--rok-<num>`.

## 5d. Spawn Advisory Agents (per-batch)

While waiting for worktree setup, spawn Architect, Product Manager, and Test Engineer. Read their templates:
- `templates/architect.md`
- `templates/pm.md`
- `templates/test-engineer.md`

These agents persist for the batch lifetime and are consulted at various gates.

## 5e. Spawn Dev Teammates (after worktrees are ready)

Spawn one dev teammate per story using the appropriate template from `templates/`:
- **Rework stories** -> use `templates/dev-rework.md`
- **New work** -> use `templates/dev-new-ready.md`

**Update Linear to "In Progress" via Sprint Planner (MANDATORY):**

```
SendMessage(type: "message", recipient: "sprint-planner",
  content: "QUEUE_UPDATE: { action: 'update_status', issue: 'ROK-XXX', state: 'In Progress', priority: 'immediate' }",
  summary: "Set ROK-XXX to In Progress")
```

Repeat for each story being dispatched.

```
Task(subagent_type: "general-purpose", team_name: "dispatch-batch-N",
     name: "dev-rok-<num>", mode: "bypassPermissions",
     prompt: <read and fill the appropriate template>)
```

## 5f. Review Agents — DO NOT SPAWN YET

**Do NOT spawn review agents at dispatch time.** Review agents are spawned per-story
after the operator moves each story to "Code Review" status in Linear. Each review agent
operates in that story's worktree and can auto-fix critical issues directly.

**When to spawn:** In Step 7c, when a story is moved to "Code Review" by the operator.

## 5g. Lead Enters Delegate Mode

After spawning all teammates, the lead:
1. Tells the operator which stories are running and in which worktrees
2. Remains available to answer teammate questions (via SendMessage)
3. Monitors teammate progress via task list and messages
4. Does NOT block on TaskOutput — stay responsive to the operator
