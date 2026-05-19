# `rl-infra` fleet — code-review summary for `batch/2026-05-17`

This batch builds out and hardens the **rl-infra remote test fleet** — a Proxmox VM that hosts a slot-based runner stack so heavy compute (image builds, integration tests, per-test environments) runs off-laptop and multiple agents can work in parallel without env-lock contention.

Scope of this doc: every fleet-related change in commits `62445e45..2e8c1e5d` on `batch/2026-05-17` (~58 commits, ~8,500 LOC across `rl-infra/`, `tools/mcp-rl-fleet/`, `scripts/`, `.claude/skills/`, `CLAUDE.md`, `Dockerfile.allinone`). Non-fleet batch entries (`ROK-1273`, `ROK-1284`, `ROK-1289`, `ROK-1315`) are tracked under their own stories and are NOT covered here.

Companion follow-up: **ROK-1326** — open bugs surfaced during live testing that did NOT land in this batch (Bug R: `.git` pointer; Bug S: Mutagen broad perm-strip).

---

## 1. What exists now (architecture, top-down)

```
laptop                    ────────────────  rl-infra VM (192.168.0.132) ─────────────
                                              │
agent's worktree   ── Mutagen (one-way) ──▶  /srv/rl-infra/state/runners/slot-N/workspace
                          (.git pointer)        │
                                              │
mcp-rl-fleet MCP   ── ssh rl-agent ──▶  rl CLI on VM ──┬─▶ orchestrator/bin/*  (state mutations)
  (laptop)                                              ├─▶ docker via wollomatic socket-proxy
                                                        ├─▶ allinone build (per-branch)
                                                        └─▶ per-env Postgres + allinone containers

operator browser   ── Cloudflare ──▶  Traefik (file-provider)  ──▶  env containers
                       (*.gamernight.net)                       │
                                                                ├─▶  slot-N.gamernight.net (slot-stable, OAuth)
                                                                ├─▶  <slug>test.gamernight.net (per-env, backward compat)
                                                                └─▶  fleet.gamernight.net (dashboard)
```

### 1a. Components (all new in this batch unless noted)

| Component | Path | Purpose |
|---|---|---|
| Orchestrator | `rl-infra/orchestrator/bin/{claim,release,env-spin,env-destroy,run-on-runner,heartbeat,status,build-image-on-runner,force-release,init-state}` | Stateful slot ops + per-env lifecycle. State at `/srv/rl-infra/state/*.json`, mutated under `flock`. |
| Operator CLI | `rl-infra/cli/rl` (515 LOC bash) | One-binary façade — `rl claim / release / status / env spin / env destroy / validate-ci`. Manages Mutagen sessions client-side. |
| MCP server | `tools/mcp-rl-fleet/src/` (16 tool files, ~1700 LOC TS) | Exposes `rl_*` tools to Claude. Stateless wrapper around the `rl` CLI over SSH. Forces `RL_PROXMOX_USER=rl-agent` + `RL_OPERATOR=0` so agents can't escalate. |
| Dashboard | `rl-infra/dashboard/` (server.js + public/) | `fleet.gamernight.net` — mobile-friendly status page, per-slot cards, test-plan checklist UI, tester comment + screenshot upload, no auth (LAN + Cloudflare-fronted). |
| Sweeper | `rl-infra/gc-sweeper/sweep.sh` | Periodic cron — removes orphaned/unhealthy envs, releases stale slot leases, prunes scoped Docker resources. |
| Traefik | `rl-infra/traefik/` + `docker-compose.yml` file-provider | Routes `slot-N.{DOMAIN}` + `<slug>test.{DOMAIN}` + `fleet.{DOMAIN}` to the right containers. Slot-N is the OAuth-stable hostname. |
| Sync scripts | `scripts/sync-local-to-env.sh`, `scripts/clone-prod-to-env.sh`, `scripts/rl-encrypt-setting.mjs` | Seed test envs with operator's local DB / sanitized prod data. |
| Docs / agent context | `rl-infra/README.md`, `rl-infra/SETUP.md`, `.claude/skills/_shared/rl-{infra-fleet,fleet-preflight}.md`, CLAUDE.md updates | Operator runbook + agent context. |

### 1b. Slot lease lifecycle

1. **Agent calls `rl_claim`** — MCP server hashes `(worktree_path, branch)` → `RL_AGENT_ID`, ssh's `rl claim` on the VM, which atomically picks a free slot or queues. If acquired, starts a Mutagen session laptop→runner (`/workspace` is the alpha-source for builds). Heartbeat daemon starts on the VM (touches `last_heartbeat` every 60s; missed >5min auto-releases).
2. **`rl_env_spin <slug>`** — orchestrator builds (or reuses) per-branch allinone image, brings up `rl-env-<slug>-{allinone,pg}` containers, registers Traefik routes, bootstraps `admin@local` via `docker exec ... bootstrap-admin.js`, returns slot-stable URL + admin email/password.
3. **`rl_env_sync_from_local <slug> --mode=settings`** — pg_dump operator's local DB → restore into env's pg, AES-256-GCM re-encrypts `app_settings` rows for env's `JWT_SECRET`, rewrites `discord_callback_url` to the slot URL, restarts allinone to bust settings cache.
4. **`rl_env_deploy`** chains all of the above with structured `steps[]` reporting.
5. **`rl_test_plan_create`** posts a structured checklist tied to the slug; testers fill it on the dashboard (verdicts buffer locally, "Submit" batch-signals back; reset buttons signal immediately).
6. **`rl_test_plan_wait`** long-polls via SSH `inotifywait` — push-like UX so the agent reacts when a testing round completes.
7. **`rl_release`** terminates Mutagen, destroys child envs, prunes scoped resources, frees the slot.

### 1c. Security boundaries

- `rl-agent` user (uid 1003) on the VM has **no docker group membership**. Docker CLI is forced through the **wollomatic path-filtered socket-proxy** at `127.0.0.1:2375` (see `DOCKER_HOST` plumbing). Allowlist permits only the specific operations the orchestrator needs (`POST /containers/rl-env-*/restart`, etc.).
- MCP server hardcodes `RL_PROXMOX_USER=rl-agent` and `RL_OPERATOR=0` — an agent cannot elevate even if operator's shell exports `RL_OPERATOR=1`.
- Dashboard runs on the LAN inside the VM, fronted by NPM/Cloudflare. No auth (acceptable per operator threat model — trusted testers only). Tester-supplied comment bodies are **always wrapped in `<untrusted-tester-comment>...</untrusted-tester-comment>`** when returned via `rl_test_plan_status` so the receiving agent treats them as data, not instructions.
- `RL_FLEET_ALLOW_FORCE_RELEASE=1` env var gates the `rl_force_release` tool.

---

## 2. What changed and why — chronological grouping

The 58 commits roughly cluster into seven phases. Each phase ends in a commit hash for navigation.

### Phase 1 — Initial scaffold (`62445e45`)
Brought up the Proxmox VM compose stack, orchestrator state machine, Mutagen sync template, runner image, Traefik file-provider, basic dashboard. Single-purpose: prove a laptop agent can claim a slot and run an arbitrary command on it.

### Phase 2 — MCP server + external routing (`98d2acd5`, `eb00964e`, `52a23bad`, `915b89c4`, `7b569137`, `54207ef6`, `182475ee`, `44928bde`)
Wrapped the `rl` CLI in an MCP server so Claude can drive it directly. Switched test envs to external `<slug>test.gamernight.net` URLs so the operator could share them with non-LAN testers. Added gc-sweeper for orphan reaping.

### Phase 3 — Branch-deploy pipeline (`e673c01f`, `334cbeb9`)
Added `rl_env_deploy` (claim → build → spin → sync as one tool), the pull-based slot queue, `rl_force_release`, the `worktree_path` parameter (STRICT — every `rl_*` call from a worktree MUST pass it; without it Mutagen syncs the wrong tree and `RL_AGENT_ID` mismatches), and `clone_prod` integration. /build skill rewrites for fleet vs local mode-branching land here.

### Phase 4 — Live-testing bug bash (`028ec10a`, `15ec8eb5`, `768ed24e`, `42eee075`, `4bf42ad1`, `fb70982b`, `f195b58a`)
First round of bugs surfaced by the rok-1297 agent during a real deploy:
- **Bug E** — `docker ps --format '{{ index .Labels "X" }}'` doesn't work in `ps` context; fixed with singular `.Label`.
- **Bug F** — Mutagen perm-stripping; added `--permissions-mode=portable + --default-file-mode-beta=0644`.
- **Bug G** — rl-agent lacks docker.sock; routed through wollomatic proxy via `DOCKER_HOST`.
- **Bug H** — Healthcheck targeted `::1`; pinned `127.0.0.1`.
- **Bug I** — Sweeper wrote state files root:600; same-dir mktemp + chmod 664.
- Heartbeat daemon FD leak — caused MCP hangs on every claim; fixed with `disown` + FD detach.

### Phase 5 — Test plans + screenshots + comments (`e8c11628`, `dc9461ea`, `4a11dbd3`, `7bb4da90`, `2957b04d`, `1cb9b3ab`, `5f4c5602`, `035088f2`, `7aac510b`, `dc20417e`, `41d0dc90`, `96a06228`, `32ac21c3`, `d9efde07`)
Built out the dashboard test-plan UX:
- `rl_test_plan_create / status / wait / clear` MCP tools.
- Sequential step ordering enforced server-side; verdicts buffer locally then submit as one batch (agent gets one signal per round, not one per click).
- Reset signals immediately for re-test loops.
- Screenshot upload (5MB cap, png/jpeg/webp), base64-JSON encoded.
- Comment bodies wrapped in `<untrusted-tester-comment>` tags.
- Tester name persisted in 1-year cookie + localStorage.
- Auto-refresh removed (caused empty-render in incognito); manual "tap-the-dot" refresh only.
- **Bug J** — `rl_test_plan_wait` returned on spurious inotify wakes; fixed with `last_updated_at` baseline + remaining-time loop.
- Dashboard server.js + public/ are **bind-mounted** in compose for live edits without rebuild.

### Phase 6 — ROK-1324 slot-stable OAuth + sync correctness (`d91817c7`, `433b6599`, `f16028f5`, `d1c97a06`, `2c19fc64`, `61fe6c67`, `69395c41`, `f0593807`)
- **ROK-1324** — Added `slot-N.{DOMAIN}` Traefik routing + Discord OAuth callback URL rewrite. Same env addressable via both per-slug AND slot-stable URLs; slot-stable supports Discord login (registered redirect URI in Discord dev portal).
- env-spin now bootstraps `admin@local` via `docker exec ... bootstrap-admin.js` and returns email + password in the JSON response. Uses `RL_ADMIN_PASSWORD` from `/srv/rl-infra/.env` if set (stable across deploys) or generates a 16-char hex per-call.
- **Bug P** — full-mode sync had no TRUNCATE, broke on PK collisions, no rollback; fixed with dynamic TRUNCATE pre-step + `--single-transaction` + `ON_ERROR_STOP=1`.
- **Bug Q** — schema-drift filter excluded TABLES but not SEQUENCES (awk regex quoting bug, can't pass newlines via `-v`); fixed with `|` separator.
- `url` field defaults to slot-form everywhere — agents kept using the per-slug URL despite Discord login not working on it. Tool descriptions updated to say "ALWAYS use `url`".
- /bulk + /fix-batch skill intros updated; CLAUDE.md MCP table refreshed; four memory entries added.

### Phase 7 — rok-1325 round of bugs (`2e8c1e5d`, this turn)
Three more bugs from the rok-1325 agent's deploy session:
- **Bug 1 (was Bug C revisited)** — Mutagen bidirectional sync polluted fresh agent worktrees with operator's main-repo WIP. Switched to `--mode=one-way-replica` so the laptop is the source of truth.
- **Bug 2** — `chmod +x` on Mutagen-stressed files (landing at 0600) produced 0711 — no read for group/other → Alpine `/bin/sh` can't open the script → restart loop. Changed five `RUN chmod +x` to `RUN chmod 0755` in `Dockerfile.allinone`. Strict superset: hardens the fleet build, no-ops on the NAS prod build path (CI checkouts are 0644).
- **Bug 3** — `rl_env_deploy` returned `ok: true` when sync_settings failed silently. The env has no Discord/IGDB/ITAD credentials AND no admin@local seeded after that failure — not "non-fatal" as the old comment claimed. Now propagates to top-level `ok: false` + `error: "sync_settings_failed"` + message leads with `FAILED: ...` + recovery hint.

---

## 3. Open bugs / known limitations (NOT fixed in this batch)

These are surfaced in **ROK-1326** (this batch's tech-debt follow-up):

| # | Title | Surface | Severity |
|---|---|---|---|
| Bug R | `rl_validate_ci` chokes on worktree's `.git` pointer file | The runner's `/workspace/.git` is a pointer to a laptop-only path (`.git/worktrees/<name>`). Any git command on the runner → `fatal: not a git repository`. Blocks `validate-ci.sh` (needs diff vs origin/main). | High — blocks fleet validate-ci path |
| Bug S | Mutagen perm-strip is broader than just shell scripts | The `chmod 0755` Bug 2 fix only patched 5 hand-picked scripts. Same class breaks `drizzle/migrations/meta/_journal.json` (`-rw-------` after sync → Drizzle migrator can't read). Surfaced by rok-1325 agent attempting `RUN chmod -R a+rX ./drizzle/migrations ./dist ./assets ./seeds ./node_modules` — partial fix, needs broader strategy. Root cause likely upstream of `--default-file-mode-beta=0644` not enforcing for already-existing source files. | High — every `COPY --from=builder` is exposed |

See ROK-1326 for proposed fixes and tradeoffs.

---

## 4. Files / dirs to focus review on

Tier 1 (security / correctness):
- `tools/mcp-rl-fleet/src/index.ts` — argument validation, RL_OPERATOR forcing, ssh args.
- `tools/mcp-rl-fleet/src/exec.ts` — balanced-brace JSON extraction from CLI output.
- `tools/mcp-rl-fleet/src/tools/run-on-runner.ts`, `validate-ci.ts`, `env-deploy.ts` — what the agent can ask the runner to execute.
- `rl-infra/cli/rl` — bash quoting, `set -e` discipline, Mutagen session management.
- `rl-infra/dashboard/server.js` — endpoint surface, `stripCommentBodies` vs `wrapCommentBodies`, attachment upload bounds, no-auth boundary.

Tier 2 (operational correctness):
- `rl-infra/orchestrator/bin/env-spin` — slot-ownership guards, per-slot env cap (`MAX_ENVS_PER_SLOT=5`), admin-bootstrap path, env vars passed into allinone.
- `rl-infra/gc-sweeper/sweep.sh` — reaping rules, unhealthy grace window (15min), state-file perm fix.
- `scripts/sync-local-to-env.sh` — TRUNCATE + transaction, schema-drift filter, URL rewrite, admin bootstrap.
- `rl-infra/docker-compose.yml` — bind mounts (dashboard public + server.js, sweep.sh, /state/locks for Discord lock).

Tier 3 (agent UX):
- `.claude/skills/_shared/rl-{infra-fleet,fleet-preflight}.md` — agent context.
- `.claude/skills/build/{SKILL.md,steps/*.md}` — fleet vs local mode branching.
- `CLAUDE.md` rl-fleet MCP table + STRICT rule.

Doc-only (light scan):
- `rl-infra/README.md`, `rl-infra/SETUP.md`, `rl-infra/vscode/`, memory references.

---

## 5. Things explicitly out of scope for this batch

- A real backup/restore of fleet state (slot leases, env registry) survives `docker compose down`, but disaster recovery is not built. Single VM is intentional.
- Multi-VM scaling.
- TLS-internal between runner ↔ allinone (LAN is trusted in this stack).
- A "production-like" smoke env (this fleet is for branch validation, not load testing).

---

## 6. Review checklist for the next agent

- [ ] Read `rl-infra/README.md` first (15 min) — fastest grasp of the fleet model.
- [ ] Read this doc (you're here) — context for what changed and why.
- [ ] Skim Tier 1 files end-to-end. Run Codex / second-opinion review.
- [ ] Spot-check Tier 2 files. Focus on `set -e` discipline + bash quoting + JSON parsing edge cases.
- [ ] Verify Bug R + Bug S are not regressions of anything in this batch (they're pre-existing — Mutagen behavior, not code-introduced this batch).
- [ ] Confirm operator-config STRICT rule still allows this batch to ride bundled (`rl-infra/**` is operator config per CLAUDE.md).
