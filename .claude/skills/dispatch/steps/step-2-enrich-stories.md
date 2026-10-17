# Step 2: Enrich Stories & Orchestrator Profiles

**Data source:** Sprint Planner cache (`planning-artifacts/sprint-status.yaml`) and Sprint Planner agent for comments. The lead does NOT call `mcp__linear__*` tools directly.

---

## 2a. Enrich Story Data

### For Rework stories (Changes Requested):

Request comments from the Sprint Planner:

```
SendMessage(type: "message", recipient: "sprint-planner",
  content: "READ_CACHE: { filter: 'comments for ROK-XXX' }. If comments are not in cache, fetch them from Linear and update the cache.",
  summary: "Get review comments for ROK-XXX")
```

Identify **review feedback** — comments posted AFTER the most recent agent summary comment (agent summaries contain "## Implementation Summary" or "## Review Feedback Addressed" or "Commit:" patterns).

If there are screenshots in feedback comments (markdown image links), describe what the reviewer is pointing out based on surrounding text.

### For New Work stories (Dispatch Ready):

The cache already has descriptions from the sync-down. Read directly from `planning-artifacts/sprint-status.yaml`. Extract:
- Title and priority
- Acceptance criteria count
- Key files mentioned in technical approach (if any)
- Dependencies on other stories (if mentioned)

---

## 2b. Spawn Orchestrator & Get Story Profiles

Read `templates/orchestrator.md` and spawn the Orchestrator agent:

```
Task(subagent_type: "general-purpose", team_name: "dispatch-core",
     name: "orchestrator", model: "sonnet", mode: "bypassPermissions",
     prompt: <read and fill templates/orchestrator.md>)
```

Send the enriched story data to the Orchestrator for profiling:

```
SendMessage(type: "message", recipient: "orchestrator",
  content: "PROFILE: <enriched story data for all stories in the batch>",
  summary: "Profile stories for dispatch")
```

The Orchestrator will return story profiles with:
- **Scope** (light / standard / full)
- **Testing level** (light / standard / full)
- **needs_architect** flag
- **Playwright required** flag
- **File overlap analysis** (for parallelism decisions)
- **Batch grouping recommendation**

Wait for the Orchestrator's profiles before proceeding to Step 3.

---

## Rules

- All story data comes from the Sprint Planner cache or via Sprint Planner messages
- The Orchestrator profiles stories — the lead does NOT make scope/testing decisions independently
- The Scrum Master should be informed of the Orchestrator's batch recommendation for validation
