# Step 10b: Sprint Planner Sync-Up

**Before the final summary in Step 10, flush all deferred Linear updates.**

---

## Flush Deferred Updates

Message the sprint planner to process its entire deferred queue:

```
SendMessage(type: "message", recipient: "sprint-planner",
  content: "FLUSH_DEFERRED: Execute all queued deferred updates",
  summary: "Flush deferred Linear updates")
```

The sprint planner will:
1. Process all queued comments (implementation summaries, review notes)
2. Create all tech-debt issues (from reviewer reports)
3. Update any deferred status changes (e.g., stories moved to "Done")
4. Report: N comments created, M tech-debt issues created, K status updates

## Final Sync-Down

After flushing, do one last sync to ensure the local cache matches Linear:

```
SendMessage(type: "message", recipient: "sprint-planner",
  content: "SYNC_DOWN: { project: 'Raid Ledger' }",
  summary: "Final cache sync")
```

## Collect Stats

Ask the sprint planner for its dispatch-wide statistics:

```
SendMessage(type: "message", recipient: "sprint-planner",
  content: "STATUS: Final stats for dispatch summary",
  summary: "Get sprint planner stats")
```

Stats to collect:
- Total immediate updates executed
- Total deferred updates flushed
- Total polls executed
- Total cache reads served
- Any errors encountered

## Shutdown Long-Lived Agents

After collecting stats, shut down all remaining long-lived agents:

```
SendMessage(type: "shutdown_request", recipient: "sprint-planner")
SendMessage(type: "shutdown_request", recipient: "orchestrator")
SendMessage(type: "shutdown_request", recipient: "scrum-master")
```

## Proceed

Pass the sprint planner stats to **Step 10** for inclusion in the final summary.
