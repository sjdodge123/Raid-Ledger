# Spec: ROK-1036 — Drop API and nginx privileges from root to `app` user in allinone container

**Plan:** No plan exists under `docs/plans/`. Authoritative source = Linear story body (https://linear.app/roknua-projects/issue/ROK-1036). This is an infrastructure / security hardening change with **no contract-layer, NestJS-module, or React-component surface**; the spec template's web/contract sections are intentionally marked N/A and replaced with infrastructure-equivalent sections (Dockerfile.allinone, supervisor config, nginx config, entrypoint shell scripts).
**Date:** 2026-05-14
**Status:** draft

## Overview

In the allinone production image (`Dockerfile.allinone`), `supervisord` runs as root and starts four child programs. Postgres drops to `postgres` via `su-exec` and Redis drops via `user=redis`, but **the Node.js API and nginx inherit root**. Any RCE in the API (dependency CVE, prototype-pollution chain) currently grants root inside the container — including write access to `/data/postgresql` (which uses `trust` auth on the local Unix socket), to `/data/.jwt_secret`, and to the supervisor config itself.

The `app` user (UID 1001) is already created at `Dockerfile.allinone:106` and added to the `redis` group (so it can read the Redis Unix socket at `/tmp/redis.sock`, mode 770) — it just isn't assigned to anything yet.

This story does the minimum-viable privilege drop:

1. **API** → run the entire `start-api.sh` → `docker-entrypoint.sh` → `node main.js` chain as `app` (supervisor `user=app`).
2. **nginx** → master stays root (needs to bind port 80); worker processes drop to `app` via `user app;` at the top of `nginx/monolith.conf.template`. This is the standard nginx privilege model.
3. **Filesystem prep** → `entrypoint.sh` (still root, runs before supervisord) creates and chowns the directories + files the API will need to write to as `app`: `/data/logs`, `/data/backups`, `/data/avatars`, `/data/uploads`, plus the ROK-1035 secret files and log files for `tee`.
4. **PostgreSQL readiness** → `start-api.sh` no longer calls `su-exec postgres pg_isready` (would fail when start-api itself runs as `app`); replace with `pg_isready -h localhost -q` over TCP. Same swap for the `psql … CREATE EXTENSION` calls — but those still need superuser, so they must move out of `start-api.sh`.
5. **Ollama guard** → add a `process.getuid() !== 0` check in `OllamaNativeService` that logs a warning and skips setup. The native Ollama path requires writes to `/usr/local/bin`, `/usr/local/lib/ollama`, `/etc/supervisor.d/services`, and the supervisord control socket (`/run/supervisord.sock`, mode 0700). Relocating those is **scoped out** to a follow-up story; this spec only adds the guard so the API doesn't crash trying to mkdir `/usr/local/lib/ollama` as `app`.
6. **Diagnostic logging** → ownership state after chown, API identity at startup, pg_dump runner at snapshot time. The privilege drop touches every filesystem write the API does; if anything is mis-chowned we want a single `docker logs` look to identify which path failed and which user is hitting the wall.
7. **Log-file ownership restoration** → the recursive `chown -R app:app /data/logs` is a sledgehammer that re-owns `postgresql.log` and `redis.log` to `app`, breaking subsequent tee/append by postgres/redis. After the app-block, explicitly `touch + chown` those two files back to their respective users.
8. **CI gate for the upgrade path** → add a synthetic-production-volume job/step to `.github/workflows/ci.yml`. The existing container-startup job only covers fresh-volume; this story owns regression coverage for the populated-volume case (root-owned secret, root-owned logs, populated `/data/avatars`, populated `/data/backups/daily`).

Ship AFTER ROK-1035 (`.jwt_secret` persisted to `/data/.jwt_secret`, chmod 600) so there is a known-good rollback point between the two changes. This is its own PR per CLAUDE.md "Infrastructure Changes" rule — no code changes ride along.

## Contract Layer (`packages/contract`)

**N/A.** No request/response shapes change. No new schemas. No contract rebuild needed for this PR.

## Infrastructure surface (replaces "NestJS Module Spec")

### File-by-file changes

#### `Dockerfile.allinone`

**A. Supervisor config — `[program:api]` (currently at lines 231-242).**

Add `user=app`:

```ini
[program:api]
command=/bin/bash -c '/app/start-api.sh 2>&1 | tee -a /data/logs/api.log'
directory=/app
environment=PORT=3000
user=app                              # ← NEW
autostart=true
autorestart=true
priority=40
startsecs=15
startretries=5
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
redirect_stderr=true
```

No other supervisor program changes. **`[program:nginx]` does NOT get `user=app`** — that would prevent the nginx master from binding port 80.

**B. `start-api.sh` (currently lines 265-362).** Three changes.

1. **Replace `su-exec postgres pg_isready`** (line 271) with TCP probe:

   ```bash
   # Wait for PostgreSQL to be ready
   echo "⏳ Waiting for PostgreSQL..."
   until pg_isready -h localhost -q; do
     sleep 1
   done
   echo "✅ PostgreSQL is ready"
   ```

2. **Move the `CREATE EXTENSION` calls out of `start-api.sh`.** Currently lines 283-304 run `su-exec postgres psql … CREATE EXTENSION`. Those calls need postgres superuser, which the `app` user cannot become via `su-exec` (`su-exec` requires root).

   **Solution:** rely on `init-db.sh` for fresh installs (it already runs the same `CREATE EXTENSION IF NOT EXISTS vector` and `pg_stat_statements` lines while postgres is bootstrapping) and add a one-shot extension-ensure step to **`entrypoint.sh`** (still root, runs once before supervisord). This keeps the idempotency story intact for existing volumes:

   ```bash
   # In entrypoint.sh, AFTER init-db.sh and BEFORE supervisord exec:
   # Existing volumes (PG_VERSION present) skipped init-db's extension step;
   # ensure pgvector + pg_stat_statements are installed on every boot via the
   # postgres superuser. We can't do this from start-api.sh anymore because it
   # runs as `app` and can't `su-exec`.
   if [ -s "${PGDATA}/PG_VERSION" ]; then
     echo "🔍 Ensuring postgres extensions (vector, pg_stat_statements)..."
     # Start postgres temporarily on a private socket (won't conflict with
     # supervisor's instance because supervisor hasn't launched yet).
     /sbin/su-exec postgres pg_ctl -D "${PGDATA}" \
       -o "-k /run/postgresql -c log_min_messages=FATAL" -w start 2>/dev/null
     /sbin/su-exec postgres psql -v ON_ERROR_STOP=1 -qt -d raid_ledger \
       -c "CREATE EXTENSION IF NOT EXISTS vector;" \
       -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;"
     /sbin/su-exec postgres pg_ctl -D "${PGDATA}" -m fast -w stop 2>/dev/null
     echo "✅ Extensions ensured"
   fi
   ```

   Delete the two extension blocks from `start-api.sh` (lines 277-304). The Redis-readiness wait (line 308) stays — `app` is in the `redis` group and can `redis-cli -s /tmp/redis.sock ping`.

3. **Add identity/permission logging at the very top of `start-api.sh`** (before any other work):

   ```bash
   #!/bin/bash
   set -e

   echo "🔒 API running as: $(id)"
   echo "   Can write /data/logs:    $(test -w /data/logs    && echo 'yes' || echo 'NO — PERMISSION DENIED')"
   echo "   Can write /data/backups: $(test -w /data/backups && echo 'yes' || echo 'NO — PERMISSION DENIED')"
   echo "   Can write /data/avatars: $(test -w /data/avatars && echo 'yes' || echo 'NO — PERMISSION DENIED')"
   echo "   Can write /data/uploads: $(test -w /data/uploads && echo 'yes' || echo 'NO — PERMISSION DENIED')"
   echo "   Redis socket readable:   $(test -r /tmp/redis.sock && echo 'yes' || echo 'not yet / NO')"
   ```

**C. `entrypoint.sh` (currently lines 424-444).** Extend the existing chown block to cover everything `app` must own. Runs as root.

```bash
#!/bin/bash
set -e

# Existing — postgres and redis dirs
mkdir -p /data/postgresql /data/redis /data/backups/daily /data/backups/migrations /data/logs /data/ollama/models
chown -R postgres:postgres /data/postgresql
chown -R redis:redis /data/redis

# NEW — app-owned dirs (mkdir is idempotent; chown with || true so a fresh
# volume that hasn't created some of these yet doesn't fail the script).
mkdir -p /data/logs /data/backups/daily /data/backups/migrations /data/avatars /data/uploads/branding
chown -R app:app /data/logs /data/backups /data/avatars /data/uploads 2>/dev/null || true

# NEW — ROK-1035 secret files (root:root 600 on existing volumes).
# Touch + chown so cat-as-app works; `|| true` for fresh installs where the
# files don't exist yet (start-api.sh creates them later).
chown app:app /data/.jwt_secret /data/.jwt_secret_migrated 2>/dev/null || true

# NEW — log files for tee. Supervisor pipes `start-api.sh | tee -a /data/logs/api.log`.
# On existing volumes those files are root:root from prior runs; touch + chown
# so the unprivileged tee can append.
touch /data/logs/api.log /data/logs/nginx.log
chown app:app /data/logs/api.log /data/logs/nginx.log

# NEW — restore log ownership for the OTHER supervised programs. The `chown -R
# app:app /data/logs` above is a sledgehammer that re-owns postgresql.log,
# redis.log, ollama.log, supervisor-events.log to `app`. Postgres and redis
# write their own logs as their own user (postgres:postgres / redis:redis);
# if their existing log files are owned by `app`, those programs will EACCES
# on first append. Touch-and-chown each one back so existing log files survive
# the recursive chown unchanged. `|| true` so a fresh install (no log file yet)
# doesn't fail — supervisor will create the file with the program's UID on
# first run, which is correct.
touch /data/logs/postgresql.log
chown postgres:postgres /data/logs/postgresql.log 2>/dev/null || true
touch /data/logs/redis.log
chown redis:redis /data/logs/redis.log 2>/dev/null || true
# ollama.log + supervisor-events.log + .logrotate.state are all written by
# programs that supervisord runs as root, so app-owned is fine — but logrotate
# (root) needs to keep being able to rotate them, which it can. No action.

# NEW — diagnostic block. One docker-logs look should answer "did chown run?".
echo "🔒 PRIVILEGE DROP: filesystem prepared for app (UID 1001)"
echo "   /data/logs          → $(ls -ld /data/logs    | awk '{print $3":"$4}')"
echo "   /data/backups       → $(ls -ld /data/backups | awk '{print $3":"$4}')"
echo "   /data/avatars       → $(ls -ld /data/avatars | awk '{print $3":"$4}')"
echo "   /data/uploads       → $(ls -ld /data/uploads | awk '{print $3":"$4}')"
echo "   .jwt_secret owner   → $(ls -l /data/.jwt_secret 2>/dev/null | awk '{print $3":"$4}' || echo 'not yet created')"
echo "   /tmp/redis.sock     → $(ls -la /tmp/redis.sock 2>/dev/null || echo 'not yet created')"
echo "   app user groups     → $(id app)"

# Existing — initialize DB on first run (fresh install path).
/app/init-db.sh

# NEW — ensure extensions on existing volumes (see start-api.sh section above
# for the rationale; this is the migrated block).
# … see B.2 above for full block …

# Existing — nginx port substitution.
export NGINX_PORT="${PORT:-80}"
envsubst '${NGINX_PORT}' < /etc/nginx/http.d/default.conf.template > /etc/nginx/http.d/default.conf

# Existing — start supervisor.
exec supervisord -c /etc/supervisor.d/raid-ledger.ini
```

**Do NOT `chown -R /data`.** That would re-own `/data/postgresql` (must be `postgres:postgres`) and `/data/redis` (must be `redis:redis`). The block above only touches paths the API writes to.

#### nginx — `RUN sed` patch on `/etc/nginx/nginx.conf` (NOT `monolith.conf.template`)

**Amended 2026-05-15 after architect risk review.** Alpine's `nginx` package ships `nginx.conf` with `user nginx;` UNCOMMENTED at line 3 — not `#user nginx;` as the original spec assumed. The original regex `s/^#user nginx;/user app;/` matched zero lines and the `|| echo` fallback then appended a second `user app;` at EOF, leaving the file with TWO `user` directives. Nginx parses last-one-wins so it coincidentally worked, but `nginx -t` does not warn about duplicates → silent regression risk on any future reorder/dedup.

`monolith.conf.template` is included as a `server { }` block, NOT main context — `user` directives there are ignored by nginx. **Do NOT add `user app;` to the template.** The Dockerfile sed approach is the only correct option.

Add this `RUN` to `Dockerfile.allinone` AFTER the `app` user is created (line ~108) and BEFORE the existing `chown -R app:app /run/nginx …` (line ~126):

```dockerfile
# Drop nginx worker privileges to app (master stays root for port 80 binding).
# Replaces any existing top-level `user <name>;` directive (commented or not)
# with `user app;`. Appends if absent. Idempotent across rebuilds and across
# whatever stock nginx.conf the alpine `nginx` package ships in future versions.
RUN sed -i 's/^[[:space:]]*#*[[:space:]]*user[[:space:]]\+[a-zA-Z0-9_-]\+;/user app;/' /etc/nginx/nginx.conf && \
    grep -q '^user app;' /etc/nginx/nginx.conf || echo 'user app;' >> /etc/nginx/nginx.conf
```

Architect verified behavior in a clean `node:20-alpine + apk add nginx` container:

| Stock file state | After pass 1 | After pass 2 |
|------------------|---------------|---------------|
| `user nginx;` (Alpine today) | `user app;` at line 3, no duplicate | unchanged |
| `#user nginx;` (hypothetical future Alpine) | `user app;` at line 3 | unchanged |
| no `user` directive | appended `user app;` at EOF | unchanged |

Produces exactly one `user app;` line and `nginx -t` accepts it (the `app` user is created on line ~106 before this `RUN`).

#### `api/scripts/docker-entrypoint.sh`

One change: annotate the pre-migration `pg_dump` log line with the current user identity. Currently line 12:

```sh
echo "📸 Taking pre-migration database snapshot..."
```

Change to:

```sh
echo "📸 Taking pre-migration database snapshot as $(whoami) (UID $(id -u))..."
```

This is the single hottest log line for diagnosing the new failure mode "pg_dump silently produced an empty file because `app` couldn't write `/data/backups/migrations/`". No behavior change.

#### `api/src/ai/providers/ollama-native.service.ts`

Add a UID guard in the constructor (or as the first line of `startService`, `install`, and `writeSupervisorConfig` — wherever a root-required side effect happens):

```ts
@Injectable()
export class OllamaNativeService {
  private readonly logger = new Logger(OllamaNativeService.name);
  private readonly allinoneMode: boolean;
  private readonly hasRoot: boolean;

  constructor() {
    this.allinoneMode = existsSync(ALLINONE_SENTINEL);
    this.hasRoot = typeof process.getuid === 'function' && process.getuid() === 0;
    if (this.allinoneMode && !this.hasRoot) {
      this.logger.warn(
        'Ollama native provider requires root in the allinone container; ' +
        'API is now running as app (UID 1001). Ollama setup will be skipped. ' +
        'Tracked as a follow-up to ROK-1036.',
      );
    }
  }

  // Each side-effectful method short-circuits when !hasRoot:
  async startService(): Promise<void> {
    if (!this.hasRoot) return;
    await this.execQuick('supervisorctl', ['reread']);
    // …
  }

  async install(): Promise<void> {
    if (!this.hasRoot) return;
    // …
  }

  writeSupervisorConfig(): void {
    if (!this.hasRoot) return;
    writeFileSync(SUPERVISOR_CONFIG_PATH, SUPERVISOR_CONFIG);
    // …
  }
}
```

`getServiceStatus()` and `isBinaryInstalled()` are read-only and safe to leave unguarded — they'll return `'not-found'` / `false` naturally when the binary/socket aren't there.

`isAllinoneMode()` keeps its current semantic (the sentinel file is readable by `app`). Callers that branch on it can also check a new `isOllamaAvailable()` helper if they need to short-circuit higher up.

### Drizzle schema

**N/A.** No schema changes.

### Database / migrations

**N/A.** No new migrations.

## React Component Spec (`web`)

**N/A.** No UI surface for this change.

## Behavior Specifications

### Scenario: Fresh install (volume empty, all paths absent)

- **Given:** `docker run -p 8080:80 -v rl-fresh:/data ghcr.io/sjdodge123/raid-ledger:test` with `rl-fresh` empty.
- **When:** the container boots.
- **Then:**
  - `entrypoint.sh` (as root) creates `/data/postgresql`, `/data/redis`, `/data/backups/daily`, `/data/backups/migrations`, `/data/logs`, `/data/avatars`, `/data/uploads/branding`, `/data/ollama/models`.
  - Postgres and Redis dirs are `chown postgres:postgres` and `redis:redis`. App-write dirs are `chown -R app:app`.
  - `init-db.sh` initializes Postgres and creates the `raid_ledger` user/db plus `vector` and `pg_stat_statements` extensions.
  - The "ensure extensions" block in `entrypoint.sh` no-ops because `init-db.sh` already created them.
  - supervisord launches; `[program:api]` starts `start-api.sh` as `app` (UID 1001).
  - `start-api.sh` logs `🔒 API running as: uid=1001(app) gid=1001(app) groups=1001(app),82(redis)` and `Can write …: yes` for all four data paths.
  - `start-api.sh` generates a new JWT secret (`/data/.jwt_secret` written as `app:app` 600) because the file doesn't exist yet.
  - `docker-entrypoint.sh` runs migrations, bootstraps admin, seeds games — all as `app`.
  - nginx master is root, workers are `app` (verifiable via `docker exec rl ps -o user,comm`).
  - `curl http://127.0.0.1:8080/api/health` returns `{"status":"ok"}`.

### Scenario: Upgrade from an existing production volume (root-owned files everywhere)

- **Given:** an existing `/data/` volume from the pre-1036 image, containing `/data/.jwt_secret` (root:root 600 from ROK-1035), `/data/logs/api.log` (root:root from old runs), populated `/data/postgresql` (postgres:postgres), populated `/data/backups/daily/*.dump` (root:root), and root-owned `/data/avatars/*.png` files.
- **When:** the new image starts against this volume.
- **Then:**
  - `entrypoint.sh` (root) `chown app:app /data/.jwt_secret` and `/data/.jwt_secret_migrated`.
  - `entrypoint.sh` `chown -R app:app /data/logs /data/backups /data/avatars /data/uploads`. The recursive chown re-owns every existing avatar PNG and every prior backup dump.
  - `touch /data/logs/api.log /data/logs/nginx.log` is a no-op (files already exist); the explicit `chown app:app` on those two paths flips them from `root:root` to `app:app` so the supervisor `tee -a` works.
  - `/data/postgresql` stays `postgres:postgres` (NOT touched by the app-chown lines).
  - The "ensure extensions" block runs (because `PG_VERSION` is present) and `CREATE EXTENSION IF NOT EXISTS` succeeds idempotently.
  - API starts as `app`, reads `.jwt_secret`, performs migrations + backup snapshot (writing to `/data/backups/migrations/` — now app-owned).
  - All logged write-permission checks return `yes`.

### Scenario: API attempts to write to a missed path (regression detection)

- **Given:** the image ships with a missing chown for a directory the API writes to (e.g. someone adds a new feature that writes `/data/exports/` without updating `entrypoint.sh`).
- **When:** the API tries to write to the missed path.
- **Then:**
  - `start-api.sh`'s `Can write …` block does NOT cover the new path, but the API logs a 500 with the EACCES error.
  - Operator sees the failure in `/data/logs/api.log`, identifies the missing path, and adds a `mkdir -p && chown app:app` line to `entrypoint.sh`.
  - This is the trade-off: agreed lossy diagnostic coverage (4 known paths) vs the alternative of `chown -R app:app /data/exclude=postgresql,redis` which doesn't exist in coreutils.

### Scenario: Ollama setup attempted while running as `app`

- **Given:** allinone container booted with ROK-1036 changes; admin enables the native Ollama provider via `POST /admin/ai/providers/ollama-native/setup`.
- **When:** `OllamaNativeService.install()` is called.
- **Then:**
  - The constructor has already logged the warning `Ollama native provider requires root … Ollama setup will be skipped`.
  - `install()` returns immediately (no-op) without attempting to write to `/usr/local/bin/ollama` or `/usr/local/lib/ollama`.
  - The admin endpoint returns a structured "not available" response (or the existing error response, whichever the controller currently emits when `install` throws/no-ops — confirm during implementation).
  - No EACCES errors appear in `api.log`.

### Scenario: nginx workers drop to `app`, master stays root

- **Given:** the container is running.
- **When:** `docker exec rl ps -o user,pid,comm | grep nginx`.
- **Then:** output shows exactly one `root … nginx: master process` line and N (typically 1-2, matching `worker_processes auto;`) `app … nginx: worker process` lines.
- **And:** `curl http://127.0.0.1:8080/api/health` works (proves master can still bind 80 and proxy to the API).

### Scenario: synthetic-production-volume test

- **Given:** the test volume from the Linear story's "Testing with synthetic production volume" snippet — `.jwt_secret` root:root 600, log files root:root, postgres/redis dirs with correct ownership.
- **When:** the new image is run against it.
- **Then:** health check passes within 60s, `ps aux` shows nginx workers + node as `app`, no `PERMISSION DENIED` in logs.

## Error Handling Matrix

| Error Condition | Diagnostic Signal | Likely Root Cause | Fix |
|-----------------|-------------------|-------------------|-----|
| API hangs at "Waiting for PostgreSQL" | `start-api.sh` log shows `su-exec: setuid` errors | `su-exec` line not replaced with `pg_isready -h localhost` | Update `start-api.sh` |
| API exits at startup with `cat: /data/.jwt_secret: Permission denied` | `start-api.sh` ran (logged identity), then crashed reading secret | `.jwt_secret` not chowned in entrypoint | Add `chown app:app /data/.jwt_secret` to entrypoint |
| API logs `Can write /data/backups: NO — PERMISSION DENIED` then pg_dump fails | start-api identity log + `docker-entrypoint.sh` snapshot warning | `/data/backups` not in chown list, OR a sub-path is still root | `chown -R app:app /data/backups` in entrypoint |
| Avatar / branding upload returns 500 | API log: EACCES on `/data/avatars/xxx.png` or `/data/uploads/branding/…` | New directory created post-chown step ran | Ensure chown runs recursively; or refresh ownership on container restart |
| Redis connection fails on startup | `start-api.sh` log: `Redis socket readable: NO` | `app` not in `redis` group (Dockerfile groupadd) | Verify `addgroup app redis` in Dockerfile.allinone:108 |
| nginx 502 on all `/api/*` routes | nginx logs `connect() failed (111: Connection refused)` | API not listening yet (timing) OR API crashed silently | Check api.log for crash; nothing privilege-drop specific |
| nginx won't start | nginx error log: `bind() to 0.0.0.0:80 failed (13: Permission denied)` | Someone added `user=app` to `[program:nginx]` | Remove that line; nginx master must be root |
| Log files `/data/logs/*.log` stay empty | `supervisord` log shows `tee: /data/logs/api.log: Permission denied` | Log files not chowned in entrypoint | Add `touch + chown app:app /data/logs/{api,nginx}.log` to entrypoint |
| Ollama admin endpoint silently no-ops | API log: `Ollama native provider requires root` warning at boot | Expected post-1036; tracked as follow-up | None — behavior intentional |
| Postgres extension missing after upgrade | `start-api.sh` log: connection works but `vector` type missing | Extension-ensure block in entrypoint never ran OR private-socket start failed | Check entrypoint logs around "Ensuring postgres extensions"; verify pg_ctl temporary start path |
| Recursive chown is slow on large volumes (10k+ avatar PNGs) | `entrypoint.sh` blocks for 30+s before supervisord starts | Expected on first upgrade only; subsequent boots are fast | None — one-time cost |

## Dependencies

- **Contract:** none (this PR has no contract surface).
- **API internal:** `OllamaNativeService` — guard added; no other API code changes. Existing TCP `pg_isready` shipped with the `postgresql16-client` package (already installed in the production stage).
- **Web internal:** none.
- **External:**
  - `su-exec` (still used by `init-db.sh` and the new "ensure extensions" block in `entrypoint.sh`).
  - `pg_isready` from `postgresql16-client` — already installed at `Dockerfile.allinone:75`.
- **Prerequisite stories:**
  - ROK-1035 (persisted `.jwt_secret` at `/data/.jwt_secret` chmod 600). Already shipped — provides the file ROK-1036 must chown.
- **Blocked by:** none.
- **Blocks:** the follow-up "Ollama-as-app" story (will relocate Ollama paths into `/data/ollama/` so the native provider works without root). Not in scope for this PR.

## Acceptance Criteria (test-mapped)

These ACs trace 1:1 to the Linear story body, with the local-verification command for each.

| AC | Verification |
|----|--------------|
| `[program:api]` has `user=app` in supervisor config | `docker exec rl grep -A1 '\[program:api\]' /etc/supervisor.d/raid-ledger.ini` |
| `[program:nginx]` has **NO** `user=` directive | `docker exec rl grep -A6 '\[program:nginx\]' /etc/supervisor.d/raid-ledger.ini` shows no `user=` line |
| nginx config has `user app;` at main context | `docker exec rl grep '^user' /etc/nginx/nginx.conf` returns `user app;` |
| `start-api.sh` uses `pg_isready -h localhost -q` (no `su-exec`) | `docker exec rl grep pg_isready /app/start-api.sh` |
| `entrypoint.sh` chowns `/data/logs`, `/data/backups`, `/data/avatars`, `/data/uploads` to `app:app` | `docker exec rl ls -ld /data/logs /data/backups /data/avatars /data/uploads` all show `app app` |
| `entrypoint.sh` chowns `/data/.jwt_secret` and `/data/.jwt_secret_migrated` with `\|\| true` | `docker exec rl grep -A1 '\.jwt_secret' /app/entrypoint.sh` shows `\|\| true` fallback |
| `entrypoint.sh` touches and chowns log files for tee | `docker exec rl ls -l /data/logs/api.log /data/logs/nginx.log` show `app app` |
| `entrypoint.sh` logs ownership state | `docker logs rl 2>&1 \| grep 'PRIVILEGE DROP'` shows the diagnostic block |
| `start-api.sh` logs identity + write checks | `docker logs rl 2>&1 \| grep '🔒 API running as'` shows `uid=1001(app)` |
| `docker-entrypoint.sh` pg_dump log includes user | `docker logs rl 2>&1 \| grep 'pre-migration database snapshot as'` shows `app (UID 1001)` |
| `ollama-native.service.ts` guards on non-root | Unit test `ollama-native.service.spec.ts` mocks `process.getuid → 1001` and asserts `install()` is a no-op + warning is logged |
| Postgres TCP connection works as `app` | `curl http://127.0.0.1:8080/api/health` returns `{"status":"ok"}` with `db.connected: true` |
| Redis socket accessible by `app` | health check passes; `docker exec rl id app` shows `redis` in groups |
| Avatar upload works | Manual: log in to dev image, upload avatar, verify file appears in `/data/avatars/` owned by `app:app` |
| Branding logo upload works | Manual: admin → branding, upload logo, verify file in `/data/uploads/branding/` owned by `app:app` |
| pg_dump snapshot works | `docker exec rl ls /data/backups/migrations/` shows recent `pre_migration_*.dump` files owned by `app:app` |
| `ps aux` privilege topology | `docker exec rl ps -o user,comm` — exactly one `root nginx`, ≥1 `app nginx`, and `app node` |
| Synthetic production volume test | Run the snippet from Linear story (root-owned `.jwt_secret`, root-owned log files, postgres-owned PGDATA). Health check passes within 90s, no `PERMISSION DENIED` in `docker logs`. |
| `postgresql.log` stays `postgres:postgres` after recursive chown | `docker exec rl ls -l /data/logs/postgresql.log` shows `postgres postgres` (NOT `app app`). Regression guard for the chown-collision gap. |
| `redis.log` stays `redis:redis` after recursive chown | `docker exec rl ls -l /data/logs/redis.log` shows `redis redis` (NOT `app app`). Same regression guard. |
| CI gates the upgrade-path scenario, not just fresh-volume | `.github/workflows/ci.yml` contains a job/step that seeds a populated synthetic prod volume (root-owned secret + log files + PNGs + dump) and asserts the health check + ownership invariants above. Failing the assertions fails CI. |

## Test Plan

Per CLAUDE.md "Infrastructure Changes (STRICT)":

1. **Read both Dockerfiles** before any change — confirmed: `api/Dockerfile` (compose dev/test, user=nestjs, Redis TCP) is unaffected by this PR; all changes are in `Dockerfile.allinone`.
2. **Local allinone build:** `docker build -f Dockerfile.allinone -t rl:rok-1036 .`
3. **Fresh-volume smoke:**
   ```bash
   docker volume create rl-fresh
   docker run --rm -d --name rl-fresh -v rl-fresh:/data -p 8080:80 rl:rok-1036
   # Wait up to 60s
   until curl -fsS http://127.0.0.1:8080/api/health 2>/dev/null; do sleep 2; done
   docker exec rl-fresh ps -o user,pid,comm | grep -E 'nginx|node'
   docker logs rl-fresh 2>&1 | grep -E '🔒|PRIVILEGE DROP|PERMISSION DENIED'
   docker stop rl-fresh
   docker volume rm rl-fresh
   ```
4. **Synthetic-production-volume smoke** (from Linear story body):
   ```bash
   docker volume create rl-priv-test
   docker run --rm -v rl-priv-test:/data alpine sh -c '
     mkdir -p /data/postgresql /data/redis /data/backups/daily /data/backups/migrations \
              /data/logs /data/avatars /data/uploads/branding
     echo "test-secret-value" > /data/.jwt_secret
     chmod 600 /data/.jwt_secret
     touch /data/.jwt_secret_migrated
     echo "old log" > /data/logs/api.log
     echo "old log" > /data/logs/nginx.log
     addgroup -g 70 -S postgres; adduser -S -D -H -u 70 -G postgres postgres
     addgroup -g 82 -S redis;    adduser -S -D -H -u 82 -G redis    redis
     chown -R postgres:postgres /data/postgresql
     chown -R redis:redis      /data/redis
   '
   docker run --rm -d --name rl-priv-test -v rl-priv-test:/data -p 8080:80 rl:rok-1036
   sleep 30
   curl -fsS http://127.0.0.1:8080/api/health
   docker exec rl-priv-test ps aux | grep -E 'nginx|node'
   docker exec rl-priv-test ls -l /data/.jwt_secret /data/logs/api.log
   docker exec rl-priv-test bash -c 'ls -ld /data/{logs,backups,avatars,uploads}'
   docker stop rl-priv-test
   docker volume rm rl-priv-test
   ```
   The post-stop `ls -l /data/.jwt_secret` should show `-rw------- app app` (was `root root`).
5. **Avatar + branding upload manual test:** with the image running against `rl-priv-test`, log in, upload an avatar and a branding logo, then `docker exec ls -l /data/avatars /data/uploads/branding` — new files owned by `app:app`.
6. **Unit test for Ollama guard:** add to `api/src/ai/providers/ollama-native.service.spec.ts`:
   - mock `process.getuid` to return `1001` → assert `install()`, `startService()`, `writeSupervisorConfig()` are no-ops and the warning was logged.
   - mock to return `0` → assert original behavior.
7. **CI: fresh-volume gate (existing).** `./scripts/validate-ci.sh --full` for the regular checks; the container-startup job in CI exercises the fresh-volume smoke automatically.
8. **CI: synthetic-production-volume gate (NEW, part of ROK-1036).** Add a second container-startup step (or sibling job) that runs the synthetic-prod-volume bash block above (step 4) inside CI, end-to-end:
   - Seeds a volume with root-owned `.jwt_secret` (600), root-owned `/data/logs/{api,nginx,postgresql,redis}.log`, populated `/data/postgresql` (postgres:postgres), populated `/data/avatars/` with ~50 dummy PNGs (to exercise recursive chown on a non-empty tree), and populated `/data/backups/daily/` with a small `.dump` file (also root:root, to verify backup chown).
   - Runs the new allinone image against that volume.
   - Waits for `/api/health` to return `{"status":"ok"}` within 90s (NOT 60s — gives the upgrade-path chown its expected one-time cost without colliding with the timeout).
   - Asserts via `docker exec`:
     - `ps -o user,comm` shows `app node`, `app nginx` (workers), `root nginx` (master).
     - `ls -l /data/.jwt_secret` is `app:app 600`.
     - `ls -l /data/logs/postgresql.log` is `postgres:postgres` (regression catch for the chown-collision gap).
     - `ls -l /data/logs/redis.log` is `redis:redis` (same).
     - `ls -l /data/logs/api.log` is `app:app`.
     - `ls -l /data/avatars/*.png | head -3` shows `app:app` on at least one dummy file (recursive chown actually ran).
     - `docker logs` contains `🔒 API running as: uid=1001` and zero `PERMISSION DENIED` lines.
   - Hard-fails CI if any assertion fails. This is the regression gate the manual script in step 4 was meant to cover; integrating it stops a future entrypoint refactor from silently breaking the upgrade path.
   - Implementation note: lives in `.github/workflows/ci.yml` as a new step under the existing `container-startup` job, or a new job that depends on the same image build. Test fixtures (the dummy PNGs + dump) can be generated inline in the job script — keep them small (<1KB each) to avoid bloating the CI cache.
9. **No smoke / Playwright impact** — this story has no UI surface. Smoke tests run against the dev (`api/Dockerfile`) image which still runs as `nestjs` and is untouched.

## Rollback

- Watchtower auto-pulls daily 5 AM on the NAS. If this image breaks production:
  1. SSH to the NAS, pause Watchtower for the `raid-ledger-api` container.
  2. `docker pull ghcr.io/sjdodge123/raid-ledger:<previous-sha>` and re-tag as `:main`.
  3. Restart the container. The previous image runs as root and ignores all the `app:app` ownership work — rollback is safe because the new entrypoint never deletes anything, only re-owns.
- The `entrypoint.sh` chown does not destroy data: if the new image crashes before the API starts, the volume is left with `app:app` ownership on `/data/logs`, `/data/backups`, `/data/avatars`, `/data/uploads`, `.jwt_secret`. The old (root) image doesn't care — it runs everything as root, which can write to app-owned dirs just fine.

## Out of scope (deferred to follow-up stories)

- **Ollama-as-app:** relocate `/usr/local/bin/ollama`, `/usr/local/lib/ollama`, `/etc/supervisor.d/services/ollama.ini`, and widen `/run/supervisord.sock` perms so `OllamaNativeService` works as `app`. Currently guarded with a warning.
- **Compose-image privilege drop:** `api/Dockerfile` already uses `USER nestjs`; no change needed.
- **AppArmor / seccomp profiles:** out of scope for a userland privilege drop.
- **Read-only root filesystem (`--read-only` Docker flag):** would require an additional pass to identify every writable path; defer.
