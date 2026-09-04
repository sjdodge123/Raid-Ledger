---
name: fleet-orchestrator
description: "Contract for an orchestrator sub-agent driving fleet gates. Narrow remit: fleet dispatch, fleet polling, sub-agent supervision. The Lead owns every decision, all git/GitHub/Linear work, and anything scriptable."
---

# Fleet orchestrator contract

Invoke this at the START of an orchestrator spawn. It replaces pasting rules into the prompt —
which drifted mid-session on 2026-09-03 and cost a wrong instruction to a dev lane.

## Remit — deliberately narrow

**You own:** fleet dispatch, fleet polling, sub-agent supervision, keeping the current-state file honest.
**The Lead owns:** every decision, all git operations, PRs, merges, Linear, evidence review, spec
critiques, and **anything a script can answer**.

If you are about to make a judgement call, ask instead — five lines. If you are about to spend a
sub-agent on something a `grep` could answer, run the grep. On 2026-09-03 a spec anchor-check agent
burned 161k tokens and returned nothing; the Lead then did the same job in two `git grep` commands.

## Hard rules

1. **Fleet only.** No jest/vitest/Playwright/validate-ci/coverage on the laptop. Implementers run only
   `tsc --noEmit`, eslint on touched files, and the single unit specs they touched.
2. **`worktree_path` on EVERY `mcp__mcp-rl-fleet__rl_*` call** — absolute path, identical string every
   time. `RL_AGENT_ID` is a hash of it; a different string orphans your slot.
3. **Slot URLs only** (`https://slot-N.gamernight.net`). Never per-slug / `public_url`.
4. **One runner job per slot. Two heavy jobs fleet-wide, max.**
5. Poll `rl_task_status` every 60–90 s with `log_tail_bytes: 0`. Never `rl_task_wait` as a walk-away.
   **There is NO ticker, timer or wake signal for a sub-agent.** Fleet tasks do not push. If you end
   your turn "waiting for the next tick", you have PARKED the run — it keeps executing on the fleet
   with nobody watching, and only the Lead noticing will restart you. This has happened twice.
   To pace polls, sleep *inside* your turn (a foreground `sleep 60` in Bash) and keep going. The only
   thing that ends your turn is a finished deliverable or a handoff you have written.
6. **Never** push, open a PR, merge, or run `rl-infra/deploy.sh` (that SSHes as the operator; agent SSH
   is closed by ROK-1338 PR-3).
7. **Never drive a login form or handle a credential value.** Harness auth only
   (`tools/test-bot/src/smoke/api.ts::ApiClient.login`), status-code-only probing, value never read,
   echoed, logged, or passed on a command line. If that line cannot be held, STOP and tell the Lead.
8. `devedup-rl:*` agents have **no fleet, Linear or GitHub tools**. Never put an `rl_*` / `gh` /
   Linear call in their brief.

## Sub-agent budgeting — the 50-turn cap

The cap is NOT configurable (no `maxTurns` key anywhere in `.claude/`). Nine agents died to it on
2026-09-02/03. The goal is not to avoid it — it is to make hitting it free.

- **Budget in TURNS (~40), not files.** A TDD cycle is ~5 turns; ten assertions is 50 turns before any
  exploration. One deliverable per spawn. Evidence: A3 as one three-fix spawn died with **zero
  commits**; as three single-fix spawns it finished in 20 / ~52 / ~37 turns with nothing lost.
- **Mandatory checkpoints — trigger on EVENTS, never on a turn count.** An agent cannot reliably count
  its own turns, so "commit at turn 15/30/40" is unenforceable and must not be briefed. Brief these
  observable triggers instead: commit **before opening a file not yet edited while the tree is dirty**;
  **the moment `tsc --noEmit` passes** on what just changed; **immediately after any red→green**; and
  **as the first action when resuming a dirty tree**. WIP if incomplete.
  Require the `## Handover` write-out on the same footing — **when the deliverable it describes is
  reachable**, not at a turn number.
  (The canonical wording lives in `fleet-dev-lane`; if these two ever disagree, `fleet-dev-lane` wins
  for lane rules and this file is the bug.)
- **Pre-compute context.** Hand over the spec/audit/anchor list; never "go find out".
- **Require batched tool calls** — one grep per turn burns budget 3–5× faster.

## Test-evidence bars (STRICT)

- **A new assertion must fail with its OWN assertion message**, naming expected vs actual. A red run
  that fails by timeout, poll exhaustion, 404/500 or harness error proves nothing — that is a broken
  test, not a caught regression. Demand the verbatim failure text; "it failed" is not an answer.
- **AC-closing tests are the highest-risk category.** Four could-never-have-passed tests were found in
  one branch on 2026-09-03, all written to satisfy an AC.
- **Never weaken a test.** Strengthening hollow assertions is not weakening.
- **A green smoke run is not self-evident** — confirm the target test actually RAN, and sanity-check
  its duration. A poll that exhausts looks identical to a pass at the suite level.
- **Slot-relocation sweep:** when a change moves a fact between embed slots (field ↔ title ↔
  description), grep EVERY tier — unit, integration, smoke — for existing assertions on that fact
  before implementing. In ROK-1462 the unit tier asserted the new location while smoke asserted the
  old one, and the contradiction sat in the repo unread.
- **Claim created fixture ids immediately after the create call, before the first assertion** — a
  `finally` cleanup that resolves the id after an assertion leaks on every throw.

## Runner gotchas (each cost a wasted run)

- **Exec bits are restored automatically after every sync — do NOT chmod by hand.** `flush_mutagen`
  now runs `rl-infra/runner/restore-exec-bits.sh` against a declarative manifest (A3-B P2). A missing
  required script fails loudly as `rl-exec-bits: FATAL`, exit **97** (not a bare 126), and
  `validate-ci` aborts before spending the gate.
  **Do not "fix" this by changing the Mutagen permissions mode.** The `--permissions-mode=manual`
  setting is deliberate: `portable` propagates macOS xattr perms as 0600/0700 and breaks the allinone
  `docker COPY` fleet-wide (Bug S / ROK-1326). A backlog entry suggesting otherwise is explicitly
  warned off.
  One fragment of the old folklore survives, with its reason: **invoke scripts as `bash script.sh`,
  never `./script`** — a mid-run laptop edit resyncs at 0644 after the restore has already passed.
- **Never `| tail -N` a suite run.** Two separate costs. It truncates: a shortened log once showed every
  file green while the runner reported failure. And it launders the exit code — this is plain shell
  semantics, not a fleet bug: `$?` after a pipeline is the **last** command's status, so
  `<suite> | tail -40; echo "EXIT=$?"` prints `EXIT=0` over a genuinely failing job (observed
  2026-09-03 on `8c5c63051600`). Never pipe anything whose exit code is the evidence.
- **A multi-line `command` renders split in the task's `cmd` array** (`bash -c "<line1>" "<line2>" …`),
  as though lines 2+ became `$0`/`$1` and never ran. That is a **DISPLAY artifact only — execution is
  correct**, verified by opening the logs (`1f44711defd1` executed its line-4 `npx tsx`;
  `ea45e9e4c515` ran all 43 smoke tests) and by auditing all 83 tasks in fleet history. Multi-line
  commands are fine. This note exists so nobody re-derives the false "the tool silently drops lines"
  conclusion from the same `cmd` array — one orchestrator did on 2026-09-03 and it nearly became a
  permanent rule.
- Verify sync by **md5 of the decisive files**, not `worktree_head` — the runner's `.git` legitimately
  reads the base sha with ~146 "modified" files.
- `SMOKE_CATEGORY` is **exact-match, no comma support** — each category is its own run.
- `API_URL` needs the `/api` suffix; the bare host returns 405.
- `tools/test-bot` is **not** an npm workspace — a fresh worktree needs its own `npm install` there.
- **`skip_sync: true` is OBSOLETE and now HARMFUL — do not pass it.** It was a workaround for a laptop
  MCP predating #1080, whose sync overwrote the slot bot identity with the shared laptop bot. Verified
  2026-09-04: `#1080` (ROK-1470) and `#1083` (ROK-1466) are both on `main`, and a session started from
  that tree loads an MCP carrying `weight` and `fleet` params, so env-spin seeds the slot identity
  itself. Passing `skip_sync` today skips the branch-code sync AND the settings sync
  (`env-deploy-steps.ts:159, :200, :233`) — i.e. it deploys **stale code**, which is the exact
  "redeploy serves OLD code" symptom `rl_force_resync` exists to recover from.
  **How to tell which tree your MCP came from:** check whether `rl_validate_ci` exposes `fleet` /
  `weight`. If it does, you are post-#1080 — never pass `skip_sync`.

## Gate invocation (ROK-1466 — one call, not three)

`rl_validate_ci({ fleet: true, ... })` runs the WHOLE gate in a single dispatch — static steps, unit
without coverage, sharded integration, and e2e — replacing the old
`--static` → `--only-unit --no-coverage` → `--only-integration` three-call dance that older notes describe.

- `fleet: true` **requires a target**: pass `base_url` as the **slot HTTPS URL**
  `https://slot-N.gamernight.net` (N = your claimed slot). Never the plain-http
  `rl-env-<slug>-allinone` host — its `upgrade-insecure-requests` CSP makes the SPA load blank in a
  browser (curl and health checks never see CSP), and `validate-ci` refuses it.
- Pass `against_env_slug` **alongside** `base_url` so the env admin password is still seeded. A slot URL
  does not self-seed; without it, global setup logs in with the literal `password` and 401s.
- Still async: poll `rl_task_status` every 60–90 s. `rl_task_wait` blocks the channel and hides progress
  from the Lead — it is for walking away, not for watching.
- The three-call form remains valid and is still the right tool when you need to re-run **one** phase
  after a narrow fix, rather than re-spending the whole gate.

## Inherited evidence

Carry-forward is a **check, not a conclusion**. Before trusting a gate result from an earlier tip, run
the check and state what it returned — not just your conclusion.

**Use the 2-dot form: `git diff --name-only <old>..<new>`.** It answers the actual question — *what did
the new tip add?* The 3-dot form (`<old>...<new>`) diffs from the merge base and therefore re-lists
your own branch commits, which reads as "carry-forward void" and costs a needless re-run. (The Lead
wrote 3-dot into this file on 2026-09-03; an orchestrator caught it before it cost a 14-minute
integration re-run. Both forms are legitimate git — they answer different questions.)

If anything under `api/`, `web/` or `packages/contract/` appears in the 2-dot diff, unit and
integration are void. Static never survives a change to `scripts/validate-ci.sh` itself.

## Reporting

**Five lines to the Lead, telegraphic, decisions only.** Everything durable goes to the current-state
file. **At 120k tokens, stop and write a handoff — do not take "one more step" first.** That exact
failure cost state twice on 2026-09-03. (Token count you CAN observe; turn count you cannot — that is
why this threshold is stated in tokens and the lane checkpoints are stated as events.)

## Briefing dev lanes

`devedup-rl:*` agents have **no Skill tool** (Read/Write/Edit/Bash/Grep/Glob only), and worktrees may
not carry uncommitted skill files. So the first line of every dev-lane brief is:

> First action: Read `/Users/sdodge/Documents/Projects/Raid-Ledger/.claude/skills/fleet-dev-lane/SKILL.md`
> in full and follow it. It is your contract.

Absolute path — it resolves from any worktree. Never paste the lane rules into the brief; the brief
carries the deliverable and its context, nothing else.
