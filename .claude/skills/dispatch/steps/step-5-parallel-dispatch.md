# Step 5: Parallel Dispatch (Agent Teams)

Process stories in the confirmed batch order. For each batch:

**All Linear updates in this step route through the Sprint Planner with `QUEUE_UPDATE: { priority: "immediate" }`. The lead does NOT call `mcp__linear__*` tools directly.**

---

## 5a. Setup Infrastructure

1. **Create worktrees** for each story in the batch:
   ```bash
   git worktree add ../Raid-Ledger--rok-<num> -b rok-<num>-<short-name> main
   ```

2. **Install dependencies** in each worktree:
   ```bash
   cd ../Raid-Ledger--rok-<num> && npm install --legacy-peer-deps && npm run build -w packages/contract
   ```

## 5a.5. Viability Check (before spawning dev agents)

**For each story, verify the target components/modules actually exist in the codebase before spawning a dev agent.** This prevents wasted agent turns on stories that reference nonexistent code.

```bash
# Example checks — adapt to the story's targets:
ls ../Raid-Ledger--rok-<num>/web/src/components/<target-component>/
ls ../Raid-Ledger--rok-<num>/api/src/<target-module>/
```

If a story's target doesn't exist:
- **New feature:** Verify the parent directory and any consuming components exist
- **Bug fix / refactor:** Verify the file/component being fixed actually exists
- **If the target is completely absent (wrong path, renamed, deleted):** Flag to operator before spawning dev. Don't waste tokens on an impossible task.

---

## 5b. Create Agent Team

```
TeamCreate(team_name: "dispatch-batch-N")
```

Create tasks in the shared task list:
- One **implementation task** per story (assigned to dev teammates)
- One **review task** per story (blocked by implementation — review agents spawn per-story after operator approval)

## 5c. Spawn Advisory Agents (per-batch)

Spawn Architect, Product Manager, and Test Engineer for this batch. Read their templates:
- `templates/architect.md`
- `templates/pm.md`
- `templates/test-engineer.md`

These agents persist for the batch lifetime and are consulted at various gates.

## 5d. Spawn Dev Teammates

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

## 5e. Spawn Build Teammate

Spawn one build/deploy teammate for the batch using `templates/build-agent.md`:
```
Task(subagent_type: "general-purpose", team_name: "dispatch-batch-N",
     name: "build-agent", model: "sonnet", mode: "bypassPermissions",
     prompt: <read and fill templates/build-agent.md>)
```

The build agent stays alive for the entire batch. It handles:
- Local CI validation (build/lint/test) in feature worktrees
- Pushing branches to remote
- Deploying feature branches locally for operator testing
- Health verification after deploys

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
