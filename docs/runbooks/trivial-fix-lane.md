# Trivial-fix fast lane — full rules

> **Moved verbatim from `CLAUDE.md` on 2026-11-24 (ROK-2307)** to keep the always-loaded
> instructions small. CLAUDE.md keeps each rule's binding statement and points here; the text
> below is the full original rule, unchanged apart from heading levels. Change both together.

### Trivial-fix fast lane (STRICT — applies to ALL agents and the /build, /fix-batch, /push skills)

The gates below were sized for risky multi-file feature work. Applied unchanged to a 4-line fix they compound into hours of ceremony for minutes of code. The `trivial` tier closes the cliff between `light` (≈no verification) and `standard` (the full gauntlet). **This section is the canonical definition; the skills reference it.**

**A change is `trivial` only if ALL hold:**

1. ≤ ~30 net changed lines, AND
2. a single source file (optionally plus its co-located test), AND
3. touches NONE of: `packages/contract/**`, `api/src/drizzle/migrations/**`, `Dockerfile*` / `nginx/**` / `docker-entrypoint*`, `api/src/auth/**`, or admin/crypto/payments/secret-handling paths, AND
4. is a pure logic / copy / style / config / constant fix — **not** net-new feature behavior and **not** a new or relocated user-facing flow.

If any condition fails it is `standard` (unchanged). **When in doubt, it is `standard`.**

**A `trivial` fix SKIPS:**

- Worktree + `npm install` + dev-agent spawn → **the Lead edits directly** (extends [[feedback_lead_does_small_fixes]] from 1–3 lines to the trivial tier).
- TDD-failing-test-first ceremony → the **lightest proportionate test** (one unit assertion / one added case); a behavior-neutral diff needs none.
- The single-story "batch" branch ceremony → **PR the fix branch directly**.
- The second reviewer + architect → **exactly one review pass** (Codex pre-push).
- **Human gates, tiered by blast radius:** a **non-UI** trivial fix skips the Chrome MCP e2e gate AND the operator FULL STOP (the operator reviews the PR diff instead). A **cosmetic-UI** trivial fix gets a single screenshot on the already-running env (no `--rebuild`, no full flow-drive). Anything touching a rendered flow, auth, contract, migration or infra keeps the **full** gate — those protections (e.g. the Chrome MCP gate after the ROK-1237 UI break) are unchanged where they earned their place.

**Spike review tier (operator ruling 2026-09-14):** a branch whose diff touches ONLY `docs/**` and `web/src/dev/**` (DEMO_MODE-gated wireframes/galleries) gets the Codex pass and nothing else — no devedup reviewer, no architect. Nothing in it ships to users; the operator reviews the design by looking at it (a devedup review of the ROK-1555 spike cost ~70k tokens for cosmetic notes on a dev-only panel). Any file outside those two paths puts the branch back on the normal review path.

**A `trivial` fix KEEPS (non-negotiable):**

- `validate-ci.sh --static` (build + tsc + lint), scoped to the changed workspace.
- The full **GitHub CI** suite — the real gate; auto-merge-squash blocks until green.
- One review pass (Codex pre-push).
- A regression test for any **Bug** — at the **lightest tier that proves the fix** (a unit assertion is sufficient; no mandatory integration/Playwright spec for a one-liner).
- Every safety guardrail: never-weaken-assertions, no `sleep()`, document-pre-existing-failures, operator-config ride-along, code-size limits, and all migration/infra/boot-script rules.
