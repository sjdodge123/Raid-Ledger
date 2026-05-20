#!/usr/bin/env bash
# ROK-1331 M6b HIGH-3 — bash CLI DNS fallback for RL_PROXMOX_HOST.
#
# The rl CLI's new helper `resolve_proxmox_host` should:
#   1. Echo $RL_PROXMOX_HOST when it resolves on the system (ssh/getent/dscacheutil exits 0).
#   2. Fall back to $RL_INFRA_IP loaded from <repo-root>/.env when resolution fails.
#   3. Echo the original $RL_PROXMOX_HOST + warn-on-stderr when BOTH fail
#      (best-effort — let the downstream ssh fail loudly).
#
# We mock the resolver by shadowing the system `ssh` / `getent` / `dscacheutil`
# commands with a temp PATH entry whose exit code we control via env var.
#
# These tests MUST fail today — the helper does NOT yet exist in rl-infra/cli/rl.

set -uo pipefail

CURRENT_TEST_FILE="cli-dns-fallback.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

RL_CLI_PATH="$(cd "$TEST_DIR/../../cli" && pwd)/rl"

# Helper: build a temp bin dir with a stubbed `ssh` (and getent + dscacheutil)
# whose exit code is governed by $1 (0 = resolves, !=0 = fails). Echoes the
# bin dir path so the caller can prepend to PATH.
make_stub_bin() {
    local exit_code="$1"
    local stub_dir
    stub_dir=$(mktemp -d -t rl-cli-dns-stub.XXXXXX)
    # SSH stub — the rl CLI's resolve_target uses ssh BatchMode probe today;
    # the new resolver helper may use getent/dscacheutil instead. Stub all
    # three so the test doesn't depend on which one the impl picks.
    for cmd in ssh getent dscacheutil host dig; do
        cat >"$stub_dir/$cmd" <<EOF
#!/usr/bin/env bash
# Stub for $cmd — controlled by exit code from the test driver.
exit $exit_code
EOF
        chmod +x "$stub_dir/$cmd"
    done
    echo "$stub_dir"
}

# Helper: build a fake repo root containing a .env with RL_INFRA_IP set.
# Echoes the repo root path. Caller `cd`s into it so .env loading anchors
# to that directory (the impl walks `process.cwd()` up to find `.git`).
make_fake_repo_with_env() {
    local ip_value="${1:-192.168.0.132}"
    local repo_dir
    repo_dir=$(mktemp -d -t rl-cli-dns-repo.XXXXXX)
    mkdir -p "$repo_dir/.git"
    printf 'FOO=bar\nRL_INFRA_IP=%s\nBAZ=qux\n' "$ip_value" >"$repo_dir/.env"
    echo "$repo_dir"
}

# Source the rl CLI in a controlled subshell to expose `resolve_proxmox_host`.
# The CLI today runs `set -euo pipefail` at top; sourcing executes module-init
# but the function definition will then be callable in the subshell.
#
# We disable the dispatch tail by passing 'help' as $1 if needed, OR by
# extracting the helper via bash function listing. Simpler: invoke the CLI
# itself with a dedicated subcommand we add: `rl _resolve_host`. For TDD
# (red), call the not-yet-existing subcommand and assert it runs.

# AC-M6b-1: resolve_proxmox_host echoes RL_PROXMOX_HOST when DNS works.
test_resolve_host_dns_success() {
    CURRENT_TEST_NAME="AC-M6b-1: resolve_proxmox_host echoes RL_PROXMOX_HOST on DNS success"
    local stub_bin
    stub_bin=$(make_stub_bin 0)  # success
    local fake_repo
    fake_repo=$(make_fake_repo_with_env 192.168.0.132)

    # Invoke the CLI's internal resolver via an explicit subcommand the dev
    # agent will add (`_resolve_host` — underscore-prefixed = internal/test).
    local out exit_code
    out=$(
        cd "$fake_repo" && \
        PATH="$stub_bin:$PATH" \
        RL_PROXMOX_HOST="rl-infra.lan" \
        RL_PROXMOX_USER="rl-agent" \
        "$RL_CLI_PATH" _resolve_host 2>/dev/null
    )
    exit_code=$?

    assert_exit_code "$exit_code" "0" "_resolve_host should exit 0 when DNS resolves"
    assert_eq "$out" "rl-infra.lan" "should echo RL_PROXMOX_HOST verbatim when resolution succeeds"

    rm -rf "$stub_bin" "$fake_repo"
}

# AC-M6b-2: resolve_proxmox_host falls back to RL_INFRA_IP from .env on DNS failure.
test_resolve_host_falls_back_to_env_ip() {
    CURRENT_TEST_NAME="AC-M6b-2: resolve_proxmox_host falls back to RL_INFRA_IP on DNS failure"
    local stub_bin
    stub_bin=$(make_stub_bin 1)  # ssh/getent FAIL
    local fake_repo
    fake_repo=$(make_fake_repo_with_env 192.168.0.132)

    local out exit_code
    out=$(
        cd "$fake_repo" && \
        PATH="$stub_bin:$PATH" \
        RL_PROXMOX_HOST="rl-infra.lan" \
        RL_PROXMOX_USER="rl-agent" \
        "$RL_CLI_PATH" _resolve_host 2>/dev/null
    )
    exit_code=$?

    assert_exit_code "$exit_code" "0" "_resolve_host should exit 0 when fallback IP is available"
    assert_eq "$out" "192.168.0.132" "should echo RL_INFRA_IP from .env when DNS fails"

    rm -rf "$stub_bin" "$fake_repo"
}

# AC-M6b-3: resolve_proxmox_host walks cwd UP to find the .env file.
test_resolve_host_walks_cwd_to_find_env() {
    CURRENT_TEST_NAME="AC-M6b-3: resolve_proxmox_host walks cwd up to find .env"
    local stub_bin
    stub_bin=$(make_stub_bin 1)  # ssh/getent FAIL
    local fake_repo
    fake_repo=$(make_fake_repo_with_env 192.168.0.132)

    # Create a deeply-nested subdir and invoke from there. The helper should
    # still find the .env at the repo root.
    local nested="$fake_repo/a/b/c"
    mkdir -p "$nested"

    local out exit_code
    out=$(
        cd "$nested" && \
        PATH="$stub_bin:$PATH" \
        RL_PROXMOX_HOST="rl-infra.lan" \
        RL_PROXMOX_USER="rl-agent" \
        "$RL_CLI_PATH" _resolve_host 2>/dev/null
    )
    exit_code=$?

    assert_exit_code "$exit_code" "0" "_resolve_host should exit 0 (fallback path) from nested cwd"
    assert_eq "$out" "192.168.0.132" "should echo RL_INFRA_IP from .env walked-up to repo root"

    rm -rf "$stub_bin" "$fake_repo"
}

# AC-M6b-4: BOTH DNS AND .env missing → emit warning on stderr + best-effort echo.
test_resolve_host_both_failures_warns() {
    CURRENT_TEST_NAME="AC-M6b-4: both-failure path echoes original host + warns on stderr"
    local stub_bin
    stub_bin=$(make_stub_bin 1)  # ssh/getent FAIL
    # NO .env this time.
    local empty_repo
    empty_repo=$(mktemp -d -t rl-cli-dns-empty.XXXXXX)
    mkdir -p "$empty_repo/.git"

    local out stderr
    local tmp_err
    tmp_err=$(mktemp -t rl-cli-dns-stderr.XXXXXX)
    out=$(
        cd "$empty_repo" && \
        PATH="$stub_bin:$PATH" \
        RL_PROXMOX_HOST="rl-infra.lan" \
        RL_PROXMOX_USER="rl-agent" \
        "$RL_CLI_PATH" _resolve_host 2>"$tmp_err"
    )
    stderr=$(<"$tmp_err")

    # Best-effort: should still echo SOMETHING (the original host) and warn
    # so the operator sees the failure.
    assert_eq "$out" "rl-infra.lan" "should echo original host as last-resort fallback"
    assert_contains "$stderr" "RL_INFRA_IP" "stderr warning should mention RL_INFRA_IP"

    rm -rf "$stub_bin" "$empty_repo" "$tmp_err"
}

# AC-M6b-5: explicit RL_PROXMOX_HOST override skips DNS probe + .env entirely.
test_resolve_host_explicit_override_wins() {
    CURRENT_TEST_NAME="AC-M6b-5: explicit RL_PROXMOX_HOST override echoes verbatim"
    local stub_bin
    stub_bin=$(make_stub_bin 1)  # would fail if probed
    local fake_repo
    fake_repo=$(make_fake_repo_with_env 192.168.0.132)

    # Operator sets a NON-default host — helper must honor it.
    local out exit_code
    out=$(
        cd "$fake_repo" && \
        PATH="$stub_bin:$PATH" \
        RL_PROXMOX_HOST="custom.host.example" \
        RL_PROXMOX_USER="rl-agent" \
        "$RL_CLI_PATH" _resolve_host 2>/dev/null
    )
    exit_code=$?

    assert_exit_code "$exit_code" "0" "_resolve_host should exit 0 for explicit override"
    assert_eq "$out" "custom.host.example" "should echo operator's explicit host verbatim"

    rm -rf "$stub_bin" "$fake_repo"
}

# Run all tests.
run_test "AC-M6b-1" test_resolve_host_dns_success
run_test "AC-M6b-2" test_resolve_host_falls_back_to_env_ip
run_test "AC-M6b-3" test_resolve_host_walks_cwd_to_find_env
run_test "AC-M6b-4" test_resolve_host_both_failures_warns
run_test "AC-M6b-5" test_resolve_host_explicit_override_wins

print_test_summary
