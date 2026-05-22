# rl-infra — Remote Runner & Env Stack

A single Ubuntu Server VM on Proxmox (`rl-infra`) hosts every container the project needs
for development, testing, and per-tester preview environments. Nothing else shows up in
the Proxmox UI — runners, envs, monitoring, and the local registry all live inside this
one VM.

## Why this exists

The laptop runs out of RAM when `validate-ci.sh --full`, the dev env stack, multiple
agents, and Chrome MCP all overlap. Parallel agents also block on a global env lock
(`:3000` / `:5173` are singletons). Moving the compute to Proxmox solves both:

- Heavy workloads (npm builds, Jest/Vitest workers, Playwright, allinone image builds)
  run on Proxmox CPU/RAM, not the laptop.
- 2 long-lived **runner slots** by default (sized for a 16 GB VM) mean up to
  2 agents work concurrently with zero env contention. Slots 3+4 are
  pre-defined in `docker-compose.yml` behind the `extra-slots` profile —
  enable them if you add RAM to the Proxmox host. The local env lock only
  applies in DR (airplane) mode.

## Topology

```
Proxmox host
  └─ VM: rl-infra  (Ubuntu 24.04, 16 GB RAM, 6 vCPU, 250 GB)
       └─ Docker daemon
            ├─ traefik              *.rl.lan reverse proxy
            ├─ registry             local Docker registry (allinone images)
            ├─ loki + promtail      log aggregation (7d retention)
            ├─ grafana              dashboards + log search
            ├─ runner-1..2          long-lived dev containers (cpu=2, mem=4g each)
            │                       (runner-3..4 available via `--profile extra-slots`)
            ├─ gc-sweeper           every 15m: prune, expire envs, release dead claims
            └─ env stacks (ephemeral, one per active claim)
                  ├─ rl-env-{slug}-allinone   (built artifacts — prod-like)
                  └─ rl-env-{slug}-pg          (sibling Postgres, per-env volume)
```

## Hostnames (wildcard DNS `*.rl.lan` → Proxmox VM IP)

**Tester-facing (external — works on any network):**

| Hostname                          | Points at                                       |
| --------------------------------- | ----------------------------------------------- |
| `fleet.${RL_PUBLIC_DOMAIN}`       | Mobile fleet dashboard (bookmark on phone)      |
| `{slug}test.${RL_PUBLIC_DOMAIN}`  | Env `{slug}` allinone — share URL with testers  |

Wired through your external reverse proxy (NPM at the operator's apex
domain). DNS: `*.{RL_PUBLIC_DOMAIN}` → operator's WAN IP via Cloudflare or
similar. Pi-hole adds local overrides so LAN clients short-circuit the CF
hop (see SETUP.md Phase 10).

**Operator-facing (LAN-only, no external dependency):**

| Hostname                    | Points at                                   |
| --------------------------- | ------------------------------------------- |
| `traefik.rl.lan`            | Traefik dashboard                           |
| `grafana.rl.lan`            | Grafana (logs, dashboards)                  |
| `registry.rl.lan`           | Local Docker registry                       |
| `slot-N.rl.lan`             | Runner N's API+web ports                    |
| `slot-N-debug.rl.lan`       | Runner N's node `--inspect` debug port      |
| `{slug}.rl.lan`             | Env `{slug}` allinone — LAN-only fallback   |
| `db-{slug}.rl.lan`          | pgweb UI for env `{slug}`'s Postgres        |

Resolved by Pi-hole wildcard `*.rl.lan → 192.168.0.132`. These keep working
even if Cloudflare/your-WAN/NPM is down — use them when iterating fast on
the operator laptop or when external chain is broken.

## The CLI

> **Agents:** prefer the `mcp__mcp-rl-fleet__*` MCP tools (see CLAUDE.md
> "`mcp-rl-fleet`"). Direct SSH as `rl-agent` is closed (ROK-1338 PR-3); the
> CLI below is the operator-facing path that uses the operator SSH user.

All operator interaction goes through `rl-infra/cli/rl` on the laptop. It SSHes
to the VM as the operator user (`rl`) and dispatches to shell scripts in
`/srv/rl-infra/orchestrator/bin/`. There is no daemon, no HTTP service — just
SSH + flock + jq.

```bash
rl claim [--branch foo]          # acquire a runner slot
rl release                       # release + clean up the slot
rl status                        # global view (slots, envs, resources)
rl shell                         # tmux into your claimed slot
rl logs [filter]                 # Loki query, scoped to your slot/env
rl env spin <slug> [--image tag] # spin allinone + sibling PG
rl env list
rl env destroy <slug>
rl db <slug> [--web]             # psql or launch pgweb
rl snapshot {create|rollback|list} <name>
rl gc                            # force a sweep
rl doctor                        # diagnose end-to-end health
rl validate-ci [...args]         # run validate-ci.sh inside your runner
```

## Lifecycle of a claim

1. `rl claim --branch feat/foo` → orchestrator finds a free slot, records
   `agent_id`, `branch`, `started_at`, `last_heartbeat` in `claims.json`.
2. Mutagen sync session starts: `~/Documents/Projects/Raid-Ledger` ↔
   `proxmox-vm:/srv/rl-infra/runners/slot-N/worktree`. Excludes `node_modules`,
   `dist`, `coverage`, `.git/objects`.
3. Operator/agent works on the laptop. Saves trigger Mutagen → ~1s to runner.
4. Heavy commands (`validate-ci`, `env spin`, jest) ship to the runner via
   `rl <cmd>` or operator-only VSCode Remote-SSH terminal. Agents use
   `mcp__mcp-rl-fleet__rl_run_on_runner` / `rl_validate_ci` instead.
5. Local CLI heartbeats every 60s. Missed for 5min → slot auto-released.
6. `rl release` → destroys child envs, prunes scoped to slot label, resets
   worktree dir, drops the claim.

## Cleanup ("account for every runner's mess")

- **Container resource caps:** `cpus: 2.0`, `mem_limit: 6g`, `pids_limit: 4096`
  on every runner. A runaway test throttles itself.
- **Disk quotas:** ZFS quota of 20GB per `runners/slot-N` dataset.
- **Env TTL:** every env gets `rl.ttl=24h` + `rl.last-touched` labels. Sweeper
  destroys past-TTL.
- **Dead claim sweep:** heartbeat older than 5min → slot released, claim record
  cleared.
- **Image/volume GC:** `docker system prune --volumes` scoped to `rl.role=*`
  labels every 15min via `gc-sweeper`.
- **Audit trail:** every orchestrator call writes a line to
  `/srv/rl-infra/state/audit.log` (claim ID, command, timestamp, outcome).
- **`rl status`** surfaces all of the above in one screen.

## Task tracking (ROK-1331 M1)

Long-running orchestrator commands (validate-ci, image builds, env spins) are
tracked as **tasks** with persistent VM-side state. State survives MCP-server
restart on the laptop and is independently observable by the operator via
SSH. Agents observe task state via `mcp__mcp-rl-fleet__rl_task_inspect` /
`rl_task_status` / `rl_task_logs` — direct SSH as `rl-agent` is closed
(ROK-1338 PR-3).

**Directory layout** — `/srv/rl-infra/state/tasks/`:

- `<task_id>.json` — task metadata + parsed step list (see schema below)
- `<task_id>.log` — full stdout+stderr captured from the wrapped command

**Binary surface** (`/srv/rl-infra/orchestrator/bin/`):

| Binary        | Usage                                                                                   |
| ------------- | --------------------------------------------------------------------------------------- |
| `task-start`  | `task-start <task_id> --tool <name> [--slot N] [--agent-id ID] -- <cmd...>`             |
| `task-status` | `task-status <task_id> [--log-tail-bytes N]` (default 50 KiB)                           |
| `task-cancel` | `task-cancel <task_id> <reason>` — SIGTERM → 10 s grace → SIGKILL                       |
| `task-list`   | `task-list [--slot N] [--status running\|succeeded\|failed\|cancelled] [--limit N]`     |

Task IDs are caller-generated `[a-z0-9]{8,32}` strings. `task-start` returns
within 1 s with `{ok, task_id, log_path, started_at}` JSON; the wrapped command
runs in a detached process group so `task-cancel` can `kill -<pgid>` the whole
subtree.

**Task JSON shape** (consumed by M2's `task.ts` MCP tool + M3's dashboard):

```jsonc
{
  "task_id": "ab12cd34ef56",
  "tool": "rl_validate_ci",
  "slot": 1,
  "agent_id": "rok-1331-…",
  "args_summary": "--full",
  "cmd": ["bash", "/workspace/scripts/validate-ci.sh", "--full"],
  "log_path": "/srv/rl-infra/state/tasks/ab12cd34ef56.log",
  "pid": 12345,
  "status": "running",                  // running | succeeded | failed | cancelled
  "script_exit_code": null,             // null while running; int once finalized
  "started_at": "2026-05-20T14:00:00Z",
  "finished_at": null,
  "cancel_reason": null,
  "steps": [
    {"name": "Build (all workspaces)", "status": "PASS", "duration_s": null}
  ]
}
```

**Step parsing** — `task-start` tails the wrapped command's log and regex-matches
validate-ci's `<name>: PASS|FAIL|SKIPPED` lines (ANSI-colored or plain) into
`steps[]`. The regex is the single source of truth in
`orchestrator/bin/_parser.sh`; M2 documentation references this file rather than
copying the pattern.

**Retention** — the `gc-sweeper` container prunes terminal task JSON + log pairs
older than `TASK_RETENTION_SECONDS` (default 86 400 s = 24 h). Running tasks
are preserved unconditionally. Orphaned tasks (status=running but pid no longer
alive — host reboot, OOM) get auto-flipped to failed with
`cancel_reason: "orphaned"` so the normal age check ages them out next pass.

**Release cascade** — `release` (and the sweeper's dead-claim path) cancels any
running tasks owned by the released slot before clearing the claim record, so
in-flight long-running tools don't outlive their slot.

**Log file caps** — `task-start` does NOT rotate logs during execution; the
sweeper handles size at end-of-life. `task-status` caps its returned `log_tail`
(default 50 KiB) so callers don't ingest gigabyte logs.

## Strong debugging

Agent-side paths first, operator-only paths labelled. Direct SSH as `rl-agent`
is closed (ROK-1338 PR-3) — anything below that requires an SSH session is
intentionally operator-only.

| Need                        | How                                                                          |
| --------------------------- | ---------------------------------------------------------------------------- |
| Live log search (agents)    | `mcp__mcp-rl-fleet__rl_logs_url` → Grafana/Loki link (`{slot="1"} \|= "..."`) |
| Read service logs (agents)  | `mcp__mcp-rl-fleet__rl_infra_logs` (`gc-sweeper`, `dashboard`, `traefik`, `loki`, `registry`, `promtail`, `docker-proxy`) |
| Read task log (agents)      | `mcp__mcp-rl-fleet__rl_task_logs` (full ANSI-stripped stdout/stderr)         |
| Read task JSON (agents)     | `mcp__mcp-rl-fleet__rl_task_inspect`                                         |
| Read env config (agents)    | `mcp__mcp-rl-fleet__rl_env_inspect` (nginx-conf / supervisor-conf)           |
| Run query against env DB    | `mcp__mcp-rl-fleet__rl_db_query` (read-only, JSON-mode, 5s timeout)          |
| Postgres (operator-only)    | `rl db <slug>` (psql) or `rl db <slug> --web` (pgweb)                        |
| Live REPL (operator-only)   | `rl shell` → tmux session, persists across disconnects                       |
| Resource live view (op.)    | `rl top` → ctop inside the VM                                                |
| VSCode debugger (operator-only) | Remote-SSH into runner, `launch.json` attaches to 9229                   |
| Profiling (operator-only)   | `clinic doctor` etc. pre-installed in runner image                           |
| Network capture (op.)       | `rl tcpdump <slot>` → tcpdump in the runner                                  |
| Stack-trace clickable paths (op.) | VSCode Remote-SSH session uses the runner's filesystem                 |
| "What did agent X do?" (op.)| `cat /srv/rl-infra/state/audit.log \| grep <agent-id>`                       |
| Snapshot before risky run (op.) | `rl snapshot create pre-experiment` → ZFS-backed                         |

## DR — airplane mode

The same `rl-infra/cli/rl` runs locally. At startup it probes `nc -z $RL_PROXMOX_HOST 22`:

- Reachable → remote mode (everything in this doc).
- Unreachable OR `RL_TARGET=local` → falls back to today's local model:
  `deploy_dev.sh` + global env lock + `validate-ci.sh` against `localhost`.

In local mode you get 1 slot (the laptop), the existing MCP env lock applies, and
heavy compute stays on the laptop. This is intentional — DR is for "I'm on a plane,"
not the daily flow.

## What stays on the laptop

- VSCode editor — operator only, connects to the runner via Remote-SSH for
  terminal/debugger using the operator SSH user.
- Mutagen daemon (file sync agent).
- The `rl-infra/cli/rl` CLI (operator-only; agents use the MCP tools instead).
- `git` operations on the worktree (refs/HEAD sync, but objects stay local).
- Discord MCP + Chrome MCP (need local Electron / Chrome with CDP).
- Sentry, Linear, GitHub clients (network, not compute-heavy).

## First-time setup (operator-only)

See `proxmox/cloud-init.yaml` for VM provisioning. After the VM is up, the
operator (NOT an agent) runs:

```bash
ssh proxmox-vm    # operator-only SSH as the `rl` user
cd /srv/rl-infra
docker compose up -d
./bin/init-state    # creates claims.json, env-registry.json, audit.log
```

From the laptop:

```bash
echo 'export RL_PROXMOX_HOST=rl-infra.lan' >> ~/.zshrc
echo 'export RL_PROXMOX_USER=rl' >> ~/.zshrc                # operator user
ln -s "$PWD/rl-infra/cli/rl" /usr/local/bin/rl   # or add rl-infra/cli to PATH
rl doctor                                    # verifies SSH, Mutagen, orchestrator
rl claim --branch $(git branch --show-current)
```

Agents do not bootstrap the fleet — they use `mcp__mcp-rl-fleet__*` against
the already-running stack.

## VM dependencies

The rl-infra VM host needs these packages installed via apt-get:

- `inotify-tools` — push-notify (`rl test-plan wait`, `rl task wait`) uses
  `inotifywait` to long-poll state-file changes. Without it, `wait`
  commands silently return immediate timeouts. Install via
  `apt-get install -y inotify-tools` on the VM host.

Runner containers (per slot) auto-install these via `rl-infra/runner/Dockerfile`:

- `inotify-tools` — same purpose for in-runner uses.
- `postgresql-client`, `redis-tools`, `docker-ce-cli`, `git`, `make`,
  `build-essential`, `netcat-openbsd`, `iproute2`, `dnsutils`, `tmux`,
  `htop`, `tcpdump`, `strace`, `lsof`, `rsync`, `jq`, `unzip`, `curl`,
  `gnupg`, `ca-certificates`.

After changing `rl-infra/runner/Dockerfile`, rebuild the runner image on
the VM:

```bash
cd /srv/rl-infra
docker compose build runner-1 runner-2
docker compose up -d
```

(This is an operator-action: agents don't have permission to restart
compose-managed services.)

## Operator override — temporarily enabling rl-agent SSH

> **Audience:** operator only. This runbook is informational for agents but
> not actionable by them — there is no agent path back to direct SSH and
> there shouldn't be. Per ROK-1338 PR-3, agent-side SSH as `rl-agent` is
> closed by default; the full agent surface lives in `mcp__mcp-rl-fleet__*`.

### Why this exists

Closing direct SSH for `rl-agent` removes a lateral-movement vector but also
removes a break-glass debug path the operator may occasionally need (e.g. to
investigate why an MCP tool is itself broken, or to interactively inspect
fleet state during a postmortem). The mechanism below is an **operator-side
toggle**: SSH is denied by default; a single operator command flips it back
on; another command re-locks.

The toggle is a file on the VM, not a config edit, so:

- Re-locking after debugging is one command — hard to leave it open by mistake.
- Auditing "was rl-agent SSH on?" is `ls -l /etc/ssh/.agent-allow` plus the
  sshd_config audit trail.
- Re-running provisioning won't accidentally re-enable SSH.

### Mechanism (A — toggle file + AuthorizedKeysCommand gate)

The lockdown sources rl-agent's authorized keys from a small script that
returns empty unless a toggle file exists. sshd has no key to match against,
so authentication fails — no `DenyUsers`/`AllowUsers` juggling needed, and
`~rl-agent/.ssh/authorized_keys` becomes irrelevant (sshd ignores it inside
the Match block).

**The escrow file `/etc/ssh/rl-agent.authorized_keys.escrow` is the
canonical source of truth for the laptop-side public key.** It stays in
place permanently; only the `/etc/ssh/.agent-allow` toggle gates whether
the key is offered to sshd. Mode `0644 root:root` — public keys are not
secret data, and the `AuthorizedKeysCommand` runs as `nobody` which must be
able to read it.

#### Files to create on the VM

`/etc/ssh/rl-agent-gated-keys.sh` (mode 0755, root:root):

```bash
#!/bin/bash
# Returns the rl-agent authorized_keys ONLY when the toggle file exists.
# Toggle file: /etc/ssh/.agent-allow (operator creates to break-glass).
# Escrow:      /etc/ssh/rl-agent.authorized_keys.escrow (canonical key,
#              0644 root:root — public key is not secret data; runs as nobody).
set -euo pipefail
if [ -f /etc/ssh/.agent-allow ] && [ -r /etc/ssh/rl-agent.authorized_keys.escrow ]; then
    cat /etc/ssh/rl-agent.authorized_keys.escrow
fi
exit 0
```

Append to `/etc/ssh/sshd_config` (after the global `AuthorizedKeysFile`
directive, NOT replacing it — the Match block is scoped to rl-agent only):

```
# ROK-1338 PR-3: rl-agent SSH gated on /etc/ssh/.agent-allow toggle.
# When the file is absent the key lookup script returns empty and auth fails.
Match User rl-agent
    AuthorizedKeysFile none
    AuthorizedKeysCommand /etc/ssh/rl-agent-gated-keys.sh
    AuthorizedKeysCommandUser nobody
```

`AuthorizedKeysCommand` is re-executed per connection, so flipping the toggle
takes effect on the next ssh attempt — no sshd reload required AFTER the
initial sshd_config edit.

### Apply the lockdown (post-merge, operator-only)

**Step 0 (preflight — DO NOT skip).** Confirm every agent that will work the
fleet has a fresh MCP surface that includes the PR-2 tools (`rl_task_logs`,
`rl_env_inspect`, `rl_db_query`). Two parts:

   1. **From the main repo (laptop):**
      ```bash
      cd /Users/sdodge/Documents/Projects/Raid-Ledger
      git pull --rebase origin main
      npm install        # MANDATORY — PR-2 added json-bigint; without npm install the MCP server fails to load at all
      ```
      Verify: `ls node_modules/json-bigint/package.json` exists. Without this,
      ANY Claude session will start with a dead `mcp-rl-fleet` server (module
      load error) and the lockdown becomes unrecoverable for agents.
   2. **Restart any open Claude sessions.** MCP servers load their tool
      registry at session start; sessions that predate PR-2's merge will be
      missing `rl_task_logs` / `rl_env_inspect` / `rl_db_query` even after
      step 1. Restart fully (exit Claude and relaunch — `/exit` from inside a
      session is sufficient for the interactive client; background agents
      must be stopped from the agents panel).
   3. **Verify** by asking the agent to call `mcp__mcp-rl-fleet__rl_status`
      and then `ToolSearch select:mcp__mcp-rl-fleet__rl_task_logs`. If the
      latter returns "No matching deferred tools found", the agent is still
      stale — DO NOT proceed with the lockdown. Loop back to step 2.

Only proceed once every active agent session reports `rl_task_logs` /
`rl_env_inspect` / `rl_db_query` as PRESENT in its MCP surface.

1. **Back up the existing sshd_config:**
   ```bash
   sudo cp /etc/ssh/sshd_config /root/sshd_config.pre-rok-1338-pr3
   ```
2. **Escrow the rl-agent public key** (canonical store; never deleted while
   the lockdown is in force — mode 0644 because public keys are not secret
   and `nobody` must read it). Guard against an empty source — without a
   non-empty escrow, break-glass would silently fail later:
   ```bash
   sudo test -s ~rl-agent/.ssh/authorized_keys || \
       { echo "ABORT: ~rl-agent/.ssh/authorized_keys is missing or empty — escrow would be a no-op"; exit 1; }
   sudo install -m 0644 -o root -g root ~rl-agent/.ssh/authorized_keys \
        /etc/ssh/rl-agent.authorized_keys.escrow
   ```
3. **Install the gated-keys script:**
   ```bash
   sudo tee /etc/ssh/rl-agent-gated-keys.sh > /dev/null <<'SH'
   #!/bin/bash
   set -euo pipefail
   if [ -f /etc/ssh/.agent-allow ] && [ -r /etc/ssh/rl-agent.authorized_keys.escrow ]; then
       cat /etc/ssh/rl-agent.authorized_keys.escrow
   fi
   exit 0
   SH
   sudo chown root:root /etc/ssh/rl-agent-gated-keys.sh
   sudo chmod 0755 /etc/ssh/rl-agent-gated-keys.sh
   ```
4. **Append the Match block** to `/etc/ssh/sshd_config` (copy-paste verbatim):
   ```bash
   sudo tee -a /etc/ssh/sshd_config > /dev/null <<'CFG'

   # ROK-1338 PR-3: rl-agent SSH gated on /etc/ssh/.agent-allow toggle.
   # When the file is absent the key lookup script returns empty and auth fails.
   Match User rl-agent
       AuthorizedKeysFile none
       AuthorizedKeysCommand /etc/ssh/rl-agent-gated-keys.sh
       AuthorizedKeysCommandUser nobody
   CFG
   ```
5. **Validate the syntax before reloading** — a broken sshd_config will lock
   the operator out too if the active session drops:
   ```bash
   sudo sshd -t      # exits 0 silent on success, prints offending line on failure
   ```
6. **Clear `~rl-agent/.ssh/authorized_keys`** so even the legacy path is empty
   (defense-in-depth — `AuthorizedKeysFile none` in the Match block already
   means sshd won't read it, but an empty file rules out accidental rollback
   via `cp escrow ~/.ssh/authorized_keys`):
   ```bash
   sudo truncate -s 0 ~rl-agent/.ssh/authorized_keys
   ```
7. **Confirm the toggle file is absent** (lockdown active by default):
   ```bash
   ls -l /etc/ssh/.agent-allow   # expect: No such file or directory
   ```
8. **Reload sshd** (do NOT restart — reload preserves the current operator
   session):
   ```bash
   sudo systemctl reload sshd
   ```
9. **Confirm from the laptop:**
   ```bash
   ssh rl-agent@rl-infra echo ok      # expect: Permission denied (publickey)
   ```

### Break-glass — re-open rl-agent SSH temporarily

```bash
# On the VM, as operator:
sudo touch /etc/ssh/.agent-allow

# That's it. Next ssh attempt as rl-agent succeeds.
# No sshd reload needed (AuthorizedKeysCommand is per-connection).
```

### Re-lock after debugging

```bash
sudo rm -f /etc/ssh/.agent-allow

# Verify from the laptop:
ssh rl-agent@rl-infra echo ok      # expect: Permission denied (publickey)
```

### Full revert (if PR-3's premise turns out wrong)

```bash
sudo cp /root/sshd_config.pre-rok-1338-pr3 /etc/ssh/sshd_config
sudo install -m 0600 -o rl-agent -g rl-agent \
     /etc/ssh/rl-agent.authorized_keys.escrow \
     ~rl-agent/.ssh/authorized_keys
sudo systemctl reload sshd
```

Then file a follow-up explaining which agent debug path forced the revert —
the right answer is almost always "add an MCP tool", not "permanently
re-open SSH". The umbrella prerequisite-list in [[project-rok-1338-no-ssh-umbrella]]
is the catch-all for those gaps.

### Audit checklist

- `ls -l /etc/ssh/.agent-allow` — present only during a break-glass window;
  absent in steady state.
- `ls -l /etc/ssh/rl-agent.authorized_keys.escrow` — must exist
  (mode 0644 root:root, world-readable so `nobody` can serve it via the
  AuthorizedKeysCommand). If missing, even break-glass won't work — the
  key was never escrowed.
- `wc -l ~rl-agent/.ssh/authorized_keys` — should always be 0 lines. Non-zero
  is a defense-in-depth violation (it doesn't itself open SSH — `AuthorizedKeysFile none`
  in the Match block neutralizes this file — but it suggests someone reverted
  step 6 by hand).
- `sudo journalctl -u sshd --since '1 hour ago' | grep rl-agent` — every
  rl-agent SSH attempt (allowed or denied) lands in the systemd journal.
- `sudo grep -c '/etc/ssh/.agent-allow' /var/log/auth.log` — count of recent
  toggle-gate evaluations (every connection attempt triggers the script).

### Out of scope

- This runbook does NOT manage the operator (`rl`/`sdodge`) SSH user.
  Operator SSH stays open by design — it's the legitimate path for
  break-glass and for the `rl-infra/cli/rl` CLI's own SSH calls.
- The runner-internal SSH path (`docker exec runner-N sshd`) is not affected;
  agents reach runners via Mutagen + the MCP tools, not direct SSH.
