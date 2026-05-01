---
name: security-review
description: "Security review via Codex CLI — pending branch changes against main. Replaces Anthropic's built-in security-review."
argument-hint: "[--against <branch>] [--path <subpath>]"
---

# Security Review (Codex-driven)

Runs `codex review` against the current branch with a security-focused prompt. Different model than Claude = different blind spots; for security work that's a feature, not a bug.

This file shadows Anthropic's built-in `/security-review` skill at the project level.

---

## When to use

- Before pushing a branch that touches `auth`, `users`, `admin`, `api/src/security/**`, `api/src/encryption/**`, anything handling sessions/tokens/keys, or `Dockerfile*` / `nginx/**`.
- After landing a third-party dependency that surfaces in request handling.
- Operator-triggered ad-hoc security audit.

If the diff doesn't touch any sensitive area, you don't need this — `/code-review` or the Codex pass in `/build` step-4b is enough.

---

## Prerequisites

```bash
which codex >/dev/null 2>&1 || { echo "codex CLI not found — install via OpenAI Codex subscription"; exit 1; }
git rev-parse --abbrev-ref HEAD | grep -qv '^main$' || { echo "Refusing to security-review main branch"; exit 1; }
```

---

## Step 1: Determine scope

Default: review the entire branch diff against `main`. Override:

- `--against <branch>` — review against a different base (e.g. a feature branch)
- `--path <subpath>` — narrow to one path (e.g. `api/src/auth/**`)

```bash
BASE="${ARG_AGAINST:-main}"
PATH_FILTER="${ARG_PATH:-}"

git fetch origin "$BASE"
git diff "origin/$BASE..HEAD" --stat | tail -1
```

---

## Step 2: Run Codex with the security prompt

```bash
SHA=$(git rev-parse --short HEAD)
OUTPUT="planning-artifacts/security-review-${SHA}.md"
mkdir -p planning-artifacts

codex review --base "$BASE" "$(cat <<'PROMPT'
Security-focused review of this Raid-Ledger PR. Focus exclusively on:

1. **Authentication & authorization**
   - Missing auth guards on new routes/controllers
   - Role/permission checks bypassed or weakened
   - JWT / session token handling regressions
   - Admin-only endpoints accidentally exposed
2. **Input validation & injection**
   - Zod schemas missing or weakened on new boundaries
   - SQL injection risk in raw `db.execute(sql\`\`)` blocks
   - XSS risk in React components rendering user-supplied HTML
   - Path traversal in file operations
   - Unvalidated redirects
3. **Secrets & credentials**
   - Hardcoded secrets, API keys, JWT signing keys
   - Logged credentials, tokens leaked into stdout
   - Environment variables echoed in logs or error messages
4. **Cryptography & encryption**
   - Weak hashing (md5, sha1) for security purposes
   - Insecure random sources for tokens/IDs
   - Hand-rolled crypto instead of project's encryption module
5. **Dependency / supply chain**
   - New deps added with unusual install scripts
   - Pinned versions vs floats on security-critical deps
6. **Discord bot specific**
   - User input from Discord rendered without escaping
   - Bot token / webhook URL exposure
   - Command handlers without permission checks
7. **Infrastructure (if Dockerfile/nginx/supervisor changed)**
   - Privilege escalation paths
   - Exposed ports / services
   - Default credentials in compose files

Skip style nits, naming preferences, doc gaps, performance, code-organization.

For each finding output:
- **Severity:** CRITICAL | HIGH | MEDIUM | LOW
- **File:Line**
- **One-line description**
- **Suggested fix or mitigation**

Final line MUST be one of: `VERDICT: SAFE TO MERGE`, `VERDICT: SAFE WITH FIXES`, or `VERDICT: BLOCK MERGE`.
PROMPT
)" 2>&1 | tee "$OUTPUT"
```

---

## Step 3: Read the verdict

```bash
tail -1 "$OUTPUT"
```

- **`VERDICT: SAFE TO MERGE`** — no security blockers. Proceed.
- **`VERDICT: SAFE WITH FIXES`** — operator-eyes pass on the findings; if comfortable, fix and re-run.
- **`VERDICT: BLOCK MERGE`** — present each CRITICAL/HIGH finding to the operator. Do NOT merge until either fixed or operator explicitly accepts the risk in writing.

---

## Step 4: Capture in PR (if applicable)

If a PR is open for the branch:

```bash
gh pr view --json number -q '.number' | xargs -I {} gh pr comment {} -F "$OUTPUT"
```

So the security pass is part of the PR's audit trail, not just a local file.

---

## When Codex misbehaves

If Codex output is empty / malformed / errored:

1. Re-run once. Most issues are transient (rate limits, network).
2. If it fails twice, fall back to running `/code-review` with a security focus prompt — it'll be slower and lower-fidelity but better than nothing.
3. Never skip security review on auth/admin changes just because the tooling failed. Operator calls the shot.

---

## Why Codex over Claude here

Codex catches a different distribution of security issues than Claude — different training data, different scoring. For security work specifically, you want diversity of opinion. The cost is ~30-90s of wall time and one Codex call against your $20 monthly subscription. Cheap insurance.
