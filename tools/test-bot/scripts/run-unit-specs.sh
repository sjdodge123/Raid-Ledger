#!/usr/bin/env bash
#
# Run every pure assertion spec in tools/test-bot/src/smoke.
#
# WHY A GLOB, NOT A LIST
# ----------------------
# `scripts/validate-ci.sh::run_tools_tests` used to name four specs explicitly
# (render-rules.selftest, bot-author-filter, channel-set, channel-filter). By
# 2026-09-07 there were TEN, so six had silently drifted out of every gate —
# and the four that were listed ran only under `--full`, which the lite-gate
# default tells everyone to skip. A glob cannot drift: a new *.spec.ts under
# src/smoke/ is gated the moment it lands.
#
# These specs are deliberately PURE — no Discord connection, no API, no env,
# no network. That is what lets them run in the GitHub `lint` job and in the
# local gate alike. A spec that needs a live Discord guild belongs in the
# companion smoke suite (`npm run smoke`), NOT here; adding one would break
# every PR that touches test-bot.
#
# Each spec is self-executing: it keeps its own passed/failed counters and
# exits non-zero on failure. We therefore run them as plain scripts and
# aggregate exit codes rather than delegating to a test runner.
#
# tsx resolves from the repo-root node_modules (tools/test-bot is NOT an npm
# workspace), so no test-bot-local install is required — the same property the
# CI lint job relies on.
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

status=0
ran=0
failed_specs=()

for spec in src/smoke/*.spec.ts src/smoke/*.selftest.ts; do
    # Guard against a glob that matched nothing (nullglob is not set).
    [ -e "$spec" ] || continue
    ran=$((ran + 1))
    echo "--- $spec ---"
    if ! npx tsx "$spec"; then
        status=1
        failed_specs+=("$spec")
    fi
done

if [ "$ran" -eq 0 ]; then
    echo "run-unit-specs: no specs matched src/smoke/*.spec.ts — refusing to pass" >&2
    exit 1
fi

echo
if [ "$status" -eq 0 ]; then
    echo "run-unit-specs: $ran spec file(s) passed"
else
    echo "run-unit-specs: ${#failed_specs[@]} of $ran spec file(s) FAILED:" >&2
    printf '  %s\n' "${failed_specs[@]}" >&2
fi
exit "$status"
