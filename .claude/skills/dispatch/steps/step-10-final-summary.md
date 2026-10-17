# Step 10: Final Summary

After ALL batches have completed:

## 10a. Sprint Planner Sync-Up

See **`steps/step-10b-sprint-sync-up.md`** for full instructions. The sprint planner flushes all deferred Linear updates (comments, tech-debt stories, Done transitions).

## 10b. Retrospective Analyst

Spawn the retrospective analyst to analyze this dispatch run and suggest improvements:

```
Task(subagent_type: "general-purpose", team_name: "dispatch-batch-N",
     name: "retrospective-analyst", model: "sonnet", mode: "bypassPermissions",
     prompt: <read and fill templates/retrospective-analyst.md — include:
       - Stories processed with profiles
       - Agent spawn counts per story
       - All failures and re-spawns that occurred
       - Scrum master cost report
       - Any operator friction points>)
```

Wait for the retrospective analyst to produce its report. The report will be saved to `planning-artifacts/retrospectives/` and included in the final summary.

## 10c. Shut Down Long-Lived Agents

After sprint planner sync-up and retrospective are complete:

```
SendMessage(type: "shutdown_request", recipient: "sprint-planner")
SendMessage(type: "shutdown_request", recipient: "orchestrator")
SendMessage(type: "shutdown_request", recipient: "scrum-master")
```

Then delete the team:
```
TeamDelete(team_name: "dispatch-batch-N")
```

## 10d. Present Final Summary

```
## Dispatch Complete — N stories across M batches

| Batch | Story | Dev Agent | PR | Review | Status |
|-------|-------|-----------|-----|--------|--------|
| 1 | ROK-XXX | dev-rok-xxx | #1 | approved | Done |
| 1 | ROK-YYY | dev-rok-yyy | #2 | approved | Done |
| 2 | ROK-ZZZ | dev-rok-zzz | #3 | approved | Done |

All PRs auto-merged to main.
Run `deploy_dev.sh --rebuild` to test all changes on main.

### Sprint Planner Summary
- Linear updates flushed: N deferred items (M comments, K tech-debt stories, J Done transitions)

### Scrum Master Cost Report
<cost report from scrum master — agent spawns, estimated token usage, anomalies>

### Retrospective Highlights
<critical/high recommendations from retrospective analyst>
See full report: `planning-artifacts/retrospectives/batch-N-retrospective.md`

### Doc Updates This Dispatch
- Architect updated `planning-artifacts/architecture.md`: <summary>
- PM updated `planning-artifacts/prd.md`: <summary>
- Test Engineer updated `TESTING.md`: <summary>
```
