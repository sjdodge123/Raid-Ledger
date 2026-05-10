---
name: sprint-planning
description: "Strategic-discussion surface for Raid-Ledger. Reads the Active State Linear doc + current-sprint.md + live signals (Linear, git, PRs, env lock), synthesizes where we are, proposes 1-3 candidate next moves with rationale, recommends one, and asks for what's needed from the operator to act. Use to resume after a session break, brief a fresh agent on next strategic action, or do cycle-level planning. Pass an optional focus argument (e.g. 'after 1250 lands', 'test infra', 'ROK-1253')."
disable-model-invocation: true
argument-hint: "[focus area or story id]"
allowed-tools: "Bash(git *), Bash(gh *), Bash(cat *), Read, Grep, Glob, mcp__linear__get_document, mcp__linear__list_issues, mcp__linear__get_issue"
---

# Sprint Planning — Strategic Discussion Surface

**Purpose:** the operator invokes this when they want to discuss the next strategic move — at the start of a fresh session, after a break, or at a cycle boundary. The skill reads everything that captures cross-session context, layers in live signals, and proposes options. **It does not act.** It ends by asking for go / redirect / hold.

This is the **read-side** companion to `/status-report`'s Global mode (which is the **write-side**).

## What this skill is and isn't

- ✅ Reads the Active State Linear doc, `current-sprint.md`, Linear stories, git, gh PRs, env lock.
- ✅ Synthesizes across those into a 1-page brief and proposes options.
- ✅ Recommends ONE next move with rationale.
- ✅ Asks for what info is needed from operator before acting.
- ❌ Does not write code, ship PRs, file stories, or update the docs.
- ❌ Does not auto-pick winners or assume operator intent.

If the operator confirms the recommendation, hand off to a different skill (`/build`, `/dispatch`, `/fix-batch`, or direct agent work). This skill ends at "go / redirect / hold."

---

## Step 1: Capture the focus

`$ARGUMENTS` may be empty or carry a focus hint. Examples and how they bias the discussion:

| Argument | Bias |
|---|---|
| _empty_ | Open question — "given everything, what's next?" |
| `ROK-XXXX` | Center the proposal on that story (resume / unblock / sequence) |
| `test infra` / `lineup` / `discord` | Filter candidate moves to that area |
| `after X lands` | Forward-look — what becomes the next move once X is shipped |
| `cycle planning` | Cycle-level mode — produce wave plan instead of single-move recommendation |

If the argument is genuinely ambiguous, ask one clarifying question before running Step 2.

---

## Step 2: Read the canonical state docs

Run these in parallel:

1. **Active State Linear doc** — `mcp__linear__get_document` with slug `7a4ddc5652c9`. This is the primary input — Strategic section has decisions and next-up rationale; Derived has current state.
2. **`planning-artifacts/current-sprint.md`** — `Read`. Cycle theme, waves, conflict map, deferred list.

If either is missing or malformed, surface as a BLOCKER and stop — synthesizing without these is guesswork.

---

## Step 3: Drift check against live signals

The Active State doc's Derived section may be stale if `/status-report` hasn't run on `main` recently. Run these in parallel to catch drift:

```
git log --oneline origin/main -10
gh pr list --state open --json number,title,headRefName,createdAt
git worktree list
cat ~/.raid-ledger/env-lock.json
mcp__linear__list_issues  (state="In Progress")
mcp__linear__list_issues  (state="Code Review")
```

Compare to the doc's Derived section. If significant drift (>1 day stale, or a story-status mismatch, or an env-lock holder change), **flag it** and recommend running `/status-report` from `main` to refresh. Continue with current reality, not the stale doc.

---

## Step 4: Synthesize and propose

Build the output in this exact structure. **No extra prose before or after.**

```
═══ STRATEGIC PLANNING ═══
Focus: <$ARGUMENTS or "open question">

CURRENT STATE
- In flight: <1-2 sentences naming each in-flight story + phase>
- Last 3 strategic decisions: <one-liner each, dated, from Strategic / Recent decisions>
- Env lock: <holder + branch, or "free">
- Recently shipped (3): <one-liner each>
- Doc freshness: <"current" | "stale, last derived: <date> — recommend /status-report on main">

CANDIDATE MOVES
1. <name>
   - Why: <single-sentence rationale>
   - Gates / unblocks: <what depends on this, what this depends on>
   - Effort: <S / M / L> (S=hours, M=1-2 days, L=multi-day)
   - Risk: <one-liner — or "low">

2. <name>
   - Why: ...
   - Gates / unblocks: ...
   - Effort: ...
   - Risk: ...

3. <name>
   - ... (omit if only 1-2 candidates make sense)

RECOMMENDED: #<N> — <one-sentence why this over the others>

NEEDED FROM YOU
- <specific decision, info, or approval required to act>
- <one item per line, max 3>

(go / redirect / hold)
```

### Rules for each block

- **CURRENT STATE** — facts only, no recommendations. Pull "Last 3 strategic decisions" from the doc's Strategic / Recent decisions section, newest first. If fewer than 3 decisions exist, list what's there.
- **CANDIDATE MOVES** — 1-3 entries. Don't pad with options that aren't real. Each option must be concretely actionable (no "consider exploring X").
- **RECOMMENDED** — pick ONE. The rationale must reference something from CURRENT STATE — not invented.
- **NEEDED FROM YOU** — only the items that genuinely need operator input. If no clarification is needed, write `- nothing — say "go" to proceed`.
- **End at `(go / redirect / hold)`**. No farewell, no "let me know if". Stop printing text.

### When focus is `cycle planning`

Use this alternative output instead of the single-move recommendation:

```
═══ CYCLE PLANNING ═══

CYCLE CONTEXT
- Current cycle: <theme + dates>
- Stories closed this cycle: <count + ROK list>
- Stories still open: <count + ROK list>
- Carry-over candidates: <stories that won't close in time>

PROPOSED NEXT-CYCLE WAVES
- Wave 1 (urgent / parallel-safe): ROK-... | ROK-... | ROK-...
- Wave 2 (parallel-safe, lower priority): ...
- Wave 3 (sequential / gated): ...
- Deferred: ROK-... (reason)

CONFLICT MAP
- ROK-A and ROK-B both touch <files> — sequence or rollup
- ...

CAPACITY
- Recommended max parallel: <N> (per memory `feedback_build_always_uses_teams.md`)
- Slot allocation suggestion: ...

NEEDED FROM YOU
- <decisions required before committing the plan to current-sprint.md>

(approve / redirect / hold)
```

Only enter cycle-planning mode when the operator explicitly passes that argument or asks for cycle-level planning. Default behavior is single-move recommendation.

---

## Step 5: Stop

This skill ends with the operator's choice. Do not act on the recommendation in the same turn — `/build`, `/dispatch`, `/fix-batch`, or direct work picks up from there.

If the operator says "go", proceed by handing off to whichever execution skill matches the recommended move, OR by directly working on it if it's a small Lead-direct task (per memory `feedback_lead_does_small_fixes.md`).

If the operator redirects, restart at Step 1 with the new focus.

If the operator says "hold" or asks for more analysis, expand on the specific candidate they asked about — don't re-print the full template.

---

## Halts

- Active State doc inaccessible (Linear MCP error, doc missing) → BLOCKER, stop. The skill cannot synthesize without it.
- `current-sprint.md` missing → BLOCKER, stop. Same reason.
- All sources fresh and aligned but no candidate moves are credible (e.g. everything is in flight, nothing is queued, no follow-ups) → output the CURRENT STATE block, then write `CANDIDATE MOVES: none — work in flight is sufficient. Re-invoke when a slot opens.` Skip RECOMMENDED.
- Operator interrupts mid-synthesis → stop cleanly; the read steps are idempotent and re-running is cheap.
