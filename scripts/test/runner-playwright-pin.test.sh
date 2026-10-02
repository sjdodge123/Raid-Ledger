#!/usr/bin/env bash
# Guard: the fleet runner image's Playwright base tag stays in EXACT lockstep
# with the Playwright version package-lock.json installs.
#
# Why a guard test:
#   rl-infra/runner/Dockerfile builds FROM mcr.microsoft.com/playwright:vX.Y.Z-jammy,
#   and that image ships the browser builds for exactly one Playwright release.
#   When package-lock.json moves @playwright/test / playwright-core and the
#   runner tag does not follow, every runner that ran `npm ci` looks for a
#   chromium revision the image does not have, and Playwright's globalSetup
#   fails fleet-wide (TDB:1935). Nothing caught that drift (TDB:552).
#   A patch release can change the browser revision, so the match is on the
#   full X.Y.Z, never on the minor alone.
#
# The self-tests run check_pin against throwaway fixtures first, proving the
# guard can go red AND green before it judges the real files.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOCKFILE="$REPO_ROOT/package-lock.json"
DOCKERFILE="$REPO_ROOT/rl-infra/runner/Dockerfile"

PASS=0
FAIL=0

ok()   { echo "PASS: $1"; PASS=$((PASS + 1)); }
bad()  { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

# lock_version <lockfile> <packages-key>: prints that entry's version, or
# nothing when the file is unreadable or the entry/version is absent.
lock_version() {
    node -e '
        const fs = require("fs");
        try {
            const lock = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
            const entry = (lock.packages || {})[process.argv[2]];
            if (entry && typeof entry.version === "string") process.stdout.write(entry.version);
        } catch (err) {
            process.stderr.write("cannot read " + process.argv[1] + ": " + err.message + "\n");
        }
    ' "$1" "$2"
}

# check_pin <lockfile> <dockerfile>: echoes one message; returns 0 only when
# the Dockerfile's playwright:vX.Y.Z-jammy tag equals the locked version.
check_pin() {
    local lockfile="$1" dockerfile="$2" core test_pkg tag
    core="$(lock_version "$lockfile" node_modules/playwright-core)"
    test_pkg="$(lock_version "$lockfile" node_modules/@playwright/test)"
    if [[ -z "$core" || -z "$test_pkg" ]]; then
        echo "$lockfile has no version for node_modules/playwright-core ('$core') or node_modules/@playwright/test ('$test_pkg')"
        return 1
    fi
    if [[ "$core" != "$test_pkg" ]]; then
        echo "package-lock.json disagrees with itself: @playwright/test $test_pkg vs playwright-core $core; settle the lockfile before pinning rl-infra/runner/Dockerfile"
        return 1
    fi
    [[ -f "$dockerfile" ]] || { echo "missing Dockerfile: $dockerfile"; return 1; }
    tag="$(sed -nE 's|^FROM mcr\.microsoft\.com/playwright:v([0-9]+\.[0-9]+\.[0-9]+)-jammy([[:space:]].*)?$|\1|p' "$dockerfile" | head -n 1)"
    if [[ -z "$tag" ]]; then
        echo "no 'FROM mcr.microsoft.com/playwright:vX.Y.Z-jammy' line in $dockerfile (the rl-infra/runner/Dockerfile FROM line), so the runner's Playwright version cannot be checked"
        return 1
    fi
    if [[ "$tag" != "$core" ]]; then
        echo "runner Playwright pin drift: rl-infra/runner/Dockerfile FROM line is v$tag-jammy but package-lock.json locks playwright-core $core. Edit the rl-infra/runner/Dockerfile FROM line to mcr.microsoft.com/playwright:v$core-jammy; after merge the operator rebuilds the runners per rl-infra/README.md"
        return 1
    fi
    echo "rl-infra/runner/Dockerfile FROM line v$tag-jammy matches package-lock.json playwright-core $core"
    return 0
}

# --- self-tests on fixtures ---------------------------------------------------
FIXTURES="$(mktemp -d)"
trap 'rm -rf "$FIXTURES"' EXIT

write_lock() { # <path> <playwright-core version> <@playwright/test version>
    printf '{"packages":{"node_modules/playwright-core":{"version":"%s"},"node_modules/@playwright/test":{"version":"%s"}}}\n' \
        "$2" "$3" > "$1"
}
write_dockerfile() { # <path> <FROM line>
    printf '# fixture\n%s\n\nLABEL rl.role=runner\n' "$2" > "$1"
}

write_lock "$FIXTURES/lock-163.json" 1.63.0 1.63.0
write_lock "$FIXTURES/lock-split.json" 1.63.0 1.62.1
write_dockerfile "$FIXTURES/Dockerfile-160" "FROM mcr.microsoft.com/playwright:v1.60.0-jammy"
write_dockerfile "$FIXTURES/Dockerfile-163" "FROM mcr.microsoft.com/playwright:v1.63.0-jammy"
write_dockerfile "$FIXTURES/Dockerfile-1631" "FROM mcr.microsoft.com/playwright:v1.63.1-jammy"
write_dockerfile "$FIXTURES/Dockerfile-noble" "FROM mcr.microsoft.com/playwright:v1.63.0-noble"

out="$(check_pin "$FIXTURES/lock-163.json" "$FIXTURES/Dockerfile-160")"; rc=$?
if (( rc != 0 )) && grep -qF '1.60.0' <<<"$out" && grep -qF '1.63.0' <<<"$out" \
    && grep -qF 'rl-infra/runner/Dockerfile' <<<"$out" && grep -qF 'rl-infra/README.md' <<<"$out"; then
    ok "stale tag v1.60.0 vs lock 1.63.0 is red and names both versions, the FROM line and the rebuild"
else
    bad "stale tag v1.60.0 vs lock 1.63.0 should be red naming 1.60.0, 1.63.0, rl-infra/runner/Dockerfile, rl-infra/README.md (rc=$rc): $out"
fi

out="$(check_pin "$FIXTURES/lock-163.json" "$FIXTURES/Dockerfile-1631")"; rc=$?
if (( rc != 0 )); then ok "patch-only drift v1.63.1 vs lock 1.63.0 is red (exact match, not minor-only)"
else bad "patch-only drift v1.63.1 vs lock 1.63.0 should be red (rc=$rc): $out"; fi

out="$(check_pin "$FIXTURES/lock-split.json" "$FIXTURES/Dockerfile-163")"; rc=$?
if (( rc != 0 )); then ok "@playwright/test 1.62.1 vs playwright-core 1.63.0 is red"
else bad "@playwright/test 1.62.1 vs playwright-core 1.63.0 should be red (rc=$rc): $out"; fi

out="$(check_pin "$FIXTURES/lock-163.json" "$FIXTURES/Dockerfile-noble")"; rc=$?
if (( rc != 0 )) && grep -qF 'FROM' <<<"$out"; then ok "a Dockerfile with no playwright:vX.Y.Z-jammy FROM line is red with a named message"
else bad "a Dockerfile with no playwright:vX.Y.Z-jammy FROM line should be red (rc=$rc): $out"; fi

out="$(check_pin "$FIXTURES/lock-163.json" "$FIXTURES/Dockerfile-163")"; rc=$?
if (( rc == 0 )); then ok "matching v1.63.0 vs lock 1.63.0 is green (the guard is not always red)"
else bad "matching v1.63.0 vs lock 1.63.0 should be green (rc=$rc): $out"; fi

# --- the real check -------------------------------------------------------------
out="$(check_pin "$LOCKFILE" "$DOCKERFILE")"; rc=$?
if (( rc == 0 )); then ok "$out"; else bad "$out"; fi

echo "runner-playwright-pin: $PASS passed, $FAIL failed"
(( FAIL > 0 )) && exit 1
exit 0
