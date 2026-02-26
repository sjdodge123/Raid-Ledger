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
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
COMPOSE_FILE="$PROJECT_DIR/docker-compose.yml"
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
        print_warning "⚠️  BRANCH WARNING: Deploying from branch '$current_branch'"
        print_warning "    For post-merge verification, you usually want 'main'"
        echo ""
        echo -e "  ${YELLOW}Press Ctrl+C to cancel, or wait 5 seconds to continue...${NC}"
        sleep 5
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

# Source .env file
load_env() {
    if [ -f "$ENV_FILE" ]; then
        set -a
        source "$ENV_FILE"
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
        if docker compose -f "$COMPOSE_FILE" ps db 2>/dev/null | grep -q "healthy"; then
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

    # Start infrastructure containers
    echo "Starting database and Redis..."
    docker compose -f "$COMPOSE_FILE" up -d db redis
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

    # Bootstrap admin
    echo "Checking admin account..."
    npx ts-node api/scripts/bootstrap-admin.ts 2>&1 || true

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

    # Wait a moment for servers to initialize
    sleep 3

    # Final status
    print_header "Dev Environment Ready"

    local current_branch
    current_branch=$(get_current_branch)
    echo -e "  ${GREEN}Web UI:${NC}     http://localhost:5173  (Vite HMR)"
    echo -e "  ${GREEN}API:${NC}        http://localhost:3000  (NestJS watch mode)"
    echo -e "  ${GREEN}API Health:${NC} http://localhost:3000/health"
    echo -e "  ${BLUE}Git Branch:${NC} $current_branch"
    echo ""
    show_credentials
    echo ""
    echo -e "  ${BLUE}Commands:${NC}"
    echo "    ./scripts/deploy_dev.sh --status          # Show process status"
    echo "    ./scripts/deploy_dev.sh --logs            # Tail API + web logs"
    echo "    ./scripts/deploy_dev.sh --reset-password  # Reset admin password"
    echo "    ./scripts/deploy_dev.sh --down            # Stop everything"
    echo ""
}

# Parse arguments
case "${1:-}" in
    --down|-d)
        stop_dev
        ;;
    --rebuild|-r)
        start_dev true false
        ;;
    --branch|-b)
        if [ -z "${2:-}" ]; then
            print_error "Missing branch name. Usage: $0 --branch <branch-name>"
            exit 1
        fi
        switch_branch "$2"
        # Rebuild contract after branch switch to ensure dependencies are current
        start_dev true false
        ;;
    --status|-s)
        show_status
        ;;
    --logs|-l)
        show_logs
        ;;
    --fresh|-f)
        start_dev true true
        ;;
    --reset-password)
        reset_password
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
        echo "  --down            Stop native processes + DB/Redis containers"
        echo "  --status          Show process/container status"
        echo "  --logs            Tail API and web logs"
        echo "  --help            Show this help message"
        echo ""
        echo "Examples:"
        echo "  $0 --branch rok-123    # Switch to feature branch and deploy"
        echo "  $0 --rebuild           # Rebuild contract and start"
        ;;
    *)
        start_dev false false
        ;;
esac
