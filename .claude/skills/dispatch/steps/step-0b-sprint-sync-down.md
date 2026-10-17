# Step 0b: Sprint Planner Sync-Down

**After janitor cleanup completes in Step 0, sync Linear data into the local cache.**

---

## Spawn Sprint Planner

The sprint planner is a long-lived agent that owns all Linear I/O for the entire dispatch.

```
Task(subagent_type: "general-purpose", team_name: "dispatch-core",
     name: "sprint-planner", model: "sonnet", mode: "bypassPermissions",
     prompt: <read and fill templates/sprint-planner.md>)
```

## Trigger Sync-Down

Message the sprint planner to pull all relevant stories from Linear:

```
SendMessage(type: "message", recipient: "sprint-planner",
  content: "SYNC_DOWN: { project: 'Raid Ledger' }",
  summary: "Sync Linear → local cache")
```

The sprint planner will:
1. Fetch all non-terminal stories from Linear (Dispatch Ready, In Progress, In Review, Code Review, Changes Requested)
2. Cross-reference with recently merged GitHub PRs
3. Write everything to `planning-artifacts/sprint-status.yaml`
4. Report back with a summary of what was found

## Wait for Sync Completion

Wait for the sprint planner to confirm the sync is complete. The local cache (`planning-artifacts/sprint-status.yaml`) is now the source of truth for Steps 1 and 2.

## Janitor Linear Updates

If the janitor reported stories that need Linear status updates (e.g., PR merged but Linear still shows "In Review"):

```
SendMessage(type: "message", recipient: "sprint-planner",
  content: "QUEUE_UPDATE: { action: 'update_status', issue: 'ROK-XXX', state: 'Done', priority: 'immediate' }",
  summary: "Fix stale Linear status for ROK-XXX")
```

Repeat for each story the janitor flagged.

## Proceed

Once sync-down is complete and any janitor-flagged updates are processed, proceed to **Step 1**.

The sprint planner stays alive — it will serve cache reads in Step 1, handle comments in Step 2, and process all Linear updates throughout the dispatch.
