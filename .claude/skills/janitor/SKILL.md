---
name: janitor
description: "Clean up stale local worktrees and sibling Raid-Ledger--* dirs. Always fetches origin/main first, verifies each branch actually shipped before removing anything, and appends findings to the Active State Linear doc."
allowed-tools: "Bash(git *), Bash(gh *), Bash(ls *), Bash(rm *), Read, mcp__linear__get_document, mcp__linear__save_document, mcp__mcp-env__env_lock_status"
---

# /janitor — Worktree & directory cleanup

**Purpose:** sweep the parent directory of the main Raid-Ledger checkout for stale `Raid-Ledger--*` dirs and registered worktrees. Confirm each one's work has actually shipped (PR merged on `origin/main`) and that nothing local would be lost. Propose, then — only after explicit operator approval — execute the cleanup. Update the Active State Linear doc with what happened.

## Why this exists

`git worktree add` and parallel `/build` / `/fix-batch` / `/bulk` sessions accumulate sibling dirs. Cleanup at the end of each session is often skipped or partial. After a few weeks the parent directory has 20+ orphaned dirs from work that already shipped — confusing for the operator and surface-area for foot-guns (a stale dir on a deleted branch can be mistaken for current state).

## Hard safety rules (STRICT)

These rules NEVER bend, regardless of how confident the cleanup looks:

1. **ALWAYS fetch first.** `git fetch origin main` is the first action. If the fetch fails (network, auth) → **ABORT** the whole skill. No removals.
2. **NEVER delete the main worktree** (`/Users/sdodge/Documents/Projects/Raid-Ledger`).
3. **NEVER delete a worktree currently holding the env lock.** Check via `mcp__mcp-env__env_lock_status` and cross-reference the holder's `branch` field.
4. **NEVER delete a worktree mentioned in the Active State doc's "In flight" section** without explicit operator override.
5. **NEVER delete a dir with uncommitted changes**, untracked authored files, OR commits not represented on `origin/main` by a merged PR. Squash-merge "ghost commits" (local branch ahead but the squashed diff is on main) are the ONLY exception — and only if the corresponding PR is `state=MERGED`.
6. **NEVER bypass the propose-then-confirm gate.** Present the plan, wait for operator "go", then execute. No autonomous removals.
7. **Removals are sequential, not parallel.** One worktree at a time, log each result, stop on first unexpected failure.

If any rule trips for a given entry, the entry goes into the SKIPPED bucket with a one-line reason — it does NOT get removed.

## Steps

### Step 1: Sync state

Run in parallel:

```bash
git fetch origin main
git worktree list
ls -1d ../Raid-Ledger--* 2>/dev/null
```

Also fetch:
- `mcp__mcp-env__env_lock_status` — current env-lock holder
- Active State doc "In flight" section via `mcp__linear__get_document(id: "7a4ddc5652c9")`

If `git fetch origin main` fails (non-zero exit), **STOP** and tell the operator. Do not proceed.

**Do NOT pull a flat `gh pr list --state merged --limit N`.** That list is capped — anything older than the most recent N PRs (or filtered out by labels/authors/etc.) won't appear, and the skill will misclassify a merged worktree as "not merged" and skip it forever. Step 2 verifies each branch with a per-branch `gh pr list --search` query instead.

### Step 2: Classify each entry — per-branch verification (STRICT)

For every `Raid-Ledger--*` dir AND every registered worktree, run the **rigorous per-branch merge check** before any classification:

```bash
# Resolve the branch this dir was tracking (don't parse the dir name — read git state)
BRANCH=$(git -C <path> rev-parse --abbrev-ref HEAD 2>/dev/null)

# Did this branch ship via a merged PR? Returns JSON array, empty if no merged PR exists.
gh pr list --search "head:${BRANCH}" --state merged --json number,mergedAt,title,headRefName

# Belt-and-suspenders: if the merged query is empty, check ALL states for this branch.
# Helps distinguish "merged via different mechanism" from "PR open/closed-without-merge"
# from "no PR ever existed."
gh pr list --search "head:${BRANCH}" --state all --json state,number,title
```

**Rule:** a branch is `MERGED` ONLY if the per-branch `--state merged` query returns ≥1 entry. **Do not infer merge status from a flat top-N list, from `git branch --merged main` alone, or from the absence of the branch on origin.** The per-branch search is the only authoritative signal.

**Registered worktree:**

```bash
cd <worktree_path>
git status --porcelain          # any output = dirty
git log @{u}..HEAD --oneline    # any output = unpushed (may be squash ghosts — see below)
```

| Condition | Bucket |
|---|---|
| `BRANCH == main` AND path is the canonical main worktree | KEEP (this is home) |
| Branch holds env lock | SKIP — env-lock holder |
| Branch listed in Active State "In flight" | SKIP — in flight |
| `git status --porcelain` non-empty | SKIP — uncommitted changes |
| Per-branch `gh pr list --state merged` returns ≥1 entry, working tree clean, no unpushed commits | REMOVE |
| Per-branch `gh pr list --state merged` returns ≥1 entry, working tree clean, unpushed commits exist but diff is squash-equivalent to the merged PR (verify `git log @{u}..HEAD` subjects match the merged PR title) | REMOVE — flag as squash-ghost |
| Per-branch `gh pr list --state merged` returns 0 entries (no merged PR for this branch) | SURFACE — do NOT remove even if branch looks abandoned. Operator decides. |
| Per-branch open/closed-without-merge PR exists, last commit > 14 days old | SURFACE — possible abandoned work |
| Per-branch open PR exists, recent activity | SKIP — likely active |

**Orphaned dir (filesystem only, NOT in `git worktree list`):**

```bash
cd <dir>
git status 2>&1               # may say "fatal: ... .git file ... gitdir invalid"
git log -1 --oneline 2>&1
BRANCH=$(git -C <dir> rev-parse --abbrev-ref HEAD 2>/dev/null)
# Same per-branch check as above:
gh pr list --search "head:${BRANCH}" --state merged --json number,mergedAt,title
```

| Condition | Bucket |
|---|---|
| Has `.git` file pointing at a NUKED gitdir (registered worktree was removed but dir persisted) AND per-branch query confirms a merged PR | REMOVE — orphan |
| Has `.git` file pointing at a NUKED gitdir, per-branch query returns 0 merged PRs | SURFACE — branch wasn't shipped via PR; operator decides |
| Has `.git` dir (full clone, not a worktree) with uncommitted changes | SURFACE — operator decides |
| Has `.git` dir, clean, per-branch query confirms a merged PR | REMOVE — operator confirms |
| No `.git` at all, just files | SURFACE — operator decides (probably not a worktree-related artifact) |

**Why the per-branch query is non-negotiable:** a flat `gh pr list --state merged --limit N` is capped at N most-recent PRs. Project history > N means older worktrees get misclassified as "not merged" and skipped forever — the dir then lingers and the next /janitor pass repeats the mistake. Caught 2026-05-14 on the first /janitor invocation.

### Step 3: Propose plan (STOP HERE)

Print a table grouped by bucket. **Do not execute anything yet.** Wait for explicit "go" from operator.

```
═══ /janitor PROPOSED CLEANUP ═══

KEEP (N):
  /Users/sdodge/Documents/Projects/Raid-Ledger — main worktree

SKIP (M):
  Raid-Ledger--rok-XXXX — in flight (Active State)
  Raid-Ledger--rok-YYYY — env-lock holder
  Raid-Ledger--rok-ZZZZ — uncommitted changes: <files>

REMOVE — registered worktrees (P):
  Raid-Ledger--rok-AAAA — PR #N merged YYYY-MM-DD, clean, no unpushed
  Raid-Ledger--rok-BBBB — PR #N merged YYYY-MM-DD, squash-ghost commits OK

REMOVE — orphaned dirs (Q):
  Raid-Ledger--rok-CCCC — orphan (gitdir invalid), would `rm -rf`
  Raid-Ledger--rok-DDDD — clean clone, branch merged via PR #N, would `rm -rf`

SURFACE — operator decides (R):
  Raid-Ledger--rok-EEEE — branch not merged, last commit 21 days ago — abandoned?
  Raid-Ledger--FFFF      — no .git, no idea what this is

Proceed? (go / cancel / drop:<name> / hold)
```

Operator inputs:
- `go` → execute REMOVE buckets (registered + orphaned) in sequence
- `cancel` → exit, change nothing
- `drop:<name>` → move that entry from REMOVE → SKIP, re-print, ask again
- `hold` → exit; operator wants to think about it

### Step 4: Execute (only after "go")

For each REMOVE-registered worktree, sequentially:

```bash
git worktree remove <path>
# if the local branch still exists post-squash-merge:
git branch -D <branch_name> 2>/dev/null || true
```

If `git worktree remove` errors mid-flight (e.g. detects dirty state we missed), **STOP** — do not pass `--force`. Print the error, mark this entry as failed, ask operator before continuing to next.

For each REMOVE-orphaned dir:

```bash
rm -rf <path>
```

After all removals, run `git worktree prune` to clean any registry orphans.

### Step 5: Update Active State doc

Append a dated entry to the Active State Linear doc Strategic section (slug `7a4ddc5652c9`) per CLAUDE.md "Post-merge planning artifact reconciliation" — this counts as a strategic cleanup worth recording so future sessions know when the last sweep happened.

Entry format:

```
**YYYY-MM-DD — /janitor sweep**

* Removed N registered worktrees: <ROK list with PR refs>.
* Removed M orphaned dirs: <ROK list>.
* Skipped K: <one-line reason each, grouped by reason>.
* Surfaced L for operator review: <list with one-line reason>.
* Active worktrees remaining: <count + names>.
```

Use `mcp__linear__save_document` to update the doc. Get the current content via `mcp__linear__get_document` first, splice the new entry in at the TOP of "### Recent decisions" (newest first per the doc's convention), and save.

### Step 6: Final report

```
═══ JANITOR SWEEP COMPLETE ═══
Removed: <P registered + Q orphaned> = <total> dirs
Skipped: M (see above)
Surfaced: L (need operator review)
Active worktrees remaining: <list>
Active State updated: ✓ (or ✗ + reason)
```

## When NOT to invoke

- During an active `/build`, `/fix-batch`, or `/bulk` session — wait for that batch to ship its PR first. The skill respects in-flight markers but accidentally racing against an active batch wastes everyone's time.
- When `git fetch` would error (offline, auth expired) — STOP cleanly rather than guessing.
- When the operator says "leave my old experiments" — those usually live as orphaned dirs without merged PRs. The skill's SURFACE bucket exists for exactly this case; treat the operator's preferences as override.

## Halts

- `git fetch origin main` fails → ABORT, no cleanup, surface error to operator.
- Active State doc inaccessible at Step 5 → still complete Steps 1-4, skip Step 5, FLAG the gap in the final report. Don't block the cleanup on doc availability.
- More than 3 entries land in SURFACE → present them all and ask operator to triage before executing the REMOVE buckets. The point of /janitor is reducing operator friction, not increasing it; if half the dirs need decisions, batch the conversation.
- Mid-execution removal error → STOP, surface the entry, ask operator before continuing.

## Notes on edge cases

- **Squash-ghost commits:** when a PR squash-merges, the local branch typically has the pre-squash commits + a divergent hash from origin/main. Detection: `gh pr list --search "head:<branch>" --state merged --json mergedAt,title` returns a result; `git log @{u}..HEAD` shows commits whose subjects appear in the merged PR description. Safe to remove if both hold.
- **`Raid-Ledger--batch` and `Raid-Ledger--rok-1156-feature` style names:** the dir-name → branch-name mapping isn't always `rok-NNNN`. Look at the dir's actual git state (via `git -C <dir> branch --show-current`) rather than parsing the dir name.
- **`Raid-Ledger--fix-batch-YYYY-MM-DD`:** these are batch integration worktrees. Same classification rules — if the batch PR merged and tree is clean, REMOVE.
- **Non-Raid-Ledger sibling dirs** (e.g. `sjdodge123.github.io`): out of scope. The skill globs only `../Raid-Ledger--*`.
