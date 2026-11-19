#!/usr/bin/env bash
# =============================================================================
# scripts/lib/clone-prod-env.sh — shared helpers for the prod-clone scripts
# (ROK-2263, decision D14). Sourced, never executed.
#
#   clone_env_default_tree             caller's tree (git top-level of $PWD)
#   clone_env_main_checkout <tree>     main checkout of <tree>'s repository
#   clone_env_resolve_file <tree>      first env file in the D14 order
#   clone_env_load <file>              source the env file (set -a)
#   clone_env_token_kind <token>       prints backup | jwt; non-zero otherwise
#   clone_env_select_auth              picks prod auth from the loaded vars;
#                                      sets CLONE_AUTH_MODE + CLONE_AUTH_TOKEN
#   clone_env_write_auth_header <file> writes the bearer header to a 0600 file
#   clone_env_assert_local_db_url <url> [label]
#                                      refuses unless libpq can ONLY reach a
#                                      local Postgres (every destructive path)
#   clone_env_reset_admin_password <tree> <db_url>
#                                      bootstrap-admin reset pinned to <db_url>
#
# Secrets rule: no function here ever prints a token, password or the env
# file's contents. Every message goes to stderr; only paths and kinds are
# printed on stdout.
# =============================================================================

# rlbx_ + 43 base64url chars — mirrors BACKUP_EXPORT_TOKEN_PATTERN (contract).
CLONE_ENV_BACKUP_TOKEN_RE='^rlbx_[A-Za-z0-9_-]{43}$'
# A JWT: three base64url segments; the header always starts with eyJ.
CLONE_ENV_JWT_RE='^eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'

clone_env_warn() { printf 'WARN: %s\n' "$*" >&2; }
clone_env_err()  { printf 'ERROR: %s\n' "$*" >&2; }

# The caller's tree: the git top-level of $PWD, else empty (caller falls back).
clone_env_default_tree() {
    git rev-parse --show-toplevel 2>/dev/null || true
}

# The main checkout of <tree>'s repository (first `git worktree list` entry).
clone_env_main_checkout() {
    local tree="$1"
    git -C "$tree" worktree list --porcelain 2>/dev/null \
        | awk '/^worktree /{ sub(/^worktree /, ""); print; exit }'
}

# Resolution order (D14), first match wins:
#   1. $RL_ENV_CLONE_FILE  (explicit — must exist, never falls through)
#   2. ~/.config/raid-ledger/env.clone
#   3. <tree>/.env.clone
#   4. <main checkout>/.env.clone
clone_env_resolve_file() {
    local tree="${1:-}" main="" candidate
    if [[ -n "${RL_ENV_CLONE_FILE:-}" ]]; then
        if [[ -f "$RL_ENV_CLONE_FILE" ]]; then
            printf '%s\n' "$RL_ENV_CLONE_FILE"
            return 0
        fi
        clone_env_err "RL_ENV_CLONE_FILE is set but no file exists at $RL_ENV_CLONE_FILE"
        return 1
    fi
    [[ -n "$tree" ]] && main="$(clone_env_main_checkout "$tree")"
    for candidate in "$HOME/.config/raid-ledger/env.clone" \
        ${tree:+"$tree/.env.clone"} ${main:+"$main/.env.clone"}; do
        if [[ -f "$candidate" ]]; then
            printf '%s\n' "$candidate"
            return 0
        fi
    done
    clone_env_err "no clone env file found. Looked in: \$RL_ENV_CLONE_FILE, ~/.config/raid-ledger/env.clone${tree:+, $tree/.env.clone}${main:+, $main/.env.clone}"
    return 1
}

clone_env_load() {
    local file="$1"
    set -a
    # shellcheck disable=SC1090
    source "$file"
    set +a
    # Prod secrets stay shell-local: no child process (docker, psql, npm, the
    # sync script) inherits them. The token reaches curl only via the 0600
    # header file (review fix B7).
    export -n PROD_BACKUP_TOKEN PROD_BEARER_TOKEN PROD_ADMIN_PASSWORD 2>/dev/null || true
}

# Prints `backup` (rlbx_ token) or `jwt`; returns 1 for anything else.
clone_env_token_kind() {
    local token="${1:-}"
    if [[ "$token" =~ $CLONE_ENV_BACKUP_TOKEN_RE ]]; then
        printf 'backup\n'
    elif [[ "$token" =~ $CLONE_ENV_JWT_RE ]]; then
        printf 'jwt\n'
    else
        return 1
    fi
}

# Picks the prod auth from the loaded env vars. On success sets
#   CLONE_AUTH_MODE  = token | login
#   CLONE_AUTH_TOKEN = the bearer token (token mode only; never printed)
# Order: PROD_BACKUP_TOKEN (rlbx_, preferred) → PROD_BEARER_TOKEN (JWT,
# deprecated) → PROD_ADMIN_EMAIL + PROD_ADMIN_PASSWORD (deprecated).
clone_env_select_auth() {
    CLONE_AUTH_MODE=""
    CLONE_AUTH_TOKEN=""
    if [[ -n "${PROD_BACKUP_TOKEN:-}" ]]; then
        if [[ "$(clone_env_token_kind "$PROD_BACKUP_TOKEN" || true)" != "backup" ]]; then
            clone_env_err "PROD_BACKUP_TOKEN is not an rlbx_ backup token (expected rlbx_ + 43 characters). Mint one in Admin -> Backups."
            return 1
        fi
        CLONE_AUTH_MODE="token"
        CLONE_AUTH_TOKEN="$PROD_BACKUP_TOKEN"
        return 0
    fi
    if [[ -n "${PROD_BEARER_TOKEN:-}" ]]; then
        if ! clone_env_token_kind "$PROD_BEARER_TOKEN" >/dev/null; then
            clone_env_err "PROD_BEARER_TOKEN is neither a JWT nor an rlbx_ backup token."
            return 1
        fi
        clone_env_warn "PROD_BEARER_TOKEN is deprecated and will be removed next release. Mint a backup token in Admin -> Backups and set PROD_BACKUP_TOKEN instead."
        CLONE_AUTH_MODE="token"
        CLONE_AUTH_TOKEN="$PROD_BEARER_TOKEN"
        return 0
    fi
    if [[ -n "${PROD_ADMIN_EMAIL:-}" && -n "${PROD_ADMIN_PASSWORD:-}" ]]; then
        clone_env_warn "PROD_ADMIN_EMAIL + PROD_ADMIN_PASSWORD is deprecated and will be removed next release. Set PROD_BACKUP_TOKEN instead."
        CLONE_AUTH_MODE="login"
        return 0
    fi
    clone_env_err "missing prod auth: set PROD_BACKUP_TOKEN (Admin -> Backups -> Clone access tokens)."
    return 1
}

# Writes `Authorization: Bearer <token>` to <file> (mode 0600) so curl reads it
# with `-H @<file>` and the token never appears in a process listing.
clone_env_write_auth_header() {
    local file="$1"
    ( umask 077 && printf 'Authorization: Bearer %s\n' "$CLONE_AUTH_TOKEN" >"$file" )
}

# ─── Prod-safe HTTP wrappers ──────────────────────────────────────────────
# The ONLY prod calls any clone script makes: POST /auth/local (deprecated
# login) or /admin/backups, GET the list or one backup's download.
PROD_POST_ALLOWED=("/auth/local" "/admin/backups")
PROD_GET_ALLOWED_PREFIX="/admin/backups"  # exact list endpoint or (daily|migration)/<file>/download

prod_post_safe() {
    # Usage: prod_post_safe <path> [curl args...]
    local pth="$1"; shift
    local allowed=false ap
    for ap in "${PROD_POST_ALLOWED[@]}"; do
        if [[ "$pth" == "$ap" ]]; then allowed=true; break; fi
    done
    if ! $allowed; then
        clone_env_err "BLOCKED: POST $pth is not on the prod-safe whitelist."
        clone_env_err "Allowed: ${PROD_POST_ALLOWED[*]}"
        exit 1
    fi
    curl -fsS -X POST "$PROD_URL$pth" "$@"
}

prod_get_safe() {
    # Usage: prod_get_safe <path> [curl args...]
    local pth="$1"; shift
    if [[ "$pth" != "$PROD_GET_ALLOWED_PREFIX" \
        && ! "$pth" =~ ^/admin/backups/(daily|migration)/[A-Za-z0-9_][A-Za-z0-9_.-]*/download$ ]]; then
        clone_env_err "BLOCKED: GET $pth is not on the prod-safe whitelist."
        clone_env_err "Allowed: $PROD_GET_ALLOWED_PREFIX  OR  $PROD_GET_ALLOWED_PREFIX/(daily|migration)/<file>/download"
        exit 1
    fi
    curl -fsS "$PROD_URL$pth" "$@"
}

# ─── Restore from a clean slate ───────────────────────────────────────────
# Restores <container_dump> (a path inside <container>) into <db_url>. Drops
# the drizzle + public schemas first, so nothing from local branch migrations
# survives beside prod's journal, then restores WITHOUT --clean and fails on
# ANY pg_restore error: an "errors ignored on restore" DB is half-restored
# (review fixes B1/B3). pg_restore's stderr lands in <err_file>.
clone_env_restore_fresh() {
    local container="$1" db_url="$2" dump="$3" err_file="$4"
    docker exec "$container" psql "$db_url" -v ON_ERROR_STOP=1 -qX \
        -c 'DROP SCHEMA IF EXISTS drizzle CASCADE' -c 'DROP SCHEMA public CASCADE' \
        -c 'CREATE SCHEMA public' >/dev/null 2>"$err_file" || return 1
    docker exec "$container" pg_restore --exit-on-error --no-owner --no-privileges \
        --dbname="$db_url" "$dump" 2>"$err_file" || return 1
    ! grep -qE 'errors ignored on restore|pg_restore: error:' "$err_file"
}

# ─── The one localhost guard (Codex r2 P1) ────────────────────────────────
# A regex on the URL's authority is not enough: libpq lets the query string
# (?host= / ?hostaddr= / ?service= / ?servicefile=, percent-encoded or not)
# and PGHOST / PGHOSTADDR / PGSERVICE / PGSERVICEFILE override it, so
# postgresql://u:p@localhost/db?host=prod would DROP SCHEMA on prod. Accepts
# localhost / 127.0.0.1 / ::1 / a unix-socket directory only. Never prints
# the URL (it carries a password).

# Is <h> one local host: loopback name/address, or a unix-socket directory?
clone_env_is_local_host() {
    case "$1" in
        localhost|127.0.0.1|::1) return 0 ;;
        /*) [[ "$1" != *,* ]] ;;
        *) return 1 ;;
    esac
}

# Percent-decodes <s>; fails on a backslash (printf %b would interpret it).
clone_env_url_decode() {
    [[ "$1" != *\\* ]] || return 1
    printf '%b' "${1//%/\\x}"
}

# Prints why <url> or the PG* env could reach a non-local host; empty = local.
clone_env_db_url_problem() {
    local url="$1" auth host query pair key val
    local -a pairs=()
    [[ "$url" =~ ^postgres(ql)?://([^/?#]*)(/[^?#]*)?(\?([^#]*))?$ ]] \
        || { echo "not a plain postgres:// URL"; return; }
    auth="${BASH_REMATCH[2]}"; query="${BASH_REMATCH[5]}"
    host="${auth##*@}"
    [[ "$host" =~ ^(localhost|127\.0\.0\.1|\[::1\])?(:[0-9]+)?$ ]] \
        || { echo "its host is not local"; return; }
    [[ -n "$query" ]] && IFS='&' read -ra pairs <<<"$query"
    for pair in ${pairs[@]+"${pairs[@]}"}; do
        key="$(clone_env_url_decode "${pair%%=*}")" || { echo "its query is not decodable"; return; }
        val="$(clone_env_url_decode "${pair#*=}")" || { echo "its query is not decodable"; return; }
        case "$key" in
            host) clone_env_is_local_host "$val" || { echo "its query sets host="; return; } ;;
            hostaddr) [[ "$val" == 127.0.0.1 || "$val" == ::1 ]] || { echo "its query sets hostaddr="; return; } ;;
            service|servicefile) echo "its query sets $key="; return ;;
        esac
    done
    [[ -z "${PGHOST:-}" ]] || clone_env_is_local_host "$PGHOST" || { echo "PGHOST is not local"; return; }
    [[ -z "${PGHOSTADDR:-}" || "$PGHOSTADDR" == 127.0.0.1 || "$PGHOSTADDR" == ::1 ]] \
        || { echo "PGHOSTADDR is not local"; return; }
    [[ -z "${PGSERVICE:-}" ]] || { echo "PGSERVICE is set"; return; }
    [[ -z "${PGSERVICEFILE:-}" ]] || { echo "PGSERVICEFILE is set"; return; }
}

clone_env_assert_local_db_url() {
    local label="${2:-DATABASE_URL}" why
    why="$(clone_env_db_url_problem "$1")"
    [[ -z "$why" ]] && return 0
    clone_env_err "$label must point at localhost/127.0.0.1/::1 or a local socket (host redacted): $why."
    return 1
}

# ─── Admin password reset, pinned to the clone DB (Codex r2 P2) ───────────
# deploy_dev.sh --reset-password runs load_env, which re-sources the tree's
# .env and can re-point DATABASE_URL at another database. Run the tree's
# bootstrap-admin.ts directly with the resolved clone URL pinned instead; its
# own dotenv load never overrides a variable that is already set.
clone_env_reset_admin_password() {
    local tree="$1" db_url="$2"
    clone_env_assert_local_db_url "$db_url" || return 1
    [[ -f "$tree/api/scripts/bootstrap-admin.ts" ]] \
        || { clone_env_err "no api/scripts/bootstrap-admin.ts under $tree"; return 1; }
    ( cd "$tree" && DATABASE_URL="$db_url" RESET_PASSWORD=true \
        ENABLE_TELEMETRY="${ENABLE_TELEMETRY:-false}" \
        npx ts-node api/scripts/bootstrap-admin.ts )
}
