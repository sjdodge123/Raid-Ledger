#!/usr/bin/env bash
# ROK-1358 — sync-local-to-env.sh DNS-fallback host resolution + diagnosable
# probe failures.
#
# ROOT CAUSE this guards: the script reached the VM via a RAW
# `ssh rl-agent@rl-infra` with NO DNS fallback, while the path that WORKS
# (rl_db_query → exec.ts resolveProxmoxHost, and the `rl` CLI →
# cli/rl::resolve_proxmox_host) DNS-resolves `rl-infra` and falls back to the
# literal RL_INFRA_IP from repo-root .env. In a sandboxed Claude session
# `rl-infra` doesn't resolve, so every env-inspect/env-psql probe failed,
# its stderr was swallowed, and the empty result was misreported as
# "env's public schema is empty or pg not ready" (exit 3) against a HEALTHY
# env (rl_db_query, which DOES fall back, saw 67 tables in the same env).
#
# Strategy (mirrors sync-local-to-env-infra-read.test.sh): extract the
# resolution helpers VERBATIM from the real script (single source of truth —
# no drift), then exercise them against PATH-stubbed DNS tools so we control
# whether the hostname "resolves". Plus STATIC assertions that the two exit-3
# probe failures name the container + database (diagnosability, AC3). No live
# VM needed. Runs under bash 3.2 (macOS default) — the SAME shell the MCP
# server invokes the script with.

set -uo pipefail

CURRENT_TEST_FILE="sync-local-to-env-host-resolve.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

WORKTREE_ROOT="$(cd "$TEST_DIR/../../.." && pwd)"
SYNC_SCRIPT="$WORKTREE_ROOT/scripts/sync-local-to-env.sh"

# --- Extract the three resolution helpers VERBATIM from the real script ------
# Each spans from `<name>() {` through the first column-0 `}` (the function's
# own closing brace — inner groups close inline).
extract_fn() {
    sed -n "/^$1() {/,/^}/p" "$SYNC_SCRIPT"
}

# Build a harness that sources the extracted helpers + a controllable PATH of
# DNS-probe stubs, then calls resolve_proxmox_host and prints the result.
#   $1 = host arg to resolve
#   $2 = RL_INFRA_IP value to expose ("" = unset)
#   $3 = stub bin dir (DNS probe tools all exit with $STUB_EXIT)
run_resolve_host() {
    local host_arg="$1" infra_ip="$2" stub_dir="$3"
    local harness
    harness=$(mktemp -t rl-host-resolve.XXXXXX)
    {
        echo 'set -uo pipefail'
        if [[ -n "$infra_ip" ]]; then
            echo "RL_INFRA_IP='$infra_ip'"
        fi
        extract_fn is_default_proxmox_host
        extract_fn probe_dns_for_host
        extract_fn resolve_proxmox_host
        echo "resolve_proxmox_host '$host_arg'"
    } > "$harness"
    # Prepend the stub dir so the stubbed getent/dscacheutil/host win.
    PATH="$stub_dir:$PATH" /bin/bash "$harness" 2>/dev/null
    rm -f "$harness"
}

# Build a temp bin dir whose getent/dscacheutil/host all signal resolution
# success ($1=0) or failure ($1=1). dscacheutil's "answer" is emulated by
# printing an ip_address: line on success (the real impl greps for it).
make_dns_stub() {
    local resolves="$1"  # 0 = resolves, 1 = fails
    local stub_dir
    stub_dir=$(mktemp -d -t rl-host-resolve-stub.XXXXXX)
    # getent + host: plain exit-code contract.
    for cmd in getent host; do
        cat >"$stub_dir/$cmd" <<EOF
#!/usr/bin/env bash
exit $resolves
EOF
        chmod +x "$stub_dir/$cmd"
    done
    # dscacheutil exits 0 regardless; success is signalled by an ip_address: line.
    if [[ "$resolves" == "0" ]]; then
        cat >"$stub_dir/dscacheutil" <<'EOF'
#!/usr/bin/env bash
echo "ip_address: 192.168.0.132"
exit 0
EOF
    else
        cat >"$stub_dir/dscacheutil" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
    fi
    chmod +x "$stub_dir/dscacheutil"
    echo "$stub_dir"
}

STUB_RESOLVES=$(make_dns_stub 0)
STUB_FAILS=$(make_dns_stub 1)
trap 'rm -rf "$STUB_RESOLVES" "$STUB_FAILS"' EXIT

# ---------------------------------------------------------------------------
# Case 1: extraction sanity — all three helpers present + parseable.
test_extraction() {
    CURRENT_TEST_NAME="resolution helpers extract + parse"
    # Concatenate with explicit newlines between functions — command
    # substitution strips trailing newlines, so a bare join would weld one
    # function's closing `}` onto the next's header. The real harness keeps
    # them separate (one extract_fn per line), which is why cases 2-5 parse.
    local fns
    fns="$(printf '%s\n%s\n%s\n' \
        "$(extract_fn is_default_proxmox_host)" \
        "$(extract_fn probe_dns_for_host)" \
        "$(extract_fn resolve_proxmox_host)")"
    assert_contains "$fns" "resolve_proxmox_host() {" "resolve_proxmox_host present"
    assert_contains "$fns" "probe_dns_for_host() {" "probe_dns_for_host present"
    assert_contains "$fns" "RL_INFRA_IP" "fallback references RL_INFRA_IP"
    if printf '%s' "$fns" | /bin/bash -n - 2>/dev/null; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: extracted helpers do not parse")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] extracted helpers failed bash -n"
    fi
}

# Case 2: healthy-env probe success — hostname resolves → echo it verbatim.
# This is the path that makes a standalone sync against a HEALTHY env work:
# the SSH target resolves, so env-inspect/env-psql reach the env's real pg.
test_dns_success_echoes_host() {
    CURRENT_TEST_NAME="healthy env: DNS resolves → echoes RL_PROXMOX_HOST verbatim"
    local out
    out=$(run_resolve_host "rl-infra" "192.168.0.132" "$STUB_RESOLVES")
    assert_eq "$out" "rl-infra" "resolves → host echoed verbatim (no needless IP swap)"
}

# Case 3: THE BUG FIX — hostname does NOT resolve → fall back to RL_INFRA_IP.
# Pre-fix the script went straight to `ssh rl-agent@rl-infra`, which failed
# to resolve in the sandbox and made a healthy env look dead.
test_dns_failure_falls_back_to_ip() {
    CURRENT_TEST_NAME="sandbox: DNS fails → falls back to RL_INFRA_IP (the fix)"
    local out
    out=$(run_resolve_host "rl-infra" "192.168.0.132" "$STUB_FAILS")
    assert_eq "$out" "192.168.0.132" "DNS-fail → echoes RL_INFRA_IP from .env"
}

# Case 4: DNS fails AND no RL_INFRA_IP → best-effort echo original host.
test_dns_failure_no_ip_best_effort() {
    CURRENT_TEST_NAME="DNS fails + no RL_INFRA_IP → best-effort echo original host"
    local out
    out=$(run_resolve_host "rl-infra.lan" "" "$STUB_FAILS")
    assert_eq "$out" "rl-infra.lan" "no fallback IP → echo original host (ssh fails loudly downstream)"
}

# Case 5: explicit operator override (non-default host) → echoed verbatim,
# DNS never probed (matches resolveProxmoxHost / cli resolve_proxmox_host).
test_explicit_override_wins() {
    CURRENT_TEST_NAME="explicit RL_PROXMOX_HOST override → verbatim, no probe"
    local out
    # STUB_FAILS would force a fallback IF the override path didn't short-circuit.
    out=$(run_resolve_host "custom.host.example" "192.168.0.132" "$STUB_FAILS")
    assert_eq "$out" "custom.host.example" "explicit override trusted without probing"
}

# Case 6: STATIC — env-inspect probe failure (settings AND full modes) names
# the container + database + host it targeted (AC3 diagnosability).
test_inspect_failure_names_container_and_db() {
    CURRENT_TEST_NAME="STATIC: env-inspect probe failure names container + db"
    local body; body=$(cat "$SYNC_SCRIPT")
    assert_contains "$body" "could not confirm env DB container '\$ENV_PG_CONTAINER' (db '\$ENV_PG_DATABASE')" \
        "inspect failure names container + database"
    assert_contains "$body" "env-inspect/ssh stderr:" "inspect failure surfaces swallowed ssh stderr"
}

# Case 7: STATIC — full-mode "schema empty" probe failure names the container
# + database (AC3) and surfaces the previously-swallowed env-psql stderr.
test_schema_empty_failure_names_container_and_db() {
    CURRENT_TEST_NAME="STATIC: 'schema empty' failure names container + db"
    local body; body=$(cat "$SYNC_SCRIPT")
    assert_contains "$body" "schema came back empty when probing container '\$ENV_PG_CONTAINER'" \
        "schema-empty failure names container"
    assert_contains "$body" "db '\$ENV_PG_DATABASE'" "schema-empty failure names database"
    assert_contains "$body" "env-psql/ssh stderr:" "schema-empty failure surfaces swallowed ssh stderr"
}

# Case 8: STATIC — the script actually APPLIES the resolver to RL_PROXMOX_HOST
# (guards against the helper existing but never being wired in).
test_resolver_is_wired_in() {
    CURRENT_TEST_NAME="STATIC: RL_PROXMOX_HOST runs through resolve_proxmox_host"
    local body; body=$(cat "$SYNC_SCRIPT")
    assert_contains "$body" 'RL_PROXMOX_HOST="$(resolve_proxmox_host "$RL_PROXMOX_HOST")"' \
        "resolver wired into RL_PROXMOX_HOST"
}

run_test "extraction" test_extraction
run_test "dns-success-echoes-host" test_dns_success_echoes_host
run_test "dns-failure-falls-back-to-ip" test_dns_failure_falls_back_to_ip
run_test "dns-failure-no-ip" test_dns_failure_no_ip_best_effort
run_test "explicit-override" test_explicit_override_wins
run_test "inspect-failure-diagnosable" test_inspect_failure_names_container_and_db
run_test "schema-empty-failure-diagnosable" test_schema_empty_failure_names_container_and_db
run_test "resolver-wired-in" test_resolver_is_wired_in

print_test_summary
