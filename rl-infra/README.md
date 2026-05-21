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

All operator interaction goes through `rl-infra/cli/rl` on the laptop. It SSHes
to the VM and dispatches to shell scripts in `/srv/rl-infra/orchestrator/bin/`. There is no daemon,
no HTTP service — just SSH + flock + jq.

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
   `rl <cmd>` or VSCode Remote-SSH terminal.
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
restart on the laptop and is independently observable via SSH.

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

| Need                        | How                                                       |
| --------------------------- | --------------------------------------------------------- |
| Live log search             | Grafana → Loki: `{slot="1"} \|= "ECONNRESET"`             |
| VSCode debugger from laptop | Remote-SSH into runner, `launch.json` attaches to 9229    |
| Live REPL                   | `rl shell` → tmux session, persists across disconnects    |
| Postgres                    | `rl db <slug>` (psql) or `rl db <slug> --web` (pgweb)     |
| Resource live view          | `rl top` → ctop inside the VM                             |
| Profiling                   | `clinic doctor` etc. pre-installed in runner image        |
| Network capture             | `rl tcpdump <slot>` → tcpdump in the runner               |
| Stack-trace clickable paths | VSCode Remote-SSH session uses the runner's filesystem    |
| "What did agent X do?"      | `cat /srv/rl-infra/state/audit.log \| grep <agent-id>`    |
| Snapshot before risky run   | `rl snapshot create pre-experiment` → ZFS-backed          |

## DR — airplane mode

The same `rl-infra/cli/rl` runs locally. At startup it probes `nc -z $RL_PROXMOX_HOST 22`:

- Reachable → remote mode (everything in this doc).
- Unreachable OR `RL_TARGET=local` → falls back to today's local model:
  `deploy_dev.sh` + global env lock + `validate-ci.sh` against `localhost`.

In local mode you get 1 slot (the laptop), the existing MCP env lock applies, and
heavy compute stays on the laptop. This is intentional — DR is for "I'm on a plane,"
not the daily flow.

## What stays on the laptop

- VSCode editor (connects to the runner via Remote-SSH for terminal/debugger).
- Mutagen daemon (file sync agent).
- The `rl-infra/cli/rl` CLI.
- `git` operations on the worktree (refs/HEAD sync, but objects stay local).
- Discord MCP + Chrome MCP (need local Electron / Chrome with CDP).
- Sentry, Linear, GitHub clients (network, not compute-heavy).

## First-time setup

See `proxmox/cloud-init.yaml` for VM provisioning. After the VM is up:

```bash
ssh proxmox-vm
cd /srv/rl-infra
docker compose up -d
./bin/init-state    # creates claims.json, env-registry.json, audit.log
```

From the laptop:

```bash
echo 'export RL_PROXMOX_HOST=rl-infra.lan' >> ~/.zshrc
echo 'export RL_PROXMOX_USER=rl' >> ~/.zshrc
ln -s "$PWD/rl-infra/cli/rl" /usr/local/bin/rl   # or add rl-infra/cli to PATH
rl doctor                                    # verifies SSH, Mutagen, orchestrator
rl claim --branch $(git branch --show-current)
```

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
