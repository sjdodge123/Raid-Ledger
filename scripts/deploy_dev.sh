#!/bin/bash
# =============================================================================
# deploy_dev.sh - Local Development Environment
# =============================================================================
# Runs native API (watch mode) + Vite dev server against Docker DB + Redis.
# Shares the same DB volume as deploy_prod.sh.
#
# Usage:
#   ./scripts/deploy_dev.sh                  # Start dev environment
#   ./scripts/deploy_dev.sh --rebuild        # Rebuild contract package, then start
#   ./scripts/deploy_dev.sh --fresh          # Reset DB, new admin password, restart
#   ./scripts/deploy_dev.sh --reset-password # Reset admin password (no data loss)
#   ./scripts/deploy_dev.sh --branch rok-123 # Switch to feature branch, then start
#   ./scripts/deploy_dev.sh --down           # Stop everything
#   ./scripts/deploy_dev.sh --status         # Show process/container status
#   ./scripts/deploy_dev.sh --logs           # Tail API and web logs
#   ./scripts/deploy_dev.sh --ci --rebuild   # Non-interactive mode (for agents)
#
# Worktree-safe: auto-detects worktrees, uses correct Docker volumes, copies
# .env files from the main repo, and sources env vars for NestJS.
#
# Durable app_settings preservation: after each healthy deploy, the local API
# keys (the `app_settings` table — Blizzard/IGDB/ITAD/LLM/etc.) are snapshotted
# to ~/.raid-ledger/app-settings.local.sql — OUTSIDE the repo AND outside the
# Docker volume. Whenever a reset (--fresh, clone-prod, a `docker volume rm`, an
# agent running --fresh) leaves app_settings empty, the snapshot is auto-restored
# right after migrations, BEFORE the API starts. One mechanism covers every reset
# path, so the recurring local-keys wipe stops. (app_settings is EXCLUDED from
# all backups by design — ROK-1279 — and is NOT seeded from env, so without this
# snapshot every reset destroys the keys with no recovery.)
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CI_MODE=false

# Worktree detection: if .git is a file (not dir), we're in a worktree.
# Always use the main repo for Docker operations to avoid volume prefix issues.
if [ -f "$PROJECT_DIR/.git" ]; then
    IS_WORKTREE=true
    MAIN_REPO=$(git -C "$PROJECT_DIR" worktree list --porcelain | head -1 | sed 's/^worktree //')
else
    IS_WORKTREE=false
    MAIN_REPO="$PROJECT_DIR"
fi

# CRITICAL: Always use main repo's docker-compose.yml to avoid creating
# separate Docker volumes with the wrong directory prefix.
COMPOSE_FILE="$MAIN_REPO/docker-compose.yml"
ENV_FILE="$PROJECT_DIR/.env"
LOG_DIR="$PROJECT_DIR/.dev-logs"
PID_FILE="$PROJECT_DIR/.dev-pids"

# External app_settings snapshot — the durable preservation store. Lives in the
# same out-of-repo, out-of-volume state dir as the env lease (env-lock.sh), so it
# survives `--fresh`, `docker volume rm`, clone-prod, and any agent DB reset.
# Honors RAID_LEDGER_STATE_DIR like env-lock.sh for test overrides.
RL_STATE_DIR="${RAID_LEDGER_STATE_DIR:-$HOME/.raid-ledger}"
APP_SETTINGS_SNAPSHOT="$RL_STATE_DIR/app-settings.local.sql"
# Tilde form used ONLY in operator-facing messages (the actual path above is
# fully expanded for file ops). The literal ~ is intentional display text.
# shellcheck disable=SC2088
APP_SETTINGS_SNAPSHOT_DISPLAY="~/.raid-ledger/app-settings.local.sql"

cd "$PROJECT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_header() {
    echo -e "\n${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}\n"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

# Get current git branch
get_current_branch() {
    git branch --show-current 2>/dev/null || echo "unknown"
}

# Check if we're on an expected branch for testing
check_branch_for_testing() {
    local current_branch
    current_branch=$(get_current_branch)

    # Warn if not on main (feature branches are fine for testing)
    if [ "$current_branch" != "main" ]; then
        print_warning "BRANCH WARNING: Deploying from branch '$current_branch'"
        if [ "$CI_MODE" = true ]; then
            print_warning "    (CI mode — skipping interactive prompt)"
        else
            print_warning "    For post-merge verification, you usually want 'main'"
            echo ""
            echo -e "  ${YELLOW}Press Ctrl+C to cancel, or wait 5 seconds to continue...${NC}"
            sleep 5
        fi
    fi
}

# Switch to a specific branch
switch_branch() {
    local target_branch=$1
    local current_branch
    current_branch=$(get_current_branch)

    if [ "$current_branch" = "$target_branch" ]; then
        print_success "Already on branch '$target_branch'"
        return 0
    fi

    print_warning "Switching from '$current_branch' to '$target_branch'..."

    # Check for uncommitted changes
    if ! git diff-index --quiet HEAD -- 2>/dev/null; then
        print_error "Cannot switch branches: you have uncommitted changes"
        echo "  Commit or stash your changes first, then try again."
        exit 1
    fi

    # Switch branch
    if git checkout "$target_branch" 2>/dev/null; then
        print_success "Switched to branch '$target_branch'"
    else
        print_error "Failed to switch to branch '$target_branch'"
        echo "  Branch may not exist. Use: git branch -a"
        exit 1
    fi
}

# Copy .env files from main repo if in a worktree and they're missing
copy_env_if_worktree() {
    if [ "$IS_WORKTREE" = true ]; then
        if [ ! -f "$PROJECT_DIR/.env" ] && [ -f "$MAIN_REPO/.env" ]; then
            cp "$MAIN_REPO/.env" "$PROJECT_DIR/.env"
            print_success "Copied .env from main repo"
        fi
        if [ ! -f "$PROJECT_DIR/api/.env" ] && [ -f "$MAIN_REPO/api/.env" ]; then
            cp "$MAIN_REPO/api/.env" "$PROJECT_DIR/api/.env"
            print_success "Copied api/.env from main repo"
        fi
    fi
}

# Source .env file — exports into shell so child processes (NestJS) inherit them
load_env() {
    if [ -f "$ENV_FILE" ]; then
        set -a
        source "$ENV_FILE"
        set +a
    else
        print_error "Missing .env file at $ENV_FILE"
        if [ "$IS_WORKTREE" = true ]; then
            print_error "This is a worktree — .env must be copied from main repo."
            print_error "Main repo: $MAIN_REPO"
        fi
        exit 1
    fi
    # Also source api/.env if it exists (NestJS-specific vars)
    if [ -f "$PROJECT_DIR/api/.env" ]; then
        set -a
        source "$PROJECT_DIR/api/.env"
        set +a
    fi
}

show_credentials() {
    echo -e "  ${GREEN}Admin Email:${NC}    admin@local"
    echo -e "  ${YELLOW}Password was shown during first bootstrap or last reset.${NC}"
    echo -e "  ${YELLOW}To reset: set RESET_PASSWORD=true and restart, or use --reset-password${NC}"
}

# Stop Docker API/Web containers if running (they'd conflict on ports)
stop_docker_app() {
    local running
    running=$(docker compose -f "$COMPOSE_FILE" --profile test ps --format '{{.Name}}' 2>/dev/null || true)
    if echo "$running" | grep -q "raid-ledger-api\|raid-ledger-web"; then
        print_warning "Stopping Docker API/Web containers (would conflict with native dev)..."
        docker compose -f "$COMPOSE_FILE" --profile test stop api web 2>/dev/null || true
    fi
}

# Kill previously started dev processes
kill_dev_processes() {
    if [ -f "$PID_FILE" ]; then
        while IFS= read -r pid; do
            if kill -0 "$pid" 2>/dev/null; then
                kill "$pid" 2>/dev/null || true
            fi
        done < "$PID_FILE"
        rm -f "$PID_FILE"
    fi

    # Also kill any processes holding dev ports
    local pids
    pids=$(lsof -ti:3000,5173 2>/dev/null || true)
    if [ -n "$pids" ]; then
        echo "$pids" | xargs kill 2>/dev/null || true
        sleep 1
    fi
}

wait_for_db() {
    echo "Waiting for database to be ready..."
    local max_wait=30
    local waited=0
    while [ $waited -lt $max_wait ]; do
        if docker exec raid-ledger-db pg_isready -U postgres > /dev/null 2>&1; then
            break
        fi
        sleep 2
        waited=$((waited + 2))
        echo -n "."
    done
    echo ""

    if [ $waited -ge $max_wait ]; then
        print_error "Timeout waiting for database"
        exit 1
    fi
    print_success "Database is ready"
}

# Wait for API to respond to health check with retries
wait_for_api() {
    echo "Waiting for API to be healthy..."
    local max_wait=60
    local waited=0
    while [ $waited -lt $max_wait ]; do
        if curl -sf http://localhost:3000/health > /dev/null 2>&1; then
            echo ""
            print_success "API is healthy"
            return 0
        fi
        sleep 3
        waited=$((waited + 3))
        echo -n "."
    done
    echo ""
    print_error "API health check failed after ${max_wait}s"
    if [ -f "$LOG_DIR/api.log" ]; then
        echo ""
        echo "--- Last 30 lines of API log ---"
        tail -30 "$LOG_DIR/api.log"
        echo "--- End of log ---"
    fi
    return 1
}

# Verify the DB container is using the correct volume (not a worktree-prefixed one).
# Wrong volumes happen when `docker compose up` was previously run from a worktree dir.
validate_db_volume() {
    local volume_name
    volume_name=$(docker inspect raid-ledger-db --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}' 2>/dev/null || true)

    if [ -z "$volume_name" ]; then
        return 0  # Can't determine volume — skip check
    fi

    if [ "$volume_name" != "raid-ledger_db_data" ]; then
        print_error "DB container is using WRONG volume: $volume_name"
        print_error "Expected: raid-ledger_db_data"
        print_error "This means your dev data (integration configs, Discord tokens, etc.) is MISSING."
        echo ""
        print_warning "Auto-fixing: recreating container with correct volume..."

        docker stop raid-ledger-db > /dev/null 2>&1 || true
        docker rm raid-ledger-db > /dev/null 2>&1 || true

        # Recreate from main repo's compose file (always has correct volume prefix)
        docker compose -f "$MAIN_REPO/docker-compose.yml" up -d db
        print_success "DB container recreated with correct volume (raid-ledger_db_data)"
        return 0
    fi

    print_success "DB volume verified: $volume_name"
}

# Verify the DB container image matches what docker-compose.yml currently expects.
# A mismatch means the dev upgraded (e.g. ROK-948: pg15 -> pgvector/pgvector:pg16)
# without recreating the volume — migrations that depend on the new image's
# extensions will fail with cryptic errors. We stop loudly and tell the user
# exactly which one-time command fixes it.
validate_db_image() {
    local expected_image
    expected_image=$(grep -E '^\s+image:\s*' "$MAIN_REPO/docker-compose.yml" | head -1 | awk '{print $2}')
    [ -z "$expected_image" ] && return 0  # Can't parse — skip

    local actual_image
    actual_image=$(docker inspect raid-ledger-db --format '{{.Config.Image}}' 2>/dev/null || true)
    [ -z "$actual_image" ] && return 0  # No container yet — skip

    if [ "$actual_image" != "$expected_image" ]; then
        print_error "DB container image MISMATCH"
        print_error "  Running: $actual_image"
        print_error "  Expected: $expected_image"
        echo ""
        print_warning "Postgres major-version upgrades are NOT in-place. Fix (destroys local DB data):"
        echo "  docker compose down -v && ./scripts/deploy_dev.sh --ci --fresh --rebuild"
        exit 1
    fi
}

# Start Docker containers safely — uses 'docker start' first to avoid
# creating wrong volumes from worktree directory prefixes.
ensure_docker() {
    echo "Ensuring Docker DB + Redis are running..."

    # Catch an image mismatch before starting the stale container.
    validate_db_image

    # Try starting existing containers by name first (safe from any directory)
    local db_started=false
    local redis_started=false

    if docker start raid-ledger-db > /dev/null 2>&1; then
        db_started=true
    fi
    if docker start raid-ledger-redis > /dev/null 2>&1; then
        redis_started=true
    fi

    if [ "$db_started" = true ] && [ "$redis_started" = true ]; then
        print_success "Docker containers started (existing)"
    else
        # Containers don't exist — create them from MAIN repo's compose file
        # This ensures the correct volume names (raid-ledger_db_data, not worktree-prefixed)
        print_warning "Creating Docker containers from compose file..."
        docker compose -f "$MAIN_REPO/docker-compose.yml" up -d db redis
    fi

    # Always validate the DB is using the right volume
    validate_db_volume
}

# After migrations, check if the DB has real data. If it's empty and we
# didn't intentionally wipe it, try to restore from the latest backup.
validate_db_data() {
    local fresh=$1

    if [ "$fresh" = "true" ]; then
        return 0  # Fresh start — empty DB is expected
    fi

    # Check for any real user data
    local user_count
    user_count=$(docker exec raid-ledger-db psql -U user -d raid_ledger -tAc \
        "SELECT count(*) FROM users" 2>/dev/null || echo "error")

    if [ "$user_count" = "error" ]; then
        return 0  # Table might not exist yet (first migration)
    fi

    if [ "$user_count" -gt 0 ] 2>/dev/null; then
        print_success "DB has data ($user_count users) — integration configs intact"
        return 0
    fi

    # DB is empty but we didn't --fresh — something went wrong
    print_error "DB is EMPTY but --fresh was not used!"
    print_error "Your integration configs (Discord, Blizzard, OAuth) are missing."
    echo ""

    # Try to auto-restore from latest backup
    local latest_backup
    latest_backup=$(ls -t "$MAIN_REPO/api/backups/daily/"*.dump 2>/dev/null | head -1)

    if [ -n "$latest_backup" ]; then
        local backup_name
        backup_name=$(basename "$latest_backup")
        local backup_size
        backup_size=$(du -h "$latest_backup" | cut -f1)
        print_warning "Found backup: $backup_name ($backup_size)"
        print_warning "Auto-restoring from backup..."

        # Copy backup into container and restore.
        # NOTE: we exclude the `drizzle` schema from restore — that table is
        # code state, not data, and round-tripping it through backups causes
        # cross-branch migration-hash drift. The reconcile step below brings
        # __drizzle_migrations back in sync with the current journal.
        docker cp "$latest_backup" raid-ledger-db:/tmp/restore.dump
        if docker exec raid-ledger-db pg_restore \
            --clean --if-exists --no-owner --no-privileges \
            --exclude-schema=drizzle \
            -d "postgresql://user:password@localhost:5432/raid_ledger" \
            /tmp/restore.dump 2>&1 | tail -5; then

            docker exec raid-ledger-db rm -f /tmp/restore.dump

            # Reconcile migration state: the restored DB has schema but no
            # drizzle.__drizzle_migrations rows. Reconcile probes each
            # journal entry, skips ones whose effects are already present,
            # and runs anything truly missing.
            echo "Reconciling migration state after restore..."
            DATABASE_URL="$DATABASE_URL" node "$PROJECT_DIR/scripts/reconcile-migrations.mjs" 2>&1 || true

            # Verify restore worked
            user_count=$(docker exec raid-ledger-db psql -U user -d raid_ledger -tAc \
                "SELECT count(*) FROM users" 2>/dev/null || echo "0")
            if [ "$user_count" -gt 0 ] 2>/dev/null; then
                print_success "Restored! DB now has $user_count users — configs should be intact"
            else
                print_error "Restore didn't bring back data. Manual intervention needed."
            fi
        else
            docker exec raid-ledger-db rm -f /tmp/restore.dump
            print_error "Restore failed. Manual intervention needed."
        fi
    else
        print_error "No backups found in $MAIN_REPO/api/backups/daily/"
        print_error "Cannot auto-restore. You will need to reconfigure integrations."
    fi
}

# =============================================================================
# Migration drift probe (ROK-1320)
# =============================================================================
# `npm run db:migrate` runs soft-fail above (`|| print_warning`). When the
# worktree's drizzle journal has migrations the local DB hasn't applied (e.g.
# after rebasing onto a newer main that landed migrations, or restoring an old
# backup), the soft-fail let the API boot "healthy" on new code against a
# drift-stricken DB — every runtime request touching the missing schema 500s
# with no boot-time signal. The probe below compares the journal against the
# DB's applied set BEFORE the API starts and aborts loudly on unresolved drift.
#
# Matching key: drizzle stores sha256(<tag>.sql contents) in
# drizzle.__drizzle_migrations.hash. We compute the same per journal entry and
# diff the two hash sets. (The journal's `when` maps to the table's created_at;
# we key on hash since that's the table's only stable migration identifier.)

# Canonical journal location for THIS repo (confirmed via filesystem inspect).
MIGRATIONS_DIR="$PROJECT_DIR/api/src/drizzle/migrations"
JOURNAL_PATH="$MIGRATIONS_DIR/meta/_journal.json"

# Pure diff logic, factored out so the regression test can exercise it with
# stubbed inputs (no live Postgres required). Reads two newline-separated hash
# lists on FDs — journal hashes ($1) and db hashes ($2) — and prints:
#   missing:<hash>   for each journal hash absent from the DB (DB behind)
#   phantom:<hash>   for each DB hash absent from the journal (orphan rows)
# Returns 0 always; the caller interprets the printed lines.
compute_migration_drift() {
    local journal_hashes="$1"
    local db_hashes="$2"
    local sorted_journal sorted_db
    sorted_journal=$(printf '%s\n' "$journal_hashes" | grep -v '^$' | sort -u)
    sorted_db=$(printf '%s\n' "$db_hashes" | grep -v '^$' | sort -u)

    # journal − db  → DB is missing these migrations.
    comm -23 <(printf '%s\n' "$sorted_journal") <(printf '%s\n' "$sorted_db") \
        | sed 's/^/missing:/'
    # db − journal  → phantom rows (the ROK-1319 corruption pattern).
    comm -13 <(printf '%s\n' "$sorted_journal") <(printf '%s\n' "$sorted_db") \
        | sed 's/^/phantom:/'
}

# Read the journal and emit, per entry, "<hash> <tag>" (sha256 of the tag's
# .sql file + the tag, for human-readable error messages). Uses jq when
# available, with a portable grep/sed fallback for parsing tags.
gather_journal_hashes() {
    [ -f "$JOURNAL_PATH" ] || return 0
    local tags
    if command -v jq >/dev/null 2>&1; then
        tags=$(jq -r '.entries[].tag' "$JOURNAL_PATH")
    else
        # Portable fallback: pull "tag": "..." values in journal order.
        tags=$(grep -o '"tag"[[:space:]]*:[[:space:]]*"[^"]*"' "$JOURNAL_PATH" \
            | sed 's/.*"tag"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
    fi
    local tag sqlfile hash
    while IFS= read -r tag; do
        [ -z "$tag" ] && continue
        sqlfile="$MIGRATIONS_DIR/$tag.sql"
        if [ ! -f "$sqlfile" ]; then
            # A journal entry with no .sql file is itself a corruption — surface
            # it rather than silently dropping the entry from the diff.
            echo "MISSING_SQL $tag"
            continue
        fi
        hash=$(shasum -a 256 "$sqlfile" 2>/dev/null | awk '{print $1}')
        [ -z "$hash" ] && hash=$(sha256sum "$sqlfile" 2>/dev/null | awk '{print $1}')
        echo "$hash $tag"
    done <<< "$tags"
}

# Query the applied hash set from Postgres using the same docker exec / psql
# invocation the rest of the script uses (validate_db_data). Emits one hash per
# line. Returns non-zero (and emits nothing) when the DB / table isn't queryable
# yet, so the caller can treat "no DB to probe" as not-a-drift.
gather_db_hashes() {
    local out
    out=$(docker exec raid-ledger-db psql -U user -d raid_ledger -tAc \
        "SELECT hash FROM drizzle.__drizzle_migrations" 2>/dev/null) || return 1
    # An empty result on a brand-new DB (table absent) yields empty string;
    # the caller distinguishes that from a query failure via our exit code.
    printf '%s\n' "$out" | grep -v '^$' || true
}

# Orchestrator: gather journal + db hash sets, diff them, and act:
#   • journal − db ≠ ∅ → run db:migrate; on failure ABORT (no API start);
#     on success re-probe to confirm parity, then continue.
#   • db − journal ≠ ∅ → phantom rows → ABORT pointing at scripts/reconcile-migrations.mjs.
#   • no drift → silent, continue.
# Aborts via `exit 3` (distinct from the lease's exit 2) so callers/CI can tell
# a drift abort from a lease-contention abort.
check_migration_drift() {
    # Guard: if the DB container/table isn't queryable yet, there's nothing to
    # compare against (fresh DB, first migration). Skip — db:migrate above will
    # have built the table, and a truly fresh DB has no drift.
    local db_hashes
    if ! db_hashes=$(gather_db_hashes); then
        print_warning "Migration drift probe skipped: DB not queryable yet (fresh/first-run)."
        return 0
    fi

    _run_drift_probe "$db_hashes" "first"
}

# Inner probe, separated so the post-migrate re-probe can reuse it without
# re-running migrations on the recursion. $2 = "first" | "reprobe".
_run_drift_probe() {
    local db_hashes="$1"
    local phase="$2"
    local journal_raw journal_hashes drift

    journal_raw=$(gather_journal_hashes)
    if echo "$journal_raw" | grep -q '^MISSING_SQL '; then
        print_error "Migration journal references .sql files that don't exist:"
        echo "$journal_raw" | grep '^MISSING_SQL ' | sed 's/^MISSING_SQL /    - /'
        print_error "The journal is corrupt for this worktree. Fix the journal/migrations before deploying."
        exit 3
    fi
    journal_hashes=$(echo "$journal_raw" | awk '{print $1}')

    drift=$(compute_migration_drift "$journal_hashes" "$db_hashes")
    local missing phantom
    missing=$(echo "$drift" | grep '^missing:' | sed 's/^missing://' | grep -v '^$' || true)
    phantom=$(echo "$drift" | grep '^phantom:' | sed 's/^phantom://' | grep -v '^$' || true)

    # Phantom rows first: the DB has migration hashes the journal doesn't. This
    # is the ROK-1319 corruption pattern — running migrate won't fix it.
    if [ -n "$phantom" ]; then
        print_error "Migration drift: DB has migration(s) NOT in this branch's journal (orphan rows):"
        while IFS= read -r h; do
            [ -z "$h" ] && continue
            local tag
            tag=$(echo "$journal_raw" | awk -v hh="$h" '$1==hh {print $2}')
            echo "    - hash ${h:0:16}…${tag:+ (tag $tag)}"
        done <<< "$phantom"
        print_error "These rows have no matching journal entry on branch '$(get_current_branch)'."
        print_error "Likely cause: the local DB carries migrations from another branch/main this worktree hasn't rebased onto, or __drizzle_migrations is corrupt."
        print_error "Fix: rebase this branch onto the main carrying those migrations, OR run:"
        print_error "    DATABASE_URL=\"\$DATABASE_URL\" node scripts/reconcile-migrations.mjs"
        print_error "    (do NOT trust blindly — verify the orphan hashes are legitimately applied first)"
        print_error "NOT starting the API against a drifted DB."
        exit 3
    fi

    if [ -n "$missing" ]; then
        if [ "$phase" = "reprobe" ]; then
            # We already ran migrate once and drift persists — migrate did not
            # close the gap. Abort rather than loop.
            print_error "Migration drift persists after running db:migrate. The journal still has migration(s) the DB lacks:"
            _print_missing_tags "$missing" "$journal_raw"
            print_error "db:migrate did not apply them (it may have errored silently). NOT starting the API."
            exit 3
        fi
        print_warning "Migration drift detected: DB is missing migration(s) present in the journal:"
        _print_missing_tags "$missing" "$journal_raw"
        echo "Applying missing migrations via 'npm run db:migrate -w api'..."
        if ! npm run db:migrate -w api 2>&1; then
            print_error "db:migrate FAILED while applying drifted migrations. NOT starting the API."
            print_error "The DB is missing schema the new code expects — booting now would 500 on every request touching it."
            print_error "Resolve the migration failure above, then re-run deploy."
            exit 3
        fi
        # Re-probe to confirm parity. Re-query the DB (migrate just changed it).
        local new_db_hashes
        if ! new_db_hashes=$(gather_db_hashes); then
            print_error "Could not re-query the DB after db:migrate to confirm parity. NOT starting the API."
            exit 3
        fi
        _run_drift_probe "$new_db_hashes" "reprobe"
        return 0
    fi

    # No drift.
    if [ "$phase" = "first" ]; then
        print_success "Migration state in sync with journal — no drift."
    else
        print_success "Migration drift resolved — DB now in sync with journal."
    fi
}

# Helper: print "missing" hashes with their journal tags for readable errors.
_print_missing_tags() {
    local missing="$1"
    local journal_raw="$2"
    while IFS= read -r h; do
        [ -z "$h" ] && continue
        local tag
        tag=$(echo "$journal_raw" | awk -v hh="$h" '$1==hh {print $2}')
        echo "    - ${tag:-<unknown>} (hash ${h:0:16}…)"
    done <<< "$missing"
}

show_status() {
    print_header "Dev Environment Status"

    echo -e "${BLUE}Docker Containers:${NC}"
    docker compose -f "$COMPOSE_FILE" ps db redis 2>/dev/null || echo "  No containers running"
    echo ""

    echo -e "${BLUE}Native Processes:${NC}"
    if [ -f "$PID_FILE" ]; then
        while IFS= read -r pid; do
            if kill -0 "$pid" 2>/dev/null; then
                ps -p "$pid" -o pid,command= 2>/dev/null || true
            fi
        done < "$PID_FILE"
    else
        echo "  No dev processes tracked"
    fi
    echo ""

    echo -e "${BLUE}Env Lease:${NC}"
    "$MAIN_REPO/scripts/env-lock.sh" status 2>/dev/null | jq -r '
        if .holder == null then "  free"
        else "  held by \(.holder.branch) @ \(.holder.worktree) (\(.holder.purpose), pid \(.holder.pid), priority \(.holder.priority))"
        end,
        if (.queue | length) > 0
        then "  queue: " + ([.queue[] | .branch + (if .preempted then "*" else "" end)] | join(", "))
        else empty end,
        if .stale_cleared then "  (stale lease auto-cleared: \(.stale_cleared.reason))" else empty end
    ' || echo "  (env-lock.sh not available)"
}

show_logs() {
    print_header "Dev Logs (Ctrl+C to exit)"
    if [ -d "$LOG_DIR" ]; then
        tail -f "$LOG_DIR"/*.log
    else
        print_warning "No log files found. Is the dev environment running?"
    fi
}

stop_dev() {
    print_header "Stopping Dev Environment"

    kill_dev_processes
    print_success "Native processes stopped"

    docker compose -f "$COMPOSE_FILE" stop db redis 2>/dev/null || true
    print_success "Database and Redis stopped"

    rm -rf "$LOG_DIR" "$PID_FILE"

    # Release the cross-worktree env lease so the next agent can take it.
    # Always non-fatal — if we never held it, this is a no-op.
    "$MAIN_REPO/scripts/env-lock.sh" release "$(get_current_branch)" "$PROJECT_DIR" >/dev/null 2>&1 || true
}

reset_password() {
    print_header "Resetting Admin Password"

    # Ensure db is running
    if ! docker compose -f "$COMPOSE_FILE" ps db 2>/dev/null | grep -q "running"; then
        print_warning "Starting database container..."
        docker compose -f "$COMPOSE_FILE" up -d db
        wait_for_db
    fi

    load_env
    RESET_PASSWORD=true npx ts-node api/scripts/bootstrap-admin.ts

    print_success "Admin password has been reset (check output above for new password)"
}

create_safety_backup() {
    # Create a pg_dump safety backup before destructive operations.
    # Saves to the local filesystem (api/backups/) so it survives volume wipes.
    if ! docker compose -f "$COMPOSE_FILE" ps db 2>/dev/null | grep -q "running"; then
        print_warning "Database not running, skipping safety backup"
        return 0
    fi

    load_env

    # Quick check: does the DB have any user data worth backing up?
    local user_count
    user_count=$(docker exec raid-ledger-db psql "$DATABASE_URL" -tAc "SELECT count(*) FROM users" 2>/dev/null || echo "0")
    if [ "$user_count" = "0" ] || [ -z "$user_count" ]; then
        print_warning "Database is empty, skipping safety backup"
        return 0
    fi

    local backup_dir="$PROJECT_DIR/api/backups/daily"
    mkdir -p "$backup_dir"
    local timestamp
    timestamp=$(date +%Y-%m-%d_%H%M%S)
    local filename="pre_fresh_${timestamp}.dump"
    local filepath="$backup_dir/$filename"

    print_warning "Creating safety backup before fresh start..."

    # NOTE: we exclude the `drizzle` schema. Migration state is code, not
    # data, and including it causes cross-branch hash drift on restore.
    # On restore we reconcile from the current journal instead.
    if docker exec raid-ledger-db pg_dump \
        --format=custom \
        --no-owner \
        --no-privileges \
        --exclude-schema=drizzle \
        "--file=/tmp/safety_backup.dump" \
        "$DATABASE_URL" 2>/dev/null && \
       docker cp "raid-ledger-db:/tmp/safety_backup.dump" "$filepath" 2>/dev/null && \
       docker exec raid-ledger-db rm -f /tmp/safety_backup.dump 2>/dev/null; then
        local size
        size=$(du -h "$filepath" | cut -f1)
        print_success "Safety backup created: $filename ($size)"
    else
        print_warning "Safety backup failed — proceeding without backup"
    fi
}

# =============================================================================
# Durable app_settings preservation (stop the recurring local-keys wipe)
# =============================================================================
# app_settings holds the local API keys (Blizzard/IGDB/ITAD/LLM/etc.). They are
# EXCLUDED from all backups (ROK-1279) and NOT seeded from env, so every DB reset
# wiped them with no recovery. The three helpers below implement ONE durable
# mechanism: snapshot to an external file after a healthy deploy, auto-restore
# whenever the table is empty after migrations.
#
# Encryption note: app_settings values are encrypted with a key derived from the
# local JWT_SECRET, so a restored snapshot stays valid as long as JWT_SECRET is
# unchanged (it's stable in .env). Rotate JWT_SECRET and the restored ciphertext
# becomes undecryptable — re-enter the keys via /admin/settings.

# Count rows in public.app_settings. Emits an integer, or "error" when the table
# isn't queryable yet (DB down / pre-migration).
count_app_settings_rows() {
    docker exec raid-ledger-db psql -U user -d raid_ledger -tAc \
        "SELECT count(*) FROM app_settings" 2>/dev/null || echo "error"
}

# Dump app_settings to the external snapshot after a healthy deploy so the
# current keys can be auto-restored after the next reset. Only writes when the
# table has >=1 row, and writes atomically (tmp + mv) so a failed dump never
# clobbers a good snapshot. No-op (keeps prior snapshot) on empty/unqueryable.
snapshot_app_settings() {
    local rows
    rows=$(count_app_settings_rows)
    if ! [ "$rows" -gt 0 ] 2>/dev/null; then
        return 0
    fi
    mkdir -p "$RL_STATE_DIR"
    local tmp
    tmp=$(mktemp -t rl-app-settings.XXXXXX)
    if docker exec raid-ledger-db pg_dump \
            --data-only --inserts --table=public.app_settings \
            "$DATABASE_URL" >"$tmp" 2>/dev/null \
       && grep -qE '^INSERT INTO ' "$tmp"; then
        mv "$tmp" "$APP_SETTINGS_SNAPSHOT"
        print_success "app_settings snapshot saved ($rows row(s)) → $APP_SETTINGS_SNAPSHOT_DISPLAY"
    else
        rm -f "$tmp"
        print_warning "app_settings snapshot skipped — kept previous snapshot if any"
    fi
}

# Auto-restore app_settings from the external snapshot when the table is empty
# after a reset (--fresh / clone / volume nuke). Runs BEFORE the API starts so it
# boots reading the restored rows — no settings-cache bounce needed. Only acts on
# a definitively-empty table; re-counts after to confirm the restore landed.
restore_app_settings_if_empty() {
    [ -f "$APP_SETTINGS_SNAPSHOT" ] || return 0
    local rows
    rows=$(count_app_settings_rows)
    [ "$rows" = "0" ] || return 0
    docker exec -i raid-ledger-db psql -U user -d raid_ledger \
        <"$APP_SETTINGS_SNAPSHOT" >/dev/null 2>&1 || true
    local restored
    restored=$(count_app_settings_rows)
    if [ "$restored" -gt 0 ] 2>/dev/null; then
        print_success "app_settings empty after reset — auto-restored ${restored} row(s) from $APP_SETTINGS_SNAPSHOT_DISPLAY"
    else
        print_warning "app_settings auto-restore from $APP_SETTINGS_SNAPSHOT_DISPLAY failed — re-enter API keys via /admin/settings"
    fi
}

# Warn before a --fresh wipe that app_settings (API keys) will be cleared, and
# whether the external snapshot can auto-restore them after migrations.
warn_fresh_app_settings() {
    if [ -f "$APP_SETTINGS_SNAPSHOT" ]; then
        print_warning "--fresh will wipe app_settings (API keys) — snapshot at $APP_SETTINGS_SNAPSHOT_DISPLAY will auto-restore them after migrations."
    else
        print_warning "--fresh will wipe app_settings (API keys) — no snapshot exists yet, so you'll re-enter keys via /admin/settings (a snapshot is saved after each healthy deploy)."
    fi
}

start_dev() {
    local rebuild=$1
    local fresh=$2

    # ---- Cross-worktree lease check (env-lock.sh) ------------------------------
    # The local dev env is a single shared resource. Acquire a lease before
    # starting; refuse if another worktree already holds it (or wait, if asked).
    # `/opt` and operator-driven invocations set --operator (or
    # RAID_LEDGER_OPERATOR=1) to preempt — see env-lock.sh for details.
    local lease_branch lease_priority="normal" lease_cmd="acquire"
    lease_branch=$(get_current_branch)
    if [ "$ARG_OPERATOR" = "true" ] || [ "${RAID_LEDGER_OPERATOR:-}" = "1" ]; then
        lease_priority="operator"
    fi
    local lease_args=("$lease_branch" "$PROJECT_DIR" "deploy_dev.sh" --pid $$ --ttl-minutes 240 --priority "$lease_priority")
    if [ -n "$ARG_WAIT_FOR_ENV_MINUTES" ]; then
        lease_cmd="wait"
        lease_args+=(--timeout-seconds $((ARG_WAIT_FOR_ENV_MINUTES * 60)))
    fi
    local lease_out
    lease_out=$(mktemp -t deploy-dev-lease.XXXXXX)
    if ! "$MAIN_REPO/scripts/env-lock.sh" "$lease_cmd" "${lease_args[@]}" >"$lease_out" 2>&1; then
        print_error "Local dev env is held by another worktree. See lease state below; pass --wait-for-env <min> to block, or --operator to preempt."
        "$MAIN_REPO/scripts/env-lock.sh" status | jq . >&2 || cat "$lease_out" >&2
        rm -f "$lease_out"
        exit 2
    fi
    # If we preempted, surface it loudly so the operator sees who got bumped.
    # `|| true` because this is cosmetic — never abort the deploy on a parse error.
    jq -r 'if .preempted_holder then "⚡ Preempted \(.preempted_holder.branch) (now at front of queue)" else empty end' \
        "$lease_out" 2>/dev/null || true
    rm -f "$lease_out"

    # Stop conflicting Docker app containers
    stop_docker_app

    # Kill any existing dev processes
    kill_dev_processes

    # Check branch before starting
    check_branch_for_testing

    print_header "Starting Dev Environment"

    # Show current branch
    local current_branch
    current_branch=$(get_current_branch)
    echo -e "  ${BLUE}Git Branch:${NC} $current_branch"
    echo ""

    # Fresh start: wipe volumes (new admin password will be auto-generated on bootstrap)
    if [ "$fresh" = "true" ]; then
        # Tell the operator the API keys are about to go, and whether we can
        # auto-restore them after migrations.
        warn_fresh_app_settings
        # Create a safety backup before wiping
        create_safety_backup
        # Refresh the external app_settings snapshot while the DB is still up, so
        # keys entered since the last healthy deploy survive this wipe too. No-op
        # if the DB is already down or the table is empty.
        snapshot_app_settings

        print_warning "Fresh start: wiping database volume..."
        docker compose -f "$COMPOSE_FILE" down -v 2>/dev/null || true

        # Local backups (api/backups/) live on the filesystem, not in Docker volumes,
        # so they survive volume wipes automatically.
        local backup_count
        backup_count=$(find "$PROJECT_DIR/api/backups" -name "*.dump" 2>/dev/null | wc -l | tr -d ' ')
        if [ "$backup_count" -gt 0 ]; then
            print_success "Local backups preserved ($backup_count .dump files in api/backups/)"
        fi

        print_success "Database wiped. New admin password will be generated on bootstrap."
    fi

    # Copy .env files for worktrees before anything else
    copy_env_if_worktree

    # Start infrastructure containers
    ensure_docker
    wait_for_db

    # Build contract (required before api/web)
    if [ "$rebuild" = "true" ] || [ "$fresh" = "true" ]; then
        print_warning "Building contract package..."
        npm run build -w packages/contract
    else
        # Quick check: build contract only if dist is missing
        if [ ! -d "$PROJECT_DIR/packages/contract/dist" ]; then
            print_warning "Contract not built yet, building..."
            npm run build -w packages/contract
        fi
    fi

    # Load env for DATABASE_URL
    load_env

    # Run migrations
    echo "Running database migrations..."
    npm run db:migrate -w api 2>&1 || print_warning "Migrations may have already been applied"

    # Drift probe (ROK-1320): compare the journal against the DB's applied set
    # BEFORE the API starts. The soft-fail above means a failed/partial migrate
    # would otherwise let the API boot on new code against a drifted DB (every
    # request touching the missing schema 500s with no boot-time signal). This
    # re-runs migrate on detected drift and ABORTS (exit 3) if it can't close
    # the gap or finds phantom rows.
    check_migration_drift

    # Validate DB has real data — if empty and not --fresh, something went wrong
    validate_db_data "$fresh"

    # Durable app_settings recovery: if a reset (--fresh / clone / volume nuke)
    # left app_settings empty, auto-restore the external snapshot NOW — after
    # migrations rebuilt the empty table, before the API starts — so the API
    # boots reading the restored rows and no settings-cache bounce is needed.
    # (Placed after validate_db_data so a full-backup restore that already
    # repopulated app_settings is left untouched — we only act on 0 rows.)
    restore_app_settings_if_empty

    # Bootstrap admin — capture output so we can show credentials
    echo "Checking admin account..."
    BOOTSTRAP_OUTPUT=$(npx ts-node api/scripts/bootstrap-admin.ts 2>&1 || true)
    echo "$BOOTSTRAP_OUTPUT"

    # Seed games
    echo "Seeding game data..."
    npm run db:seed:games -w api 2>&1 || true

    # Seed IGDB games (real cover art URLs)
    echo "Seeding IGDB game data..."
    npx ts-node api/scripts/seed-igdb-games.ts 2>&1 || true

    # Create log directory
    mkdir -p "$LOG_DIR"
    > "$PID_FILE"

    # Start native API in background (DEBUG=true for verbose logging in dev)
    echo "Starting API server (watch mode)..."
    DEBUG=true npm run start:dev -w api > "$LOG_DIR/api.log" 2>&1 &
    echo $! >> "$PID_FILE"
    print_success "API starting on http://localhost:3000 (PID: $!)"

    # Start native Web in background
    echo "Starting Vite dev server..."
    npm run dev -w web > "$LOG_DIR/web.log" 2>&1 &
    echo $! >> "$PID_FILE"
    print_success "Web starting on http://localhost:5173 (PID: $!)"

    # Wait for API to be healthy (with retries)
    local api_healthy=true
    wait_for_api || { print_warning "API may still be starting — check logs with --logs"; api_healthy=false; }

    # Snapshot app_settings now that the deploy is healthy, so the current API
    # keys can be auto-restored after the next DB reset. No-op if the table is
    # empty (never clobbers a good snapshot with an empty dump).
    if [ "$api_healthy" = true ]; then
        snapshot_app_settings
    fi

    # Re-anchor the lease PID from $$ (this script — about to exit) to the
    # long-lived API server PID. Without this, the lease appears `pid_dead`
    # to other agents the moment deploy_dev.sh exits, even though the env
    # (containers, API, Vite) is still up — and any queued agent grabs it
    # mid-run. See ROK-1209 incident note 2026-05-09.
    local api_pid
    api_pid=$(head -1 "$PID_FILE" 2>/dev/null || echo "")
    if [ -n "$api_pid" ] && ps -p "$api_pid" >/dev/null 2>&1; then
        "$MAIN_REPO/scripts/env-lock.sh" acquire \
            "$lease_branch" "$PROJECT_DIR" "deploy_dev.sh (anchored to API PID $api_pid)" \
            --pid "$api_pid" --ttl-minutes 240 --priority "$lease_priority" >/dev/null 2>&1 || true
    fi

    # Final status
    print_header "Dev Environment Ready"

    local current_branch
    current_branch=$(get_current_branch)
    echo -e "  ${GREEN}Web UI:${NC}     http://localhost:5173  (Vite HMR)"
    echo -e "  ${GREEN}API:${NC}        http://localhost:3000  (NestJS watch mode)"
    echo -e "  ${GREEN}API Health:${NC} http://localhost:3000/health"
    echo -e "  ${BLUE}Git Branch:${NC} $current_branch"
    if [ "$IS_WORKTREE" = true ]; then
        echo -e "  ${YELLOW}Worktree:${NC}   $PROJECT_DIR"
    fi
    echo ""

    # Show credentials — if bootstrap generated new ones, display them prominently
    if echo "$BOOTSTRAP_OUTPUT" | grep -q "Password:"; then
        echo -e "${YELLOW}  ┌──────────────────────────────────────────────────┐${NC}"
        local cred_password
        cred_password=$(echo "$BOOTSTRAP_OUTPUT" | grep "Password:" | awk '{print $2}')
        echo -e "${YELLOW}  │  Login: admin@local / $cred_password${NC}"
        echo -e "${YELLOW}  │  ⚠ SAVE THIS — it won't be shown again${NC}"
        echo -e "${YELLOW}  └──────────────────────────────────────────────────┘${NC}"
    else
        show_credentials
    fi
    echo ""
    echo -e "  ${BLUE}Commands:${NC}"
    echo "    ./scripts/deploy_dev.sh --status          # Show process status"
    echo "    ./scripts/deploy_dev.sh --logs            # Tail API + web logs"
    echo "    ./scripts/deploy_dev.sh --reset-password  # Reset admin password"
    echo "    ./scripts/deploy_dev.sh --down            # Stop everything"
    echo ""
}

# Sourcing guard (ROK-1320): when this file is `source`d instead of executed
# (e.g. by scripts/test-migration-drift-probe.sh to unit-test the drift-probe
# functions in isolation), return here so we define the functions WITHOUT
# parsing args or dispatching an action. Direct execution falls through.
if [ "${BASH_SOURCE[0]}" != "${0}" ]; then
    # SC2317: shellcheck analyzes this file as executed (where `return` outside a
    # function is reachable only when sourced) and flags the line unreachable —
    # false positive for a sourcing guard. The redirect+|| keeps it a no-op if
    # somehow reached during direct execution.
    # shellcheck disable=SC2317
    return 0 2>/dev/null || true
fi

# Parse arguments — supports combining flags (e.g., --ci --rebuild)
ARG_REBUILD=false
ARG_FRESH=false
ARG_BRANCH=""
ARG_ACTION=""
ARG_AI=false
ARG_OPERATOR=false
ARG_WAIT_FOR_ENV_MINUTES=""

while [ $# -gt 0 ]; do
    case "$1" in
        --ci)
            CI_MODE=true
            shift
            ;;
        --down|-d)
            ARG_ACTION="down"
            shift
            ;;
        --rebuild|-r)
            ARG_REBUILD=true
            shift
            ;;
        --branch|-b)
            if [ -z "${2:-}" ]; then
                print_error "Missing branch name. Usage: $0 --branch <branch-name>"
                exit 1
            fi
            ARG_BRANCH="$2"
            ARG_REBUILD=true
            shift 2
            ;;
        --status|-s)
            ARG_ACTION="status"
            shift
            ;;
        --logs|-l)
            ARG_ACTION="logs"
            shift
            ;;
        --fresh|-f)
            ARG_FRESH=true
            ARG_REBUILD=true
            shift
            ;;
        --reset-password)
            ARG_ACTION="reset-password"
            shift
            ;;
        --ai)
            ARG_AI=true
            shift
            ;;
        --operator)
            # Cross-worktree env lease: cut the line, preempt any current holder.
            # Used by /opt skill and operator-driven workflows.
            ARG_OPERATOR=true
            shift
            ;;
        --wait-for-env)
            if [ -z "${2:-}" ]; then
                print_error "Missing minutes. Usage: $0 --wait-for-env <minutes>"
                exit 1
            fi
            if ! [[ "$2" =~ ^[1-9][0-9]*$ ]]; then
                print_error "Invalid --wait-for-env value: '$2' (must be a positive integer of minutes)"
                exit 1
            fi
            ARG_WAIT_FOR_ENV_MINUTES="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  (none)            Start dev environment (native API + Vite)"
            echo "  --rebuild         Rebuild contract package, then start"
            echo "  --branch <name>   Switch to branch, rebuild, then start"
            echo "  --fresh           Reset DB, new admin password, restart"
            echo "  --reset-password  Reset admin password without losing data"
            echo "  --ai              Start Ollama container (--profile ai)"
            echo "  --ci              Non-interactive mode (skip prompts, for agents)"
            echo "  --operator        Preempt any current env-lease holder (cuts the line; for /opt)"
            echo "  --wait-for-env M  If env is held, block up to M minutes for it to free instead of erroring"
            echo "  --down            Stop native processes + DB/Redis containers"
            echo "  --status          Show process/container status (incl. env lease)"
            echo "  --logs            Tail API and web logs"
            echo "  --help            Show this help message"
            echo ""
            echo "Worktree-safe: auto-detects worktrees, copies .env from main repo,"
            echo "and always uses correct Docker volumes."
            echo ""
            echo "Durable app_settings preservation: local API keys (the app_settings"
            echo "table) are snapshotted to ~/.raid-ledger/app-settings.local.sql after"
            echo "each healthy deploy (and before a --fresh wipe), then auto-restored"
            echo "whenever a reset (--fresh / clone / volume nuke) leaves the table empty."
            echo "The snapshot lives outside the repo + Docker volume; keys survive as"
            echo "long as JWT_SECRET is unchanged."
            echo ""
            echo "Examples:"
            echo "  $0 --branch rok-123     # Switch to feature branch and deploy"
            echo "  $0 --rebuild            # Rebuild contract and start"
            echo "  $0 --ci --rebuild       # Agent mode: rebuild, no prompts"
            exit 0
            ;;
        *)
            print_error "Unknown option: $1 (use --help for usage)"
            exit 1
            ;;
    esac
done

# Print worktree info if detected
if [ "$IS_WORKTREE" = true ]; then
    print_warning "Worktree detected — main repo: $MAIN_REPO"
fi

# Execute action
case "$ARG_ACTION" in
    down)
        stop_dev
        ;;
    status)
        show_status
        ;;
    logs)
        show_logs
        ;;
    reset-password)
        reset_password
        ;;
    *)
        if [ -n "$ARG_BRANCH" ]; then
            switch_branch "$ARG_BRANCH"
        fi
        start_dev "$ARG_REBUILD" "$ARG_FRESH"
        if [ "$ARG_AI" = true ]; then
            print_header "Starting Ollama (AI profile)"
            docker compose -f "$COMPOSE_FILE" --profile ai up -d ollama
            print_success "Ollama container started"
        fi
        ;;
esac
