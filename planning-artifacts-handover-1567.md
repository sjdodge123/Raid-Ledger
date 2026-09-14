# ROK-1567 — handover (dev-1567)

Branch `chore/rok-1567-cheap-task-waits`, worktree `/Users/sdodge/Documents/Projects/Raid-Ledger--fleet-1567`.
**Complete — all three clusters landed, suite green, nothing left red.** Not pushed, no PR (per brief).

## Commits
- `d6b3b96c` Cluster A — brief `rl_task_status` + ADMIN_PASSWORD redaction
- `d8ca5784` Cluster B — `rl-task-wait` CLI + README push-notify update
- (this one) Cluster C — wait path pinned to full payload; liveness fields kept brief-visible

## What changed
- **`src/tools/task-brief.ts` (new leaf module)** — `redactCmd()`, `shouldDefaultBrief()`,
  `applyStatusProjection()`, `BRIEF_FIELDS`. Re-exported from `task.ts`.
- **`executeStatus`** gained `brief?: boolean`. Default: true while non-terminal
  (`running`/`queued`/`waiting`), false once terminal or on an error envelope.
  Brief drops `cmd`/`env`/`cwd`/`log_path`/`log_url`/`log_tail`.
- **Redaction runs in EVERY mode** over `cmd[]`, `args_summary` and `env` values:
  `*ADMIN_PASSWORD=<bare|'…'|"…">` → `*ADMIN_PASSWORD='***'`.
- **`src/tools/task-wait-cli.ts` (new)** + `bin: {"rl-task-wait": "src/tools/task-wait-cli.ts"}`.
- **`rl-infra/README.md`** — push-notify paragraph now points at `npx rl-task-wait <id>` with
  `run_in_background: true`, plus the bash-readable `~/.raid-ledger/tasks/local-<id>.json` note.

## Decisions a reviewer should know
1. **`last_output_at` / `last_line` / `progress_hint` were ADDED to the brief field set** beyond the
   brief's enumerated list. They are one short line each and are the only "working vs hung" signal;
   without them `task-extensions.spec.ts` went red for the right reason.
2. **`executeWait` passes `brief:false` at all five internal `executeStatus` call sites.** Brief
   leaking into the wait path emptied `log_tail`, and the existing test
   `still_running log_tail is truncated to the small (~6KB) default` then passed VACUOUSLY
   (`0 <= 6144`). Now pinned by a positive assertion in `task-brief.spec.ts`. This is the
   revert-proof: removing any of those `brief:false` flags turns that test red.
3. **`env` values are redacted too**, slightly beyond the brief's letter — same secret, same boundary.
4. Timeout accounting in the CLI is counted in INTERVALS, not off `Date.now()`: a wall-clock deadline
   plus an injectable instant `sleep` is an infinite loop (it SIGABRT'd the vitest worker once).

## Verification
- `cd tools/mcp-rl-fleet && npx vitest run` → **40 files / 425 tests passed**.
- `npx tsc --noEmit` → clean.
- CLI smoke: `npx tsx src/tools/task-wait-cli.ts` → usage line, exit 2.
- **Lint:** the package has no eslint config; its `lint` script is `echo 'lint passed'`. Root
  `prettier --check` warns on these files, but it warns on the pre-existing `task.ts` / `index.ts`
  too (no repo-root prettier config), so the package is simply not prettier-formatted — I did NOT
  run `--write`, which would have reformatted whole untouched files.

## Not done / follow-ups
- `rl_task_wait`'s own still_running envelope is unchanged (still ~6KB `log_tail`) — deliberate.
- The `bin` link only exists after an `npm install` at the repo root; the README documents the
  `npx tsx tools/mcp-rl-fleet/src/tools/task-wait-cli.ts <id>` fallback.
- MCP server restart required before agents see the new `brief` param.

## Review fixes (2026-09-14, SHIP WITH FIXES)

All findings from `planning-artifacts/review-ROK-1567.md` applied on the same branch.
Suite after: **40 files / 431 tests pass**, `npx tsc --noEmit` clean.

- **MAJOR 1 — a read failure is no longer a verdict.** `task-wait-cli.ts` now distinguishes a
  TERMINAL set (`succeeded`/`failed`/`cancelled`/`killed_*`) from an unreadable poll
  (`ok:false`, or a status in neither set). An unreadable poll increments a counter, sleeps and
  re-polls; after `MAX_READ_ERRORS = 5` consecutive ones it prints
  `READ-ERROR <id> — <error>` and exits **2**. A successful read resets the counter, so a
  transient SSH blip in a backgrounded hour-long wait can no longer surface as `FAIL … exit 1`.
  Specs: error x2 then succeeded → PASS/0 with no FAIL line; error x5 → READ-ERROR/2 after
  exactly 5 polls.
- **MAJOR 2 — brief no longer eats an explicit credential opt-in.**
  `applyStatusProjection(result, brief, includeCredentials)`; the default is now
  `shouldDefaultBrief(out) && !includeCredentials`, and `task.ts` threads
  `params.include_credentials` in on both the local and VM paths. `BRIEF_FIELDS` additionally
  keeps `admin_password_available`, `admin_password_hint`, `url`, `slot_url`, `internal_url`,
  `admin_email` — one line each, and the A3-B withheld-password signal must not vanish silently
  on a running deploy. `admin_password` itself is deliberately NOT in the list: the opt-in flips
  the whole read to full instead.
- **MINOR (a)** — `parseArgs` walks argv and skips each value-flag's value, so
  `--timeout 60 abc12345` resolves the id correctly instead of parsing `60`.
- **MINOR (b)** — the task-id regex is single-sourced: `TASK_ID_RE` from `task-schemas.ts` is now
  used by BOTH `index.ts`'s `taskIdSchema` and the CLI's validation (the duplicate literal in
  `index.ts` is gone).
- **MINOR (c)** — the `rl_task_status` description no longer over-promises: it says the password is
  redacted out of `cmd`, `args_summary` and `env` values, and explicitly that `log_tail` on a
  terminal read is returned in full.
- **NIT** — `stepSummary` filters steps missing `name`/`status`, so a malformed entry renders as
  nothing rather than `undefined:undefined` (spec covers `[{good}, {}, null]`).

Open nit NOT actioned (from the review's own "NIT" tier): a forced `brief:true` on a terminal task
still drops `failed_step` / `script_exit_code`. Brief is an explicit opt-in there and `error` /
`message` survive.
