---
name: deploy-dev
description: Start the local development environment (Docker DB + Redis, native API + Vite)
disable-model-invocation: true
allowed-tools: "Bash(./scripts/deploy_dev.sh*), Bash(./rl-infra/cli/rl*), Bash(rl*)"
---

# Deploy Dev Environment

**Remote-first (default when `RL_PROXMOX_HOST` is reachable):** spin a per-claim
allinone env on the rl-infra VM. This gives a prod-like (supervisor + nginx +
unix-socket Redis) stack instead of the dev watch-mode loop and offloads CPU/RAM
from the laptop:

```bash
rl claim --branch $(git branch --show-current)   # may enqueue with queue_position=N
# If the CLI prints `enqueued queue_position=N`, fleet contention is real —
# call `rl_claim_wait` (MCP) until head, OR run locally via `RL_TARGET=local ./scripts/deploy_dev.sh --ci`.
rl env spin $(git branch --show-current | tr / -)
```

The output prints the URL (`https://<slug>.rl.lan`) and the per-env Postgres
container name. `rl env destroy <slug>` tears it down; the gc-sweeper auto-prunes
after 24h. See `rl-infra/README.md` and
`.claude/skills/_shared/rl-infra-fleet.md`.

**Local fallback (airplane mode / `RL_TARGET=local`):** start the local dev
environment using the deploy script.

Run: `./scripts/deploy_dev.sh`

This starts:
- Docker containers for PostgreSQL and Redis
- NestJS API in watch mode on http://localhost:3000
- Vite dev server with HMR on http://localhost:5173

After startup, display the admin credentials and available URLs from the script output.
