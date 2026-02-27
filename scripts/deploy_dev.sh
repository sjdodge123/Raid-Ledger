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

# Start Docker containers safely — uses 'docker start' first to avoid
# creating wrong volumes from worktree directory prefixes.
ensure_docker() {
    echo "Ensuring Docker DB + Redis are running..."

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

        # Copy backup into container and restore
        docker cp "$latest_backup" raid-ledger-db:/tmp/restore.dump
        if docker exec raid-ledger-db pg_restore \
            --clean --if-exists --no-owner --no-privileges \
            -d "postgresql://user:password@localhost:5432/raid_ledger" \
            /tmp/restore.dump 2>&1 | tail -5; then

            docker exec raid-ledger-db rm -f /tmp/restore.dump

            # Re-run migrations in case backup is older than current schema
            echo "Re-running migrations after restore..."
            npm run db:migrate -w api 2>&1 || true

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

    if docker exec raid-ledger-db pg_dump \
        --format=custom \
        --no-owner \
        --no-privileges \
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

start_dev() {
    local rebuild=$1
    local fresh=$2

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
        # Create a safety backup before wiping
        create_safety_backup

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

    # Validate DB has real data — if empty and not --fresh, something went wrong
    validate_db_data "$fresh"

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
    wait_for_api || print_warning "API may still be starting — check logs with --logs"

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

# Parse arguments — supports combining flags (e.g., --ci --rebuild)
ARG_REBUILD=false
ARG_FRESH=false
ARG_BRANCH=""
ARG_ACTION=""

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
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  (none)            Start dev environment (native API + Vite)"
            echo "  --rebuild         Rebuild contract package, then start"
            echo "  --branch <name>   Switch to branch, rebuild, then start"
            echo "  --fresh           Reset DB, new admin password, restart"
            echo "  --reset-password  Reset admin password without losing data"
            echo "  --ci              Non-interactive mode (skip prompts, for agents)"
            echo "  --down            Stop native processes + DB/Redis containers"
            echo "  --status          Show process/container status"
            echo "  --logs            Tail API and web logs"
            echo "  --help            Show this help message"
            echo ""
            echo "Worktree-safe: auto-detects worktrees, copies .env from main repo,"
            echo "and always uses correct Docker volumes."
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
        ;;
esac
