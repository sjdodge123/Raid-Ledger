---
name: linear
description: Sync Linear with the work the agent has done or is about to do — update the active story, capture surfaced tech debt as new stories, link dependencies (blocks / blocked-by / related-to), and reconcile spec drift. Operator-invoked, multi-step.
disable-model-invocation: true
allowed-tools: "Bash(git*), Read, Grep, Glob"
---

# /linear — Keep Linear in Sync

Operator-invoked. When the operator types `/linear`, run the full Linear-sync pipeline below so the active story (and anything it depends on) reflects reality.

The goal: Linear should never be more than one prompt out of date. The operator should be able to walk away and come back, read the active story, and know exactly where things stand without asking.

## Inputs (auto-detect, do not ask)

1. **Active story ID** — derive from, in order:
   - `task.md` at repo root (if present, parse the `ROK-XXX` from the header)
   - Current branch name (`sjdodge/rok-XXXX-...` → `ROK-XXXX`)
   - Most recent commits on the branch (`git log --oneline origin/main..HEAD` for `ROK-XXXX` references)
   - If still ambiguous, ask the operator which story.

2. **Work-in-flight signal** — gather:
   - `git diff origin/main...HEAD` (committed changes on this branch)
   - `git status` (uncommitted changes)
   - Any `planning-artifacts/specs/ROK-XXX.md` or `planning-artifacts/review-ROK-XXX.md` updates
   - Recent conversation context — what was just finished or is imminent

3. **Surfaced tech debt** — anything in the conversation flagged as "we should clean this up later", "TODO", "this is a workaround", reviewer findings not in scope, etc.

4. **New dependencies surfaced** — anything in the conversation indicating "this is blocked by X", "we need Y first", "this depends on Z being merged".

## Steps

### Step 1 — Locate and read the active story

```
mcp__linear__get_issue { id: "ROK-XXXX" }
```

Read its current description, AC, status, labels, blockedBy / blocks / relatedTo.

### Step 2 — Reconcile description with reality

Compare the current Linear description against what was actually built (or what's about to be built). Common drifts to fix:

- **Deferrals** — items in the original AC that were deferred to a follow-up. Strike them through and add a "Deferred to ROK-YYY" line, OR move them to a new story.
- **Replaced components** — if the implementation chose a different component / library / pattern than the original spec, update the description so reviewers measure against current reality.
- **Added scope** — anything found necessary mid-implementation that wasn't in the original AC. Add to the AC list.
- **Changed semantics** — if a contract field, endpoint, or behavior diverged from the original spec, update the relevant section.

If the changes are non-trivial, use `mcp__linear__save_issue { id, description }` to update.

### Step 3 — Capture surfaced tech debt as new stories

For each piece of tech debt surfaced in the conversation that is NOT in scope of the current story:

1. Verify it isn't already tracked: `mcp__linear__list_issues { query: "<short keywords>", project: "Raid Ledger" }`.
2. If not tracked, create a new story:

```
mcp__linear__save_issue {
  team: "Roknua's projects",
  project: "Raid Ledger",
  title: "tech-debt: <concise>",          // or fix:, chore:, perf:
  labels: ["Tech Debt", "<Area>"],         // pick the correct area label
  priority: 3,                              // medium by default
  description: "<what / why / pointers to file:line / any AC>",
  relatedTo: ["ROK-XXXX"],                  // link back to the story that surfaced it
}
```

3. Apply Linear story conventions from MEMORY.md:
   - Title prefix: `feat:` / `fix:` / `tech-debt:` / `chore:` / `perf:` / `spike:`
   - One area label (no `Area:` prefix — labels are bare names)
   - Always project = "Raid Ledger", team = "Roknua's projects"
4. Investigate before creating — verify the file paths and behavior referenced are real (`feedback_investigate_before_stories`).

### Step 4 — Map dependencies

For each dependency relationship surfaced:

- **This story is blocked by another** → `mcp__linear__save_issue { id: "ROK-XXXX", blockedBy: ["ROK-YYYY"] }`
- **This story blocks another** → `mcp__linear__save_issue { id: "ROK-XXXX", blocks: ["ROK-ZZZZ"] }`
- **Related (informational only)** → `mcp__linear__save_issue { id: "ROK-XXXX", relatedTo: ["ROK-WWWW"] }`

Note: blockedBy / blocks / relatedTo on `save_issue` are **append-only**. To remove, use `removeBlockedBy` / `removeBlocks` / `removeRelatedTo`.

If the operator mentions a new dependency that isn't yet a Linear story, create it first via Step 3, then link.

### Step 5 — Comment with a progress summary

Add a comment to the active story summarizing what was just done and what's next:

```
mcp__linear__save_comment {
  issue: "ROK-XXXX",
  body: "<short markdown summary>"
}
```

Template:

```markdown
**Progress (YYYY-MM-DD)**

Done:
- <bullet> (<file:line> if relevant)
- <bullet>

In flight:
- <bullet>

Next:
- <bullet>

Surfaced:
- ROK-NNNN — <new tech-debt / dependency / follow-up>
```

Skip the comment if nothing material happened since the last sync.

### Step 6 — Status transition (if appropriate)

Only transition status when there's clear evidence:

- Backlog → In Progress: at least one commit on the branch referencing the story
- In Progress → In Review: PR is open and not draft
- In Review → Done: PR is merged

Do NOT auto-promote to Done speculatively. If unsure, ask the operator.

```
mcp__linear__save_issue { id: "ROK-XXXX", state: "In Progress" }
```

### Step 7 — Report back

Return a concise summary to the operator:

- Active story: ROK-XXXX (status, title)
- Description updates: <what changed, or "no change needed">
- New stories created: ROK-YYYY (tech-debt: ...), ROK-ZZZZ (...)
- Dependencies linked: blocks / blockedBy / relatedTo
- Comment added: yes/no
- Status transition: <from → to, or "no change">

## Rules

- **Always investigate before creating new stories** (`feedback_investigate_before_stories`) — verify the file paths and code referenced before writing speculative AC.
- **Never close stories**. Only the operator (or a merged PR) closes work.
- **Never delete stories** the operator created. If something is genuinely a dupe, mark `duplicateOf` instead.
- **Append-only relations**: don't try to "set" the blocked-by list — use `blockedBy` to add and `removeBlockedBy` to remove.
- **One story per concern**: if the conversation surfaced 3 unrelated cleanups, file 3 stories, not one mega-story.
- **Stay terse in descriptions** — link to commits / file paths rather than re-explaining what the code does.
- This skill is **operator-invoked only**. Do not auto-run it inside `/build`, `/dispatch`, or `/bulk` pipelines — those have their own Linear sync steps.

## Edge cases

- **Branch isn't tied to a story** (e.g. `batch/2026-04-22`): find every `ROK-XXX` mentioned in the commits since `origin/main`, then ask the operator which one to sync.
- **Story is already Done in Linear** but operator wants more work logged: add a comment, propose creating a follow-up story instead of reopening.
- **No active story at all** (exploratory work): offer to create one (`feat:` / `spike:`) so the work has a home.
- **Multiple stories touched in one branch**: sync each one in turn, with shared dependency links between them.
