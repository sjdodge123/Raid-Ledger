---
name: readlogs
description: "Read Raid Ledger admin logs from ~/Downloads AND parse TECH-DEBT-BACKLOG.md at repo root. Context-aware: cold session → full deep-dive sweep across both sources with cross-source reconciliation (a file flagged in BOTH logs and backlog is elevated signal), then draft Linear stories; mid-task → search both sources for clues relevant to the active work."
argument-hint: "[--triage | --troubleshoot] [--service api|nginx|postgresql|redis|supervisor] [--file <name>] [--since <ISO|relative>] [--query <regex>] [--backlog-only | --no-backlog] [--severity high|med|low|nit]"
allowed-tools: "Bash(ls *), Bash(stat *), Bash(file *), Bash(tar *), Bash(gunzip *), Bash(zcat *), Bash(grep *), Bash(rg *), Bash(awk *), Bash(sort *), Bash(uniq *), Bash(wc *), Bash(head *), Bash(tail *), Bash(cut *), Bash(tr *), Bash(find *), Bash(git status*), Bash(git branch*), Bash(git log*), Bash(git diff*), Bash(git rev-parse*), Bash(git add*), Bash(git commit*), Read, Edit, Grep, Glob, mcp__linear__list_issues, mcp__linear__list_issue_labels, mcp__linear__save_issue, mcp__linear__save_comment"
---

# /readlogs — Read admin log exports + TECH-DEBT-BACKLOG.md

This skill has TWO inputs:

1. **Admin log exports** in `~/Downloads` — produced by the Raid Ledger admin Logs panel (`web/src/pages/admin/logs-panel.tsx`). Either individual rotated `.log` files or a `logs-*.tar.gz` bundle.
2. **`TECH-DEBT-BACKLOG.md`** at the repo root — appended by `/build` and `/dispatch` reviewer reports during PR shipping. Contains deferred findings that the operator has not yet triaged.

Triage mode reads BOTH sources, reconciles overlapping signals (a file flagged in both logs AND backlog is treated as elevated), and produces a single ranked list of recommended stories for the operator to approve.

The skill behaves differently depending on whether the conversation is **cold** (just started, no active task → triage mode) or **warm** (mid-task → troubleshoot mode).

**Linear Project:** Raid Ledger (`1bc39f98-abaa-4d85-912f-ba62c8da1532`)
**Team:** Roknua's projects (`0728c19f-5268-4e16-aa45-c944349ce386`)

---

## Step 1 — Discover candidate log files in `~/Downloads`

Match these patterns (services align with `LogService` in `packages/contract`):

| Service | Filename glob |
|---|---|
| Bundle export | `logs-*.tar.gz` |
| api | `api*.log`, `api (*).log` |
| nginx | `nginx-access*.log`, `nginx-error*.log`, `nginx*.log` |
| postgresql | `postgresql*.log` |
| redis | `redis*.log` |
| supervisor | `supervisor*.log` |

```bash
ls -lat ~/Downloads/ | awk '{print $6,$7,$8,$9}' | grep -iE '(^|\s)(logs-[0-9].*\.tar\.gz|(api|nginx[-a-z]*|postgresql|redis|supervisor)( \([0-9]+\))?\.log)$'
```

**Selection rules:**
- Default: take the **most-recent file per service** (mtime), keeping ones modified within the last 7 days.
- If `--file <name>` is provided, use exactly that file.
- If `--service <name>` is provided, restrict to that service.
- If `--since <ts>` is provided, drop anything older.
- If a `logs-*.tar.gz` is the freshest artifact, extract it to a temp dir (`mktemp -d`) and treat its contents as the canonical set, ignoring the loose `.log` files.

**If nothing matches:** Tell the operator no recent admin-log downloads were found, suggest they download from the admin Logs panel ("Export .tar.gz" or per-service "Download"). Then continue to Step 1b — the backlog may still have entries worth triaging. Only stop entirely if BOTH sources are empty (and `--backlog-only` was not passed).

Print the resolved file list (path + size + mtime) before proceeding.

---

## Step 1b — Locate and parse the tech-debt backlog

Skip this step if `--no-backlog` was passed.

```bash
BACKLOG="$(git rev-parse --show-toplevel)/TECH-DEBT-BACKLOG.md"
```

Read everything after the `<!-- agents append below this line -->` marker. Parse using this schema (defined in the file's own "Format for skills that parse this file" section):

- Section header: `### YYYY-MM-DD — <branch> (PR #<num>)` — the PR ref is optional
- Bullet: `- **[<sev>]** ` followed by an inline-code path (`` `path/to/file.ts:42` ``) and free-text description
- Optional `Suggested:` line indented two spaces under the bullet

Severities: `high` / `med` / `low` / `nit`.

**Apply the `--severity` filter** (default: `med` — drops `low` and `nit` unless explicitly asked). `--severity nit` includes everything.

**If the file is missing, has no entries below the marker, or all entries are below threshold:** state which (e.g., "backlog absent" / "0 entries above med") and continue without backlog candidates. Do NOT block on an empty backlog.

Print parsed counts before continuing — e.g., `Parsed 7 backlog entries: 1 high, 3 med, 2 low (filtered out), 1 nit (filtered out)`.

If `--backlog-only` was passed, skip the log discovery in Step 1 and treat the backlog as the only input.

---

## Step 2 — Detect mode (context awareness)

Mode determines what we do with the logs.

**`triage` mode (cold session)** is the default when ALL of these are true:
- Argument does NOT include `--troubleshoot`.
- Current git branch is `main` (or detached HEAD with no work).
- No active `TaskList` items in this conversation.
- No `planning-artifacts/specs/ROK-*.md` modified in the last hour.
- The conversation so far does not reference a specific Linear story (`ROK-NNNN`), error, file path under active edit, or running dev server.

**`troubleshoot` mode (warm session)** is used when ANY of:
- `--troubleshoot` was passed.
- Current branch is a story branch (`ROK-*`, `feat/*`, `fix/*`, etc.).
- The operator has open tasks or recent edits.
- The conversation references a specific failing test, exception, endpoint, or feature.

If `--triage` or `--troubleshoot` is explicitly passed, that overrides the heuristic.

State the chosen mode in one sentence before continuing.

---

## Step 3a — Triage mode (cold session)

Goal: surface durable, actionable engineering work. **Do NOT propose stories about reducing log volume, log levels, or "noisy logging" — the operator wants the logs.**

**Triage mode is always a deep dive.** Do not short-circuit to the first obvious signal, announce "nothing else" after a shallow pass, or present findings before the full sweep below is complete. The operator would rather wait a few extra minutes than be handed a thin list and forced to prompt for a second pass. Run the full sweep in 3a.i, write up the observations in 3a.ii, THEN draft stories.

### 3a.i — Mandatory full sweep

Walk the checklist below end to end. If a file is missing (e.g., no postgresql/redis in the bundle), note that explicitly and move on — do not skip silently. Strip ANSI color codes first on any api output: `sed -E $'s/\x1b\\[[0-9;]*m//g'`.

**A. api log — errors & app health**
- WARN/ERROR/FATAL/Unhandled/Exception total count
- Group by Nest module tag (`\[[A-Z][A-Za-z0-9_]+\]` after the timestamp) to see which services are noisy
- Normalize messages (strip UUIDs, timestamps, numeric IDs) and rank top 40 by frequency
- Search for stack traces (`at [A-Z][a-zA-Z]+\.`, `UnhandledPromiseRejection`, `DeprecationWarning`)
- Network failure codes: `ECONNREFUSED`, `ETIMEDOUT`, `ENOTFOUND`, `EADDRINUSE`, `socket hang up`, `circuit`
- App restarts within window: `Bootstrapping`, `NestFactory`, `Application listening`, `Started in [0-9]+ms`

**B. api log — performance surface (`[PERF]` output)**
- Break out event type counts: `grep -oE '\[PERF\] [A-Z]+ \| [A-Za-z_/]+' | sort | uniq -c | sort -rn`
- DB query histogram: frequency per `table=` (top 20). Investigate any table with >5k hits over a short window — likely a hot-path query or chatty cron.
- Slowest DB queries: extract durations `DB \| query \| ([0-9]+)ms`, sort descending, review anything ≥100ms
- HTTP request durations ≥500ms (exclude CRON lines): endpoint + latency + status
- CRON job outliers: durations ≥1000ms OR `status != completed|no-op` — review what the service actually did
- **HEAP trend:** extract `heapUsedMB=` and `rssMB=` over the window, report min/max/avg. Flag any monotonic growth (leak signal) vs stable oscillation (healthy).

**C. api log — cadence & window**
- First timestamp + last timestamp (confirm log window)
- Per-cron cadence: sample 3 consecutive timestamps per cron job to confirm expected schedule (every-30s, every-1m, every-5m, every-15m, hourly, daily)
- Look for cron iterations that are missing from the expected cadence (potential scheduler pause / event-loop block)

**D. nginx-access — traffic shape**
- Status distribution: `awk '{print $9}' | sort | uniq -c | sort -rn`
- Top 25 paths: `awk '{print $7}' | sort | uniq -c | sort -rn | head -25` — identify healthcheck chatter, N+1 client patterns, top endpoints
- Top client IPs: `awk '{print $1}' | sort | uniq -c | sort -rn` — separate internal (127.0.0.1, 172.17.0.1, Docker bridges) from real traffic
- Top user agents: `awk -F'"' '{print $6}' | sort | uniq -c | sort -rn` — detect scrapers, bots, missing browsers
- Enumerate paths for every 4xx/5xx: `awk '$9 ~ /^[45]/ {print $9, $7}' | sort | uniq -c | sort -rn`
- Per-hour request rate: `awk '{print $4}' | sed -E 's/\[//' | cut -d: -f1-2 | sort | uniq -c | sort -rn | head -10` — spot spikes / dead periods
- Non-health (real app) traffic count — separates healthcheck noise from actual user load
- Any response-size outliers (column 10 in Combined format) if the format carries them

**E. postgresql log** (only if a fresh file exists — note absence if stale)
- Any `ERROR:`, `FATAL:`, `PANIC:` lines
- Deadlocks, lock waits, `could not serialize access`
- Long-running queries / statement timeouts
- Connection spikes / auth failures / role issues
- Vacuum / autovacuum warnings

**F. redis log** (only if fresh)
- `WARNING`, `MISCONF`, `OOM`, eviction notices, persistence (RDB/AOF) warnings
- Slowlog entries if present
- Replication / cluster state if applicable

**G. supervisor log** (only if fresh)
- Child process `EXITED`, `FATAL`, `crashed`, restart loops
- Count per program + timestamps

**H. Cross-file correlation (within logs)**
- For every nginx 5xx: timestamp-match against api log for the concurrent exception
- For every api `[ItadHttp]`-style external-API warning cluster: match against the consuming cron's `status=` line
- For every cron duration outlier (≥10× baseline): match against concurrent DB query slowdown or external-API errors
- For every long request (nginx `$request_time` or api HTTP latency): match to the DB queries or external calls it spawned

**I. TECH-DEBT-BACKLOG.md (parsed in Step 1b)**
- Group entries by file path. **Same path flagged in multiple batches = strong recurring signal**, treat as elevated regardless of original severity.
- Group by severity: `high` items always promote to candidates, `med` per investigation, `low` only with `--severity low`, `nit` only with `--severity nit`.
- Note any reviewer suggestion (`Suggested:` line) — that's the on-call engineer's first-pass fix idea, useful for the story body's `## Fix` section.

**J. Cross-source reconciliation (logs ↔ backlog)**

This is the highest-value pass. For every backlog entry, check whether the same file or module surfaces in the log analysis from sections A–H.

- **Direct match:** backlog entry path == file in a log stack trace, slow query path, or perf hot-path → **MERGE into a single elevated candidate**. Severity bumped one level (med → high, low → med). The story body gets BOTH the prod evidence (frequency, timestamps from logs) AND the review evidence (reviewer's date and suggestion from backlog).
- **Module match:** backlog mentions a NestJS module (e.g., `EventsService`, `NotificationsModule`) that's the noisiest tag in section A → merge similarly.
- **Symptom match:** backlog mentions `retry`, `timeout`, `null check`, `race`, etc., and the same symptom shows in section A/B → merge.
- **No log match for backlog entry** → keep as candidate on its own merits, severity per backlog.
- **No backlog match for log finding** → existing flow (candidate from log only).

A merged candidate is the most defensible kind of story: observed in production AND independently flagged in code review. Surface them at the top of the triage table.

### 3a.ii — Write up the sweep (REQUIRED — before drafting stories)

Produce a short analysis summary **per log file** covering every dimension from 3a.i. Even dimensions that are clean get a line — the operator needs to know you actually checked, and a "clean" axis is itself a data point.

Format roughly:

```
### api.log — <first-ts> → <last-ts>, <N> lines
- Errors: WARN=<n> ERROR=<n> FATAL=<n>, noisiest module: <module>
- Top normalized messages:
  1. "<msg>" × <n> (<module>)
  2. ...
- Perf: <top event types>
- DB: <top tables>; slowest query <n>ms; queries ≥100ms: <n>
- HTTP: requests ≥500ms: <path/latency>
- CRON: outliers <service/duration>; any non-completed <list>
- HEAP: heapUsed <min>-<max> MB, RSS <min>-<max> MB — <stable|growing|oscillating>
- Cadence: <cron schedules confirmed>
- Restarts: <yes/no within window>

### nginx-access.log — <n> requests over <window>
- Status: <distribution>
- Path mix: <healthcheck share> / <real traffic count>
- 4xx/5xx paths: <breakdown>
- Client IPs: <internal vs external>
- UA diversity: <summary>
- Hour-by-hour: <peaks / dead periods>

### postgresql.log — <window or "stale/absent">
- ...
### redis.log — <window or "stale/absent">
- ...
### supervisor.log — <window or "stale/absent">
- ...

### TECH-DEBT-BACKLOG.md — <N> entries above threshold (<oldest-section> → <newest-section>)
- Severity mix: high=<n> med=<n> low=<n filtered> nit=<n filtered>
- Recurring file paths (flagged in ≥2 batches): `<path>` × <n>, `<path>` × <n>
- Cross-source matches with logs: <count>; e.g., `<path>` flagged in backlog 2026-04-22 + appears in api errors as <module> noisiest tag
- Backlog-only candidates (no log overlap): <count>
- Backlog absent / empty / all below threshold: <state if applicable>
```

This write-up is for the operator. Keep it tight but complete.

### 3a.iii — Candidate enumeration (all findings, not just stories)

List every observation from 3a.ii that has ANY engineering signal as a candidate. Candidates come from BOTH log findings AND backlog entries — treat each backlog entry as a pre-flagged candidate that still needs the same investigate-before-write step in 3a.iv.

**Source tags** (record on each candidate):
- `[log]` — derived purely from log analysis
- `[backlog]` — derived purely from a backlog entry, no log overlap
- `[merged]` — cross-source match from Section J (elevated severity, strongest signal)

Surface `[merged]` candidates first when presenting in 3a.v. Include even borderline ones. Do not filter yet. Typical candidate classes:

| Pattern | Category | Linear prefix | Area label hint |
|---|---|---|---|
| Recurring exception in app code | bug | `fix:` | feature area from stack frame |
| External API flake swallowed by client (no retry / misleading success) | tech debt / reliability | `tech-debt:` | consuming feature area |
| Slow query / repeated identical query / N+1 | perf | `perf:` | `Database` or feature module |
| Chatty endpoint (hot path getting called >10× expected rate) | perf | `perf:` | consuming feature area |
| Healthcheck doing real work (DB/Redis round-trips) on every poll | tech debt | `tech-debt:` | `Infrastructure` |
| Heap growth / memory leak signal | bug | `fix:` | feature area |
| Cron skipped / blocked / silently degraded | bug | `fix:` | feature area |
| Misleading `status=completed` when batches failed | tech debt / observability | `tech-debt:` | feature area |
| Deprecation warning, unhandled rejection in non-critical path | tech debt | `tech-debt:` | feature area |
| Config drift, dead env var, missing optional service | chore | `chore:` | `Infrastructure` |
| Postgres deadlock / lock contention | bug or tech debt | `fix:` / `tech-debt:` | `Database` |
| Redis eviction / persistence errors | bug or chore | `fix:` / `chore:` | `Infrastructure` |
| Supervisor child restart loop | bug | `fix:` | `Infrastructure` |
| One-off transient (single ETIMEDOUT, single restart, single blip) | noise | — | skip |

**Always exclude:** "reduce logging", "lower log level", "silence noisy logs", "rotate faster", "trim verbose output". The operator explicitly does not want these. If a candidate's only suggested action would be to log less, drop it.

### 3a.iv — Investigate each candidate before drafting (STRICT)

Per `feedback_investigate_before_stories.md`: do NOT write a story from grep output alone. For each candidate from 3a.iii:

- Read the file referenced by the stack frame / module tag. Confirm the behavior is reachable in current `main` (not already fixed).
- `git log --oneline -10 -- <file>` — scan for a recent fix matching the signal.
- `mcp__linear__list_issues` (project: Raid Ledger) — search by file name, module name, AND by error keyword. If an open story covers the same root cause, plan to **append evidence as a comment** rather than create a duplicate.
- Decide severity: Urgent (1) only for production outages or data loss; High (2) for reliability regressions affecting users; Medium (3) for silent degradation / observability gaps / meaningful perf; Low (4) for minor cleanup.

Write the decision per candidate internally before surfacing to the operator: **promote to story / demote to observation / defer (comment on existing story) / drop as noise**. Include a one-line reason for demotions so the operator can override.

### 3a.v — Present full triage summary, wait for approval

Now (and only now) present to the operator. Include:

1. The 3a.ii sweep summary (so the operator can see what you checked).
2. A table of every **promoted** story candidate: title, category, severity, occurrence count, source files, one-line evidence snippet.
3. A short list of **demoted** observations (chatty endpoints, minor perf, nice-to-haves) so the operator can green-light any of them.
4. Any **matched existing stories** where you plan to comment rather than duplicate.
5. Ask the operator which to create (use `AskUserQuestion` if the list is ≥3 items). Phrase the ask so the operator can approve all, approve a subset, or add a demoted item.

### 3a.vi — Create approved stories AND prune the backlog

For each approved finding:
- Title prefix: `fix:` / `perf:` / `tech-debt:` / `chore:`
- `mcp__linear__save_issue` with: project Raid Ledger, team Roknua's projects, state `Backlog`, priority by severity, **one Area label** (see `area-labels.md` in MEMORY).
- Body must include:
  - `## What`
  - `## Evidence` — for `[log]` and `[merged]`: excerpt + occurrence count + timestamps. For `[backlog]` and `[merged]`: backlog section date + reviewer's verbatim entry. **`[merged]` candidates always include both blocks**, clearly labeled.
  - `## Root cause` — source file:line + explanation
  - `## Fix` — concrete approach (use the backlog `Suggested:` line as a starting point if present)
  - `## Acceptance criteria` — bulleted, at least one of the form "no occurrences in fresh log export ≥7 days post-deploy" for `[log]`/`[merged]` candidates
  - `## Out of scope` if adjacent stories exist
- For matched-existing stories: `mcp__linear__save_comment` with the new evidence and timestamps.

**Prune the backlog file** for every entry that was promoted to a Linear story OR that the operator explicitly dropped:

1. Open `TECH-DEBT-BACKLOG.md` at the repo root.
2. Delete the corresponding bullet (and any `Suggested:` line beneath it).
3. If a section header now has no remaining bullets, delete the section header too.
4. Stage and commit:
   ```bash
   git add TECH-DEBT-BACKLOG.md
   git commit -m "chore(config): prune triaged tech-debt entries (ROK-XXX, ROK-YYY)"
   ```

Backlog entries that the operator wanted to keep for later (deferred, not dropped) stay in the file. Demoted-to-observation entries that the operator did NOT explicitly keep are pruned — if the same signal recurs in a future batch's review, the reviewer will append it again.

Print a final summary listing each created `ROK-NNN` (with `[log]` / `[backlog]` / `[merged]` source tag), any comments appended, and the count of backlog entries pruned.

---

## Step 3b — Troubleshoot mode (warm session)

Goal: pull facts out of the log that help with whatever is actively being worked on. Do **not** create Linear stories in this mode unless explicitly asked.

### 3b.i — Build a search dossier from active context

Collect anchors from the conversation:
- Active branch name + last commit subject.
- Open `TaskList` titles.
- Files recently edited or read in this session.
- Any error message, stack trace, endpoint, or Linear story ID the operator mentioned.
- If `--query <regex>` was passed, use it verbatim as an extra anchor.

### 3b.ii — Search logs AND backlog for those anchors

For each anchor, run targeted greps with timestamp context (`grep -nE -C 3`) against the log files. Prefer:
- Exact endpoint / route path matches (`GET /api/...`, `POST /api/...`).
- Class/function names from stack frames (`UsersService.findById`, `EventsController.cancel`).
- Linear ID in commit messages or feature flags (e.g., `ROK-1065`).
- Discord interaction IDs / event IDs / signup IDs the operator named.

Cross-reference api ↔ nginx for request-side correlation (match by timestamp + path), and api ↔ postgresql for query-side correlation (match by timestamp + table).

**Also grep the backlog** — if `TECH-DEBT-BACKLOG.md` mentions any of the anchored file paths, modules, or symptoms, surface those entries inline. A reviewer flagging the same area weeks ago is highly relevant context for whatever the operator is debugging now. Do NOT prune backlog entries in troubleshoot mode; they're informational only.

### 3b.iii — Report findings inline

Respond with:
- A concise narrative of what the logs show that's relevant to the active task.
- Direct quotes (with line numbers and timestamps) for each material hit.
- A list of "didn't find" anchors so the operator knows what is absent.
- Optional: 1–3 follow-up actions (e.g., "the failing assertion in `events.cancel` matches a `null user_id` in the log at 12:04:31 — check the seed data").

Do **not** open Linear stories from troubleshoot mode unless the operator says so.

---

## Step 4 — Cleanup

- If a `.tar.gz` was extracted to a temp dir, delete it.
- Do NOT delete the original downloaded files in `~/Downloads`; the operator manages those.

---

## Quick reference

```text
/readlogs                      # auto-detect mode, both sources (logs + backlog)
/readlogs --triage             # force triage even mid-task
/readlogs --troubleshoot       # force troubleshoot even on main
/readlogs --service api        # only the api log (still includes backlog unless --no-backlog)
/readlogs --file "api (30).log"
/readlogs --since "2026-04-20"
/readlogs --query "EventsController.cancel"
/readlogs --backlog-only       # skip log discovery entirely; only triage TECH-DEBT-BACKLOG.md
/readlogs --no-backlog         # ignore the backlog; behave like the original log-only flow
/readlogs --severity high      # backlog filter; default is med (drops low + nit)
/readlogs --severity nit       # include every backlog entry, even style nits
```
