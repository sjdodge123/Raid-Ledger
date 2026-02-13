#!/bin/bash
# =============================================================================
# deploy_prod.sh - Production Docker Stack
# =============================================================================
# Runs the full Docker stack (API + Web + DB + Redis) on http://localhost:80
# Shares the same DB volume as deploy_dev.sh.
#
# Usage:
#   ./scripts/deploy_prod.sh                  # Start Docker stack (cached images)
#   ./scripts/deploy_prod.sh --rebuild        # Rebuild images then start
#   ./scripts/deploy_prod.sh --fresh          # Reset DB, new admin password, rebuild
#   ./scripts/deploy_prod.sh --reset-password # Reset admin password (no data loss)
#   ./scripts/deploy_prod.sh --down           # Stop all containers
#   ./scripts/deploy_prod.sh --status         # Show container status
#   ./scripts/deploy_prod.sh --logs           # Tail API logs
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
COMPOSE_FILE="$PROJECT_DIR/docker-compose.yml"
PROFILE="test"
ENV_FILE="$PROJECT_DIR/.env"

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

show_status() {
    print_header "Container Status"
    docker compose -f "$COMPOSE_FILE" --profile "$PROFILE" ps
}

show_logs() {
    print_header "API Logs (Ctrl+C to exit)"
    docker compose -f "$COMPOSE_FILE" --profile "$PROFILE" logs -f api
}

stop_containers() {
    print_header "Stopping Containers"
    docker compose -f "$COMPOSE_FILE" --profile "$PROFILE" down
    print_success "All containers stopped"
}

kill_native_processes() {
    # Kill native node/vite processes that might hold ports 3000, 5173
    local pids
    pids=$(lsof -ti:3000,5173 2>/dev/null || true)
    if [ -n "$pids" ]; then
        print_warning "Killing native processes on ports 3000, 5173..."
        echo "$pids" | xargs kill 2>/dev/null || true
        sleep 1
    fi
}

reset_password() {
    print_header "Resetting Admin Password"

    # Ensure db is running
    if ! docker compose -f "$COMPOSE_FILE" ps db 2>/dev/null | grep -q "running"; then
        print_warning "Starting database container..."
        docker compose -f "$COMPOSE_FILE" up -d db
        echo "Waiting for database..."
        sleep 5
    fi

    # Run bootstrap with RESET_PASSWORD=true against the shared DB
    RESET_PASSWORD=true npx ts-node api/scripts/bootstrap-admin.ts

    print_success "Admin password has been reset (check output above for new password)"
}

start_containers() {
    local rebuild=$1
    local fresh=$2

    # Kill native dev processes that might conflict
    kill_native_processes

    print_header "Starting Production Docker Stack"

    # Fresh start: wipe volumes (new admin password will be auto-generated on bootstrap)
    if [ "$fresh" = "true" ]; then
        print_warning "Fresh start: removing volumes and rebuilding..."
        docker compose -f "$COMPOSE_FILE" --profile "$PROFILE" down -v 2>/dev/null || true
        print_success "Database wiped. New admin password will be generated on bootstrap."

        docker compose -f "$COMPOSE_FILE" --profile "$PROFILE" build --no-cache
    elif [ "$rebuild" = "true" ]; then
        print_warning "Rebuilding images (this may take a few minutes)..."
        docker compose -f "$COMPOSE_FILE" --profile "$PROFILE" build
    fi

    # Load env for DATABASE_URL and other config
    load_env

    # Start containers
    echo "Starting containers..."
    docker compose -f "$COMPOSE_FILE" --profile "$PROFILE" up -d

    # Wait for health checks
    echo "Waiting for services to be healthy..."
    local max_wait=120
    local waited=0

    while [ $waited -lt $max_wait ]; do
        if docker compose -f "$COMPOSE_FILE" --profile "$PROFILE" ps api 2>/dev/null | grep -q "healthy"; then
            break
        fi

        if docker compose -f "$COMPOSE_FILE" --profile "$PROFILE" ps api 2>/dev/null | grep -q "unhealthy\|Exit"; then
            print_error "API container failed to start!"
            echo ""
            echo "API Logs:"
            docker compose -f "$COMPOSE_FILE" --profile "$PROFILE" logs --tail=30 api
            exit 1
        fi

        sleep 2
        waited=$((waited + 2))
        echo -n "."
    done
    echo ""

    if [ $waited -ge $max_wait ]; then
        print_error "Timeout waiting for containers to be healthy"
        show_status
        exit 1
    fi

    # Final status
    print_header "Production Stack Ready"
    echo -e "  ${GREEN}Web UI:${NC}     http://localhost:80"
    echo -e "  ${GREEN}API:${NC}        http://localhost:3000"
    echo -e "  ${GREEN}API Health:${NC} http://localhost:3000/health"
    echo ""
    show_credentials
    echo ""
    echo -e "  ${BLUE}Commands:${NC}"
    echo "    ./scripts/deploy_prod.sh --status          # Show container status"
    echo "    ./scripts/deploy_prod.sh --logs            # Tail API logs"
    echo "    ./scripts/deploy_prod.sh --reset-password  # Reset admin password"
    echo "    ./scripts/deploy_prod.sh --down            # Stop everything"
    echo ""
}

# Parse arguments
case "${1:-}" in
    --down|-d)
        stop_containers
        ;;
    --rebuild|-r)
        start_containers true false
        ;;
    --status|-s)
        show_status
        ;;
    --logs|-l)
        show_logs
        ;;
    --fresh|-f)
        start_containers true true
        ;;
    --reset-password)
        reset_password
        ;;
    --help|-h)
        echo "Usage: $0 [OPTIONS]"
        echo ""
        echo "Options:"
        echo "  (none)            Start Docker stack (uses cached images)"
        echo "  --rebuild         Rebuild images before starting"
        echo "  --fresh           Reset DB, new admin password, rebuild no-cache"
        echo "  --reset-password  Reset admin password without losing data"
        echo "  --down            Stop all containers"
        echo "  --status          Show container status"
        echo "  --logs            Tail API logs"
        echo "  --help            Show this help message"
        ;;
    *)
        start_containers false false
        ;;
esac
