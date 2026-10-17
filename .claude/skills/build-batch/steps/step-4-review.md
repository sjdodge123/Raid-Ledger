# Step 4: Review — Reviewer + Architect + Smoke (mirrors `/build` step-4)

Same shape as `/build`'s step-4-review but reviewer fans out PER MILESTONE in parallel, and an Architect final cross-milestone pass is MANDATORY (not optional).

---

## 4a. Operator verdict

Poll Linear until the operator comments with verdict. Three outcomes:

- **Approve** → continue to 4b.
- **Approve with notes** → fix the notes inline (Lead does small edits directly per `feedback_lead_does_small_fixes.md`; respawn a dev agent for >3-line changes). Re-run a targeted CI / Chrome MCP pass. Re-flip Linear back to "In Review" for second verdict. Repeat until clean.
- **Reject** → flip Linear to "Changes Requested". Address blockers (may require respawning dev agents). Restart Step 3.

---

## 4b. Spec reconciliation re-check

Re-run Step 3a (spec ↔ implementation reconciliation). The operator's notes may have added scope or changed acceptance criteria; reviewers must see the LATEST spec, not the pre-operator one.

---

## 4c. Reviewer phase — 3 parallel channels

Per CLAUDE.md / `feedback_security_review_vs_code_review.md`: ALL THREE channels run for batch builds. No skipping the chunked devedup-rl pass.

| Channel | What it catches | How to invoke | Parallelism |
|---------|-----------------|---------------|-------------|
| Codex (general) | broad correctness/security/style across the whole diff | `codex review` two-pass | N/A (CLI) |
| Security review | auth bypasses, injection, secrets leaks, infra escalation | `/security-review` skill | N/A |
| devedup-rl chunked review | workspace-aware correctness, contract integrity, RL conventions, PER-MILESTONE chunks | spawn 1 `devedup-rl:reviewer` per milestone, in parallel | Yes — different chunks |

**Spawn all three concurrently** — Codex + security + the devedup-rl fan-out launch in the same response.

Each devedup-rl reviewer chunk is scoped to ONE milestone's file_set. Prompt: "Read `planning-artifacts/specs/<STORY>-M<N>-spec.md` (the post-reconciliation version). Review the diff for files in <file_set list>. Findings go to `planning-artifacts/review-<STORY>-M<N>.md`. Report ≤500 words to team-lead."

---

## 4d. Architect POST-REVIEW pass — MANDATORY for batch builds

The companion to Step 2b's PRE-DEV pass. Two architect passes per batch ship together. This is the final integration validator before push.

Spawn:

```
Agent({
  description: "Architect post-review <STORY>",
  subagent_type: "general-purpose",
  team_name: "build-batch-<STORY>",
  prompt: <contents of templates/architect.md with TASK_TYPE=POST_REVIEW>
})
```

Architect reads:
- ALL milestone specs (post-reconciliation versions)
- The PRE-DEV pass output at `planning-artifacts/architect-pre-dev-<STORY>.md` (verify guidance was followed)
- ALL reviewer findings from `planning-artifacts/review-<STORY>-M<N>.md`
- The combined diff: `git diff origin/main..HEAD`

Architect looks for:
- Cross-milestone integration breaks (e.g. M2 changes a tool's return shape and M5b's caller still expects the old shape)
- Contract drift (Zod schemas + their consumers across milestones)
- Skill cutover gaps (if the story did a hard cutover — any caller of the cutover'd surface still using the old shape?)
- Test coverage gaps for cross-milestone flows
- Type errors that show up only when all milestones are compiled together (per-milestone tsc passes don't always catch this)
- Pre-dev guidance silently ignored

Output: `planning-artifacts/architect-final-<STORY>.md` with categorized findings (must-fix / should-fix / nice-to-have) AND a "Prior pre-dev guidance status" section.

---

## 4e. Address findings

Same protocol as `/build` step-4:
- Must-fix → fix BEFORE smoke (Lead inline or respawn relevant milestone's dev agent)
- Should-fix → fix if cheap, otherwise capture in TECH-DEBT-BACKLOG.md
- Nice-to-have → TECH-DEBT-BACKLOG.md only

---

## 4f. Lead smoke tests

Run on the (now-stable) combined branch:

```bash
# Quick smoke — golden path of each milestone's primary AC
# Read the spec, pick AC #1 of each milestone, manually verify
```

For batch builds, ALSO run the cross-milestone integration scenarios identified by the architect.

If smoke catches a regression → respawn the relevant milestone's dev agent, restart Step 3.

Update state: `gates.reviewer: PASS`, `gates.architect_final: PASS`, `gates.smoke: PASS`. Proceed to **Step 5 — Ship.**
