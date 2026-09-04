---
name: fleet-spec-lane
description: "Contract for a spec-writing sub-agent. What it cannot reach, how many turns it actually has, and the flag-don't-guess rule — so a brief carries the story, not the rules."
---

# Fleet spec-lane contract

Invoke at the START of a `devedup-rl:spec-writer` spawn. Your brief then carries **one story and its
context** — not the rules. Sibling contract to `fleet-dev-lane`, which governs implementers/reviewers.

## Your budget is 30 TURNS, not 50

`devedup-rl:spec-writer` sets `maxTurns: 30` in its own definition — **20 fewer than an implementer.**
On 2026-09-04 three spec agents were briefed with "~40 turns" and all three hit the cap; two hit it
*during their own anchor-verification pass*, which is the most valuable thing they do.

Budget accordingly: **audit and verify anchors AS YOU WRITE**, not in a separate pass at the end. A pass
you never reach protects nothing. Batch independent greps into single messages — one grep per turn burns
a 30-turn budget in no time.

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
