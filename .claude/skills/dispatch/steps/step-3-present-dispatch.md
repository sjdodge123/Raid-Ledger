# Step 3: Present Dispatch Summary

Present the Orchestrator's batch plan and story profiles to the operator for approval.

**Data sources:** Orchestrator profiles (from Step 2b) + Sprint Planner cache. The lead does NOT make independent scope or batching decisions.

---

## Dispatch Summary

Present each story with the **Orchestrator's profile** so the operator can see scope, testing level, and gate decisions:

```
## Dispatch Plan — N stories (X rework, Y new)

### Story Profiles (from Orchestrator)

| Story | Title | Scope | Testing | Playwright | Architect | Key Files |
|-------|-------|-------|---------|------------|-----------|-----------|
| ROK-XXX | <title> | full | standard | yes | yes | <files> |
| ROK-YYY | <title> | light | light | no (API-only) | no | <files> |

### Rework (Changes Requested)
| Story | Title | Feedback Summary |
|-------|-------|-----------------|
| ROK-XXX | <title> | <1-2 line summary> |

### New Work (Dispatch Ready)
| Story | Pri | Title |
|-------|-----|-------|
| ROK-XXX | P1 | <title> |
```

## Parallel Batch Assignment

Present the **Orchestrator's batch grouping** (not the lead's):

```
=== Parallel Batches (Orchestrator recommendation) ===
Batch 1 (parallel):
  ROK-XXX (full, rework) — [events]
  ROK-YYY (light, new) — [theme]
  No file overlap — safe to parallelize

Batch 2 (after batch 1):
  ROK-ZZZ (full, new) — [events, db-schema] — needs migration, serialized
```

## Scrum Master Review

Before presenting to the operator, send the batch plan to the Scrum Master for process review:

```
SendMessage(type: "message", recipient: "scrum-master",
  content: "REVIEW_BATCH: Orchestrator recommends <batch plan summary>. Any process concerns before presenting to operator?",
  summary: "Scrum Master batch review")
```

The Scrum Master will flag issues like:
- Stories that should be serialized due to shared dependencies
- Profile decisions that conflict with SKILL.md gate requirements
- Concurrency limit violations (max 2-3 dev agents)

Present the batch plan (with any Scrum Master adjustments) to the operator.
