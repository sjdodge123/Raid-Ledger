---
name: start
description: "Quick-start a story: fetch from Linear, ensure correct branch, set up task.md"
argument-hint: "ROK-XXX"
---

# Start — Story Bootstrap Workflow

**Goal:** Bootstrap a Linear story for development — verify environment, fetch the story, set up the right branch, and create a task.md checklist. Fully autonomous.

---

## Step 1: Extract Story ID

From `$ARGUMENTS`, extract the story identifier (e.g., `ROK-117`).

**If no story ID was provided:**
Ask: "Which story should I start? Please provide the ID (e.g., `ROK-117`)."

---

## Step 2: Environment Check

Read `.claude/settings.local.json` from the project root.

Verify it contains:
- A `permissions` object with an `allow` array
- Key permissions are present (Bash commands, git operations, MCP tools)

Briefly note the environment status (e.g., "Environment verified — X permissions configured").

**If the file does not exist or is malformed:** Warn but continue — do not block the workflow.

---

## Step 3: Fetch Story from Linear

Run:

```bash
python3 scripts/fetch_story.py <STORY_ID> --save
```

This saves the story spec to `implementation-artifacts/<STORY_ID>.md`.

**If the fetch fails:**
- Check if `LINEAR_API_KEY` is set
- Report the error to the user
- Do NOT proceed — this is a blocking failure

---

## Step 4: Read & Study Story

Read `implementation-artifacts/<STORY_ID>.md` and study:
- **Acceptance criteria** — what "done" looks like
- **Technical approach** — how the work should be implemented
- **Task list** — individual work items to complete
- **Dependencies or blockers** — anything that might affect execution

---

## Step 5: Check & Setup Branch

### 5a. Check Current Branch

```bash
git branch --show-current
```

If already on a matching branch (branch name contains the story ID in lowercase, e.g., `rok-117-*` matches `ROK-117`), **skip to Step 6**.

### 5b. Stash Uncommitted Changes (if any)

```bash
git status --porcelain
```

If there are uncommitted changes:

```bash
git stash push -m "pre-<STORY_ID>: stashed by /start workflow"
```

Note the stash in the final report.

### 5c. Check for Existing Remote Branch

```bash
git fetch origin && git branch -r | grep -i <story_id_lowercase>
```

### 5d. Check for Unmerged Dependency Branches (new stories only)

**Skip this substep** if a remote branch for this story already exists.

When creating a new branch, check for unmerged feature branches from the same epic:

```bash
git branch -r --no-merged origin/main | grep -v HEAD
```

**If unmerged branches exist,** present them to the user and ask:

> These branches have not been merged to main yet:
> - `origin/<branch-1>`
>
> Should this story branch from one of these instead of `main`?
> 1. Branch from `main` (default)
> 2. Branch from `<branch-name>` (includes unmerged changes)

### 5e. Create or Checkout Branch

- **If remote branch exists:** `git checkout <branch-name>`
- **If no branch exists:** Create from chosen base (default: latest `main`):

```bash
git checkout <base-branch> && git pull origin <base-branch> && git checkout -b <story_id_lowercase>-<short-description>
```

Branch naming: `<story-id>-<short-description>` (e.g., `rok-329-sticky-toolbars`).

**One branch per story** — never reuse branches across stories.

---

## Step 6: Setup task.md

Create `task.md` in the project root with:

```markdown
# <STORY_ID>: <Story Title>

## Acceptance Criteria
- [ ] AC 1 description
- [ ] AC 2 description

## Tasks
- [ ] Task 1
- [ ] Task 2
```

Include ALL acceptance criteria and tasks from the story. Use `[ ]` for uncompleted items. Preserve the story's task ordering.

---

## Step 7: Report Ready

Present a summary to the user:

```
Ready to start work!

Story:    <STORY_ID> — <Story Title>
Branch:   <current branch name>
Task.md:  <number of ACs> acceptance criteria, <number of tasks> tasks

[If changes were stashed: Stashed uncommitted changes from <previous branch> — run `git stash pop` on that branch when you want them back.]
```

The workflow is complete.
