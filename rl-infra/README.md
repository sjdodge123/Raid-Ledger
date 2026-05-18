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

| Hostname                    | Points at                                   |
| --------------------------- | ------------------------------------------- |
| `fleet.rl.lan`              | Mobile fleet dashboard (bookmark on phone)  |
| `traefik.rl.lan`            | Traefik dashboard                           |
| `grafana.rl.lan`            | Grafana (logs, dashboards)                  |
| `registry.rl.lan`           | Local Docker registry                       |
| `slot-N.rl.lan`             | Runner N's API+web ports                    |
| `slot-N-debug.rl.lan`       | Runner N's node `--inspect` debug port      |
| `{slug}.rl.lan`             | Env `{slug}` allinone container             |
| `db-{slug}.rl.lan`          | pgweb UI for env `{slug}`'s Postgres        |

Set the wildcard in your router/Pi-hole. Without DNS, edit `/etc/hosts` per hostname.

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
