---
name: overnight
description: "Run a Lead session through the night with no fixed stop. Phase A (~30 min, operator awake): boot, draft a ranked NIGHT-PLAN for the next 6–8 h, collect the rulings it needs, get a go. Phase B (operator asleep): execute the plan autonomously, applying reversible calls and parking the rest, relaying to a fresh Lead near the context threshold. Phase C: leave a refreshed CURRENT-STATE, a morning brief artifact and ready-to-run ruling questions. Use when the operator says /overnight, 'plan the night', 'work while I sleep'. `/overnight --resume <plan>` is how a relayed Lead picks up."
---

# Overnight

An overnight session is a **Lead session** (`.claude/skills/lead/SKILL.md`) with an overlay. Load and follow `/lead` §1–§7 for everything this file does not override: boot, model routing, context discipline, the per-story pipeline, lane briefs, traps. Sub-agents never invoke this skill.

Arguments: none → Phase A. `--resume <path to NIGHT-PLAN>` → skip to **Resume** (a relayed Lead).

---

## Phase A — plan the night (operator awake, aim for ≤30 min, ≤6 Lead turns)

1. **Boot** exactly as `/lead` §1, in one batched turn. Add: `rl_status` disk/memory, open PRs with their CI state, envs and their death times (created + 24 h), pending-approval `INDEX.md`.
2. **Draft `planning-artifacts/NIGHT-PLAN-YYYY-MM-DD.md`** in the MAIN checkout (format: `NIGHT-PLAN-2026-10-24.md`). Sections:
   - **Window:** start → operator wake time (ask in step 3 if unknown), and a wind-down mark at wake − 45 min.
   - **§1 Ranking:** every candidate with a verdict: **RUN to PR** / **RUN to gate** (no PR) / **spec + mockup only** / **DEFER**, and a one-line why. Candidates come from the live state, in sprint order (fix → tech-debt → small → feature unless the state files say otherwise). A story may be RUN only if nothing in it waits on a ruling the operator has not given tonight. Unruled design work = spec + mockup only (to pending-approval).
   - **§2 Waves:** hour-sized blocks × fleet slots. Respect: max 2 heavy fleet tasks, 1 image build, ONE Playwright tier, ONE verify lane at a time (they share the Browser pane), ≤4–6 dev lanes in parallel, Discord smokes serialised (shared guild).
   - **§3 Per-story lanes:** lane (model, turn budget) → gate tier → test plan yes/no → Discord smoke yes/no.
   - **§4 File-conflict guards:** which stories share files and in what order they go.
   - **§5 Stretch list:** what to pull in if the night runs ahead.
   - **§6 Progress** (empty; the night appends to it).
   - **§7 Morning batch** (empty; the night appends to it).
3. **Pre-flight with the operator:** one or two `AskUserQuestion` calls (≤4 questions each, recommendation first and labelled "(Recommended)", the context the operator needs inside each question, mockup paths named). Ask only what changes tonight's plan:
   - the rulings that would turn a "spec only" item into "RUN to PR";
   - anything only they can do before sleeping (own-Discord test steps, an infra deploy, a prod pull);
   - wake time, if not known.
   Then show the plan summary (ranking + waves, ≤25 lines in chat) and ask **Go / Adjust** as the last question.
4. **On Go**, before spawning anything:
   - Write the memory `project_overnight_YYYY_MM_DD.md` (type project): the operator's go in their words, timestamp, wake time, the plan path, and the standing rules below. This file is the authorisation the night (and every relayed Lead) acts on.
   - `mcp__ccd_host__request_keep_awake` for the window (the laptop runs the MCP servers and Mutagen; sleep kills gates).
   - Then start wave 1.

## Standing rules for the night (operator ruling 2026-10-26)

- **Rulings.** A lane hits a decision that is the operator's:
  - **Apply** the recommendation when it is reversible: copy, layout, spacing, ordering, a default value, a small UX choice within an approved design. Log it under §7 as `APPLY — veto on PR #N`, and in the PR body.
  - **Park** the story (move to the next ranked item) when it is product scope, a new or changed contract/schema/migration not already specced, permissions/roles, anything destructive or irreversible, security posture, or an external message. Log it under §7 as `WAIT` with the question and a recommendation.
- **Merges.** PRs with green CI auto-merge (squash) as by day. Prod pulls are the operator's: never trigger Watchtower. **Infra never merges overnight**: `rl-infra/**`, `Dockerfile*`, `nginx/**`, `docker-entrypoint*` PRs open with auto-merge OFF and go to the morning batch.
- **Never overnight:** send messages/emails/posts as the operator, destroy data other than this night's own fleet envs, force-push, change settings/permissions, touch prod, delete in Linear, or run a full fleet Playwright suite (`/lead` gate rules still hold).
- **No idle turns and no polling from the Lead.** Waiting = a background watcher that exits once, or an ops lane that replies once. If everything RUN is blocked, take the stretch list, then spec-only work, then backlog investigation (reproduce-first for flakes).
- **Red is investigated, not retried.** A red gate or CI run gets a root-cause lane; three failed attempts on one story → park it with the evidence and move on.
- **Envs:** destroy each story's own env as soon as its work is done and every plan step is ruled (standing rule). An env holding an `OPERATOR` step stays; recreate it ~2 h before it dies if the step is still open at wind-down.

## Phase B — run the night

- Work the waves in order with the `/lead` §4 pipeline. At every seam (PR opened, gate finished, story merged or parked) append one line to NIGHT-PLAN §6: `HH:MMZ — <story>: <what happened> (PR/commit/task id)`. Keep `CURRENT-STATE.md` current at the same seams.
- After each merge: `/lead` §4 step 9 close-out (Linear, sprint row, env, worktree).
- Re-rank when reality diverges (a story finishes early, a PR goes red); note the change in §6 with the reason.

### Self-relay (context)

Measure, don't guess: sum `usage` from this session's transcript under `~/.claude/projects/`. At the first seam past **~300k** context:

1. Finish the turn's bookkeeping. **Do not spawn new lanes.** Wait for running lanes to report (they report to this session). A long fleet task may keep going: note its task id; the next Lead reads it with `rl_task_status`.
2. Write `planning-artifacts/LEAD-HANDOVER-YYYY-MM-DD-overnight-N.md` (≤60 lines: in flight with task ids, worktrees, slots/envs, what is next in the plan, traps hit tonight) and update NIGHT-PLAN §6/§7 and `CURRENT-STATE.md`.
3. Load `mcp__ccd_session__start_session` (ToolSearch) and start ONE fresh session: `initiation: "user_asked"` (the operator authorised relays in their /overnight go; quote it from the memory file in the brief), `context: "fresh"`, in the main checkout, brief = `/overnight --resume planning-artifacts/NIGHT-PLAN-YYYY-MM-DD.md` plus the handover path. Confirm the tool result says it started.
4. Append `HH:MMZ — relayed to <session link>` to §6 and stop: no further tool calls in this session.

A relay that fails to start: retry once; if it fails again, keep going in this session up to ~450k, then write the handover and stop.

### Wind-down (wake − 45 min)

Stop starting lanes. Let running lanes finish or checkpoint (WIP commits + handover files). Then Phase C.

## Phase C — what the operator wakes up to

1. **`CURRENT-STATE.md`** (main checkout, ≤80 lines, checklist first): shipped overnight (PR links), open PRs and their state, parked stories and why, envs still up and their death times, the ruling batch count.
2. **Morning brief artifact:** load the `artifact-design` skill, write the page to the scratchpad, publish it with the Artifact tool (private by default; icon `moon`). Contents: shipped list with PR links; open PRs; test plans with their fleet dashboard links, plus QR codes for any phone step (memory: tester links go to the operator as QR codes); parked items; the ruling batch with recommendations; fleet state. Put the link at the top of `CURRENT-STATE.md`.
3. **`planning-artifacts/MORNING-QUESTIONS-YYYY-MM-DD.md`:** the §7 batch pre-written as `AskUserQuestion` payloads: ≤4 questions per block, each with the context inside the question, the recommendation first and labelled, the mockup path, and whether it is APPLY (already applied; veto) or WAIT (blocking). When the operator's first message of the day is "go", "morning", "I'm up" or similar, the Lead (this one or the relay) runs those blocks first, then records the answers per `/lead` (spec + Linear + pending-approval `_approved/`).
4. Release fleet claims this night holds (`rl_release`, preserving envs with an open OPERATOR step), and end with a ≤10-line chat summary pointing at the artifact.

## Resume (`--resume <plan>`)

A relayed Lead: run `/lead` §1 boot, then read the NIGHT-PLAN (§2 waves, §6 progress, §7 batch), the newest `LEAD-HANDOVER-*-overnight-*.md`, and the `project_overnight_*` memory (your authorisation). Read in-flight task ids with `rl_task_status` before deciding anything. Do not re-plan or re-ask the operator; continue from §6 under the standing rules. Log `HH:MMZ — resumed (relay N)` in §6.
