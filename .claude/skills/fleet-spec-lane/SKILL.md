---
name: fleet-spec-lane
description: "Contract for a spec-writing sub-agent. What it cannot reach, how many turns it actually has, and the flag-don't-guess rule — so a brief carries the story, not the rules."
---

# Fleet spec-lane contract

Invoke at the START of a `devedup-rl:spec-writer` spawn. Your brief then carries **one story and its
context** — not the rules. Sibling contract to `fleet-dev-lane`, which governs implementers/reviewers.

## Your budget is 30 TURNS — and the cap differs by agent type

Two limits stack. The **harness cap is 50 and is NOT configurable** (CLAUDE.md:91). On top of it, the
plugin sets a per-agent `maxTurns` that is often LOWER:

| agent | maxTurns |
|---|---|
| `implementer` | **50** |
| `tester` | 40 |
| `spec-writer` · `reviewer` · `planner` | **30** |
| `pr-writer` | 15 |

So a spec-writer, a reviewer and a planner each get **30**, not 50. On 2026-09-04 three spec agents were
briefed with "~40 turns" and two hit the cap — both during their own anchor-verification pass. Reviewers
were briefed the same way that session; they happened to finish under 30, but the brief was wrong.

**More turns is NOT the fix, and raising the cap was considered and rejected.** Every spec agent that hit
30 had already produced its full spec; what it lost was a mechanical anchor pass the Lead can run in
about three scripted commands. Spending agent turns there duplicates cheap Lead work — the same mistake
as the critic that burned 161k tokens re-checking anchors two `git grep`s could answer.

**Batching is the real lever.** Same budget, different outcomes on 2026-09-04: one spec agent made 49
tool calls and finished; another made 51 and hit the cap. The binding constraint was calls-per-turn, not
turns. **Issue independent greps and reads in a single message**, and verify anchors AS YOU WRITE rather
than in a final pass you may never reach.

Corollary for whoever briefs you: the mechanical checks — anchor existence, counted line sizes, "does
this symbol exist" — belong to the Lead, not to you. Spend your turns on judgement.

## You have NO Linear access — the Lead must hand you the issue

Your tools are `Read, Grep, Glob, Bash`. There is no Linear tool, and Linear here is a claude.ai
connector rather than a project MCP server, so it cannot be granted to you. **You cannot read the issue
body yourself.**

**The Lead must materialise it for you** to `planning-artifacts/issue-ROK-XXXX.md` and give you the
absolute path. If your brief does not name such a file:

1. Say so **at the top of the spec you write**, in a "Provenance" section, with a table of what you
   reconstructed the scope from.
2. Reconstruct from `planning-artifacts/**` (handovers, acceleration plans, sibling specs) — the
   operator's notes are usually contemporaneous and detailed.
3. **Flag every ambiguity rather than resolving it.** See below. This is what makes reconstruction safe.

Evidence this matters: on 2026-09-04 two of three reconstructions produced a decision that
**contradicted an explicit AC** — one invented a rate-limit number the issue explicitly deferred to
another story, another rejected a tool the issue mandates by name. Both were caught only because the
agents flagged them instead of quietly deciding.

## Flag, do NOT guess (the rule that saved both of those)

When the source does not settle something, write **`UNVERIFIED`** or a numbered ambiguity inline, state
the default you are building around, and say what would change if the operator rules otherwise.

A confident wrong anchor costs far more than an admitted gap. On 2026-09-04 a flagged `UNVERIFIED` route
param turned out to be genuinely wrong (`:matchId`, not `:pollId`) — building on the guess would have
shipped a dead link that no type-check would catch.

**Never resolve a product question by picking the reasonable-sounding option.** Product decisions are the
operator's; your job is to make the choice visible and cheap to make.

## Anchor discipline (STRICT)

Every `file:symbol:line` you cite must exist on the stated base commit. **Grep each one before writing
it down.** A spec was rejected for bad anchors, and a critic agent later burned 161k tokens re-checking
them — the check is two scripted commands, so do it inline.

Files the spec *creates* are expected not to resolve. Say which is which; an unresolvable anchor that is
a new file is fine, one that is meant to exist is a rejection.

## You cannot Write or Edit

`disallowedTools: Write, Edit`. Produce the spec through Bash — a heredoc is the reliable form:

```bash
cat > planning-artifacts/specs/ROK-XXXX.md <<'EOF'
...
EOF
```

Quote the heredoc terminator (`<<'EOF'`) so the shell does not expand `$`, backticks or `${}` in your
content. Unquoted, zsh runs backticks as command substitution and **silently eats the word** — that has
already corrupted a commit message on this project.

## Where the spec goes

`planning-artifacts/specs/ROK-XXXX.md` — uppercase ID-only filename, **NOT** `docs/specs/`. A spec at
the wrong path gets regenerated from scratch.

`planning-artifacts/` is **gitignored**, so it does not exist inside a worktree unless someone copied it
there. Always use the absolute main-checkout path.

## House style

Match `planning-artifacts/specs/ROK-1446.md`: front-matter (tier + gate + design reference +
dependencies) · "What exists today (audit)" with verified anchors · a "Lead decisions" table **with a Why
column** · per-lane file lists **with counted-line budgets** · ACs each traceable to `file:line`.

State the **tier and gate** explicitly. A migration or infra file escalates the gate; say so.

## Constraints every Raid-Ledger spec must carry

- **`ts-jest` does not typecheck here.** Require `tsc --noEmit -p api/tsconfig.json` from the repo root
  as a step SEPARATE from jest. A green jest run is not evidence that a spec file compiles.
- **Mutate every new assertion.** Six could-never-have-failed tests were found across two stories.
- **300 counted lines is an ESLint ERROR** (blank/comment-stripped); spec files get 750. Give budgets.
- **Migrations are generated LAST**, as the lane's final commit, and numbers may already be claimed by
  unmerged branches — check before assigning one.
- **Never weaken an existing assertion.** Extending a guard is fine; narrowing one is not.

## Finish

End with a short summary naming: what you verified, what you flagged, and what you did not reach. **An
honest "I did not reach X" is worth more than a complete-looking spec with a guess in it.**
