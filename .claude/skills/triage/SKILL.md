---
name: triage
description: "Scan Sentry GitHub issues → deduplicate → trace to source → create Linear stories with full specs"
argument-hint: "[--dry-run | --issue <number>]"
allowed-tools: "Bash(gh issue *), Bash(gh label *), Bash(git log*), Bash(curl *), Read, Grep, Glob, mcp__linear__list_issues, mcp__linear__create_issue, mcp__linear__create_comment, mcp__linear__list_issue_labels"
---

# Triage — Sentry-to-Linear Pipeline with GitHub Status Sync

Scans Sentry-created GitHub issues, deduplicates by root cause, traces errors to source code, and creates Linear stories with full specs ready for `/dispatch`. Keeps GitHub issues in sync so customers following them have visibility.

**Linear Project:** Raid Ledger (ID: `1bc39f98-abaa-4d85-912f-ba62c8da1532`)
**Team:** Roknua's projects (ID: `0728c19f-5268-4e16-aa45-c944349ce386`)

---

## Step 0: Clean Up Resolved GitHub Issues

Before triaging new issues, check if any previously-triaged open Sentry issues can be closed because their linked Linear stories are Done.

### 0a. Fetch open triaged issues

```bash
gh issue list --state open --label triaged --label sentry --json number,title,comments --limit 100
```

If none found, skip to Step 1.

### 0b. Extract linked Linear story IDs

Parse each issue's comments for the `ROK-NNN` pattern from the triage comment (e.g., "Triaged → Linear ROK-631").

### 0c. Query Linear for story status

**Load `LINEAR_API_KEY` from `.env`:**
```bash
export $(grep '^LINEAR_API_KEY=' .env | xargs)
```

Query by exact issue numbers using the GraphQL API:
```bash
curl -s -X POST https://api.linear.app/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_KEY" \
  -d '{"query":"{ issues(filter: { number: { in: [NNN, MMM] }, team: { key: { eq: \"ROK\" } } }) { nodes { identifier title state { name } } } }"}'
```

### 0d. Classify each issue

| Linear Status | Action |
|---|---|
| **Done** | Close GitHub issue with resolution comment |
| **Not found** in Linear | Check `git log` for fix evidence in referenced source files; if fix shipped, close; otherwise flag for manual review |
| **In Progress / Backlog / other** | Leave open — still being worked |

### 0e. Present cleanup summary and get confirmation

```
## Resolved Issues — Ready to Close

| GitHub | Linear | Status | Action |
|---|---|---|---|
| #331 — Calendar highlight | ROK-631 | Done | Close |
| #278 — Discord interaction | ROK-540 | Fix shipped (commit abc123) | Close |
| #400 — Some bug | ROK-650 | In Progress | Skip |
```

Use `AskUserQuestion` to confirm before closing. Then for each approved issue:
```bash
gh issue close <num> --comment "## Resolved

This fix has been shipped.

**Linear:** [ROK-XXX](https://linear.app/roknua-projects/issue/ROK-XXX) — Done"
```

If no issues are ready to close, report that and continue to Step 1.

---

## Step 1: Fetch Untriaged Sentry Issues

Fetch all open issues and filter for Sentry-created ones that haven't been triaged:

```bash
gh issue list --state open --json number,title,body,author,labels,createdAt --limit 100
```

Filter client-side:
- `author.login == "app/sentry"` AND no `triaged` label
- If `$ARGUMENTS` contains `--issue <N>`: process only that single issue
- If no untriaged issues found, report "No untriaged Sentry issues" and stop (Step 0 cleanup still runs first)

**First run — create labels if missing:**
```bash
gh label create "triaged" --color "0E8A16" --description "Processed by /triage" --force
gh label create "sentry" --color "D93F0B" --description "Auto-created by Sentry" --force
```

---

## Step 2: Parse & Group by Root Cause

Parse each issue body to extract:
- **Sentry issue ID** from `Sentry Issue: [RAID-LEDGER-ALERTS-X](url)` line
- **Error type** (PostgresError, TypeError, Error, etc.)
- **Error message** (first line of code block)
- **Source files** (file paths from `File` lines, filtering out `node_modules/`)
- **Sentry link** (the URL)
- **Category**: classify each issue:
  - `stack-trace` — standard error with app-code stack trace
  - `performance` — N+1 query title with table body
  - `feedback` — has `source: feedback_widget` tag (from the feedback widget `captureMessage`)
  - `environmental` — EADDRINUSE, ETIMEDOUT, module not found

**Group issues** sharing the same **primary source file + error message pattern** into a single root cause. Example: 5 issues all showing `column "banned" does not exist` → one group.

---

## Step 3: Classify Severity

| Error Pattern | Priority | Disposition |
|---|---|---|
| Data integrity (unique constraint, failed insert) | P1 | Create story |
| Missing column/table (schema drift) | P1 | Create story |
| TypeError in app code | P2 | Create story |
| N+1 Query | P2 | Create story |
| TypeError in framework/node_modules | P3 | Create story or skip |
| EADDRINUSE, ETIMEDOUT, module not found | noise | Close |

---

## Step 3.5: Sentry API Enrichment

For each non-noise group, fetch rich context from the Sentry API to include in the Linear story.

**Load `SENTRY_AUTH_TOKEN` from `.env`** — the token lives in the project `.env` file, not the shell environment. At the start of this step, source it:
```bash
export $(grep '^SENTRY_AUTH_TOKEN=' .env | xargs)
```

**If `SENTRY_AUTH_TOKEN` is still not set after loading `.env`**, skip this step entirely and note in the triage summary that Sentry details were unavailable.

For each group:

1. Extract the Sentry issue ID from the parsed URL (already available from Step 2)
2. Call the Sentry API to fetch the latest event:
   ```bash
   curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
     "https://sentry.io/api/0/organizations/none-d10/issues/{issue_id}/events/latest/"
   ```
3. Extract from the response:
   - **Tags:** `feedback_category`, `deployment_host`, `app_version`, `source`
   - **Contexts → deployment:** `host`, `userAgent`, `screenResolution`, `viewport`, `locale`
   - **Contexts → feedback:** `pageUrl`, `category`, `feedbackId`
   - **Extra:** `clientLogs` (if present)
   - **Event metadata:** `dateCreated`, `user` (if available), number of occurrences
4. If a specific API call fails (e.g., 404 for an older issue), skip enrichment for that group and continue

Use the `source` tag to refine the category classification from Step 2:
- If `source == "feedback_widget"`, reclassify the group as `feedback`

---

## Step 4: Source Code Tracing

For each non-noise group:

1. Extract file paths + line numbers from stack traces
2. `Read` those source files to understand context around the error line
3. For missing column errors: `Grep` for the column name across the schema files
4. For N+1 queries: identify the service/controller making repeated queries
5. Check recent git history: `git log --oneline -10 -- <primary file>`

---

## Step 5: Check for Existing Linear Stories

```
mcp__linear__list_issues(project: "Raid Ledger", limit: 250)
```

Search results for title/description matching the same error or source file.

**If match found:**
- Add comment to existing Linear story: `"Additional Sentry occurrence: GitHub #XX — <sentry link>"`
- Label GitHub issue: `triaged`, `sentry`, `duplicate`
- Add comment to GitHub issue: `"Duplicate of existing story [ROK-XXX](url). Follow that story for status updates."`
- Close the GitHub issue
- Skip story creation for this group

---

## Step 6: Present Triage Summary

Display grouped issues with proposed severity and disposition. **Wait for user confirmation before creating anything.**

```
## Sentry Triage — N untriaged issues (M groups)

### Group 1: Missing `banned` column (P1 — schema drift)
  GitHub: #57, #58, #59, #60, #61
  Error: PostgresError: column "banned" does not exist
  Source: api/src/admin/settings.controller.ts:601, api/src/events/events.service.ts:286
  Root cause: Code references games.banned column that doesn't exist in DB

### Group 2: Duplicate signup constraint (P2 — missing conflict handling)
  GitHub: #50
  ...

### Noise — recommend close
  #45 (ETIMEDOUT), #46 (module not found), #47 (EADDRINUSE)

### Already tracked in Linear
  #39 → linked to ROK-XXX (existing story)
```

Use `AskUserQuestion` with options:
- **"Create all stories"** — create Linear stories for all non-noise groups
- **"Select which to create"** — let user pick which groups to create stories for
- **"Dry run only"** — stop here, no creation

If `$ARGUMENTS` contains `--dry-run`: show summary and stop (no creation).

---

## Step 7: Create Linear Stories + Link GitHub Issues

For each approved group:

### 7a. Create Linear Issue

```
mcp__linear__create_issue(
  title: "fix: <concise bug description>",
  description: <full spec template — see Story Template below>,
  teamId: "0728c19f-5268-4e16-aa45-c944349ce386",
  projectId: "1bc39f98-abaa-4d85-912f-ba62c8da1532",
  priority: <1=urgent, 2=high, 3=normal, 4=low>,
  state: "Dispatch Ready"
)
```

### 7b. Update GitHub Issues

**For the first (oldest) issue in the group** — this becomes the "canonical" tracking issue:
```bash
gh issue edit <num> --add-label "triaged,sentry,bug"
gh issue comment <num> --body "## Triaged → Linear ROK-XXX

This issue has been triaged and a fix is being tracked in our project management system.

**Status:** Backlog — queued for development
**Tracking:** [ROK-XXX](https://linear.app/roknuas-projects/issue/ROK-XXX)

We'll update this issue as progress is made. Related issues: #Y, #Z"
```

**For duplicate issues in the same group** (2nd, 3rd, etc.):
```bash
gh issue edit <num> --add-label "triaged,sentry,duplicate"
gh issue comment <num> --body "Duplicate of #<canonical>. Tracking fix in [ROK-XXX](https://linear.app/roknuas-projects/issue/ROK-XXX).

This issue reports the same root cause. Follow #<canonical> for status updates."
gh issue close <num>
```

**For noise issues** (user approved closing):
```bash
gh issue close <num> --comment "Closed — environmental/transient error, not an actionable bug."
gh issue edit <num> --add-label "triaged,sentry,wontfix"
```

---

## Step 8: Present Summary

```
## Triage Complete

Stories Created: N
  - ROK-XXX: fix: add missing banned column (P1) — GH #57 (canonical), #58-61 (dupes closed)
  - ROK-YYY: fix: handle duplicate signup constraint (P2) — GH #50

Existing Stories Updated: K
  - ROK-BBB: added GH #39 reference

Noise Closed: M
  - #45, #46, #47

GitHub Issues Triaged: total
```

---

## Linear Story Template

When creating Linear stories in Step 7a, use this template for the description:

Use the header **"User Feedback Report"** for `feedback` category issues, and **"Bug Report"** for all others.

**For `feedback` issues:**

```markdown
## User Feedback Report — <concise title>

**Source:** User feedback widget
**GitHub Issues:** #<canonical> (tracking), #<dup1>, #<dup2> (duplicates)
**Sentry:** [RAID-LEDGER-ALERTS-X](<url>)
**Severity:** P<N> — <rationale>

### User's Message

> <original feedback message from the Sentry event>

### Environment & Context

<!-- Only include this section when Sentry API enrichment succeeded (Step 3.5) -->

| Field | Value |
|---|---|
| **Deployment** | `<deployment_host>` |
| **App Version** | `<app_version>` |
| **Page URL** | `<pageUrl>` |
| **Browser** | `<userAgent — parsed to readable form>` |
| **Screen** | `<screenResolution>` / Viewport: `<viewport>` |
| **Locale** | `<locale>` |
| **Feedback Category** | `<feedback_category>` |
| **First Seen** | `<dateCreated>` |
| **Occurrences** | `<count>` |

### Client Logs

<!-- Only include if clientLogs extra data is present -->

\`\`\`
<clientLogs>
\`\`\`

### Root Cause Analysis

<2-4 sentences on what the user experienced and the likely underlying cause>

### Acceptance Criteria

- [ ] Issue addressed for the reported scenario
- [ ] <specific testable condition>
- [ ] Sentry confirms no new occurrences post-deploy

### Technical Approach

**Files to modify:**
- `<path/to/file.ts>:<line>` — <what changes>

**Suggested fix:**
<1-3 sentences on recommended approach>

### Context

- First reported: <date from GitHub issue creation>
- <N> occurrences across <M> GitHub issues
- Canonical GitHub issue: #<num> (customers may be following this)
```

**For `stack-trace`, `performance`, and other non-feedback issues:**

```markdown
## Bug Report — <concise title>

**Source:** Sentry auto-detection
**GitHub Issues:** #<canonical> (tracking), #<dup1>, #<dup2> (duplicates)
**Sentry:** [RAID-LEDGER-ALERTS-X](<url>)
**Severity:** P<N> — <rationale>

### Error Details

**Type:** <PostgresError | TypeError | Error | Performance>
**Message:**
\`\`\`
<error message>
\`\`\`

**Stack Trace (app frames):**
\`\`\`
<filtered stack trace — project files only, no node_modules>
\`\`\`

### Environment & Context

<!-- Only include this section when Sentry API enrichment succeeded (Step 3.5) -->

| Field | Value |
|---|---|
| **Deployment** | `<deployment_host>` |
| **App Version** | `<app_version>` |
| **Page URL** | `<pageUrl>` |
| **Browser** | `<userAgent — parsed to readable form>` |
| **Screen** | `<screenResolution>` / Viewport: `<viewport>` |
| **Locale** | `<locale>` |
| **First Seen** | `<dateCreated>` |
| **Occurrences** | `<count>` |

### Client Logs

<!-- Only include if clientLogs extra data is present -->

\`\`\`
<clientLogs>
\`\`\`

### Root Cause Analysis

<2-4 sentences explaining what is going wrong and why>

### Affected Endpoints/Features

- `<endpoint 1>` — <impact>
- `<endpoint 2>` — <impact>

### Acceptance Criteria

- [ ] Error no longer occurs in affected code paths
- [ ] <specific testable condition>
- [ ] Regression test exists for the scenario
- [ ] Sentry confirms no new occurrences post-deploy

### Technical Approach

**Files to modify:**
- `<path/to/file.ts>:<line>` — <what changes>

**Suggested fix:**
<1-3 sentences on recommended approach>

**Database changes:** <yes/no — describe migration if yes>
**Contract changes:** <yes/no — describe schema changes if yes>

### Context

- First reported: <date from GitHub issue creation>
- <N> occurrences across <M> GitHub issues
- Canonical GitHub issue: #<num> (customers may be following this)
```

---

## GitHub → Linear Status Mapping

The `/dispatch` skill handles ongoing status sync from Linear back to GitHub. When `/dispatch` processes a triaged story, it updates the canonical GitHub issue at each pipeline stage:

| Linear Status | GitHub Issue Action |
|---|---|
| Backlog (created by /triage) | Comment: "Triaged — queued for development" |
| In Progress | Comment: "A developer is actively working on a fix" |
| In Review | Comment: "Fix submitted, PR created with auto-merge" |
| Changes Requested | Comment: "Issues found, fix being revised" |
| Done | Close issue with resolution comment |

See `/dispatch` SKILL.md for the GitHub sync implementation at each pipeline step.
