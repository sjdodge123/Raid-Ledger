# MCP tools — full reference

> **Moved verbatim from `CLAUDE.md` on 2026-11-24 (ROK-2307)** to keep the always-loaded
> instructions small. CLAUDE.md keeps each rule's binding statement and points here; the text
> below is the full original rule, unchanged apart from heading levels. Change both together.

### MCP Tools (registered in `.mcp.json`)

Three custom MCP servers cover environment management, story tracking and Discord testing. **Use them instead of manual shell commands.** Per-tool detail: `mcp-env` → `docs/runbooks/local-dev-env.md`; `mcp-discord` → `docs/runbooks/discord-testing.md`; `mcp-rl-fleet` → `rl-infra/README.md` → "Agent MCP tool reference" (canonical home of the "Use When" table, the stale-build sync guard, the push-notify pattern and the `RL_*` env vars).

**STRICT — agents must not SSH to the rl-infra VM as `rl-agent` (ROK-1338).** Agents reach the fleet only through `mcp__mcp-rl-fleet__*`. The operator's `rl` CLI SSHes as the operator user and is NOT an agent fallback. If a debug path requires direct SSH, that's a capability gap — append it to the no-SSH umbrella list ([[project_rok_1338_no_ssh_umbrella]]) rather than asking the operator for SSH access.

**STRICT — Codex reviews never run test suites on the laptop (ROK-1468).** `codex review` (the `/security-review` pass) runs read-only with no approvals — set in `.codex/config.toml` AND passed explicitly as `-c sandbox_mode="read-only" -c approval_policy="never"` by `.claude/skills/security-review/SKILL.md`. Reviews are staggered one at a time; jest/vitest/Playwright stay on the fleet.

**STRICT — `worktree_path`:** every rl_* tool that touches a claimed slot (`rl_claim`, `rl_release`, `rl_env_spin`, `rl_env_destroy`, `rl_env_deploy`, `rl_env_build_image_from_runner`, `rl_force_resync`, `rl_run_on_runner`, `rl_validate_ci`) takes a `worktree_path`. **Operating from a git worktree, you MUST pass `worktree_path: "<absolute path to your worktree>"` on every call** — without it the MCP server uses its own cwd (usually the main repo), which Mutagen-syncs the wrong branch's files and hashes to a different `RL_AGENT_ID` so later calls can't find your slot. Same value every call.

The gotchas that bite:

- **`rl_env_spin`: ALWAYS hand out the `url` field** (slot-stable `https://slot-N.gamernight.net`, Discord OAuth works); NEVER the per-slug `public_url` (OAuth broken). The spin is async, so `url` arrives in the terminal `rl_task_status` of its `local-…` task, not in the dispatch reply. Browser tests point there, never `localhost:5173`.
- **`rl_claim` may return `enqueued`** — poll `rl_claim_wait` or pick non-env work. `rl_release` preserves child envs by default (`preserve_envs: false` to nuke).
- **The 120s wait cap (ROK-1362):** EVERY blocking wait caps at 120s. `rl_validate_ci` / `rl_env_build_image_from_runner` / `rl_env_deploy` / `rl_env_spin` / `rl_env_clone_prod` are async, returning a `task_id` (`local-…` ids run detached on your laptop). **An ops lane waits with repeated blocking `rl_task_wait` calls (≤120s each) until the task is terminal; the Lead never polls** (Lead context discipline, rule 2). No single call waits longer than that; `rl_task_status` is for a one-off read of a finished task.
- **`rl_run_on_runner`:** shell in `/workspace`, needs a claim. `timeout_seconds ≤ 120` runs sync; **`> 120` auto-dispatches as a VM task** and returns `{routed:'task', task_id}`.
- **`rl_force_resync`** is the recovery when a redeploy serves OLD code or the runner lags your branch (stale Mutagen sync).
- **`rl_db_query` is read-only SQL.** Dashboard: `http://fleet.gamernight.net`.

**Offline MCP servers:** `.mcp.json` starts all three through `scripts/mcp-launch.sh <server>`, which keeps the session's folder as the working directory but loads code + packages from the main checkout when this checkout has no usable install — so a fresh worktree connects without an `npm install`. If ALL `rl_*`/env/discord tools are missing, the main checkout's own install is broken (2026-09-19: an interrupted install left `node_modules/@modelcontextprotocol/sdk` empty): `npm install` in the main checkout, then restart the Claude session — a live session cannot reconnect. Manual probe, from the folder the session started in: `sh scripts/mcp-launch.sh mcp-rl-fleet --self-check` (exit 0 = healthy; exit 1 prints the fix). When the tools ARE up, `mcp__mcp-env__mcp_health` diagnoses the other two.

**Fleet runners throwing `Illegal instruction (core dumped)`** or libsharp mmap errors on native modules = the VM's `cpu:` model is missing SSE4.2/SSSE3/POPCNT. One-time host config edit: memory `reference_rl_infra_vm_cpu_runbook.md`.
