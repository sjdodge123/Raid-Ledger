#!/usr/bin/env bash
# fix-migration-order.sh
#
# Validates that Drizzle migration journal timestamps are monotonically
# increasing. Out-of-order timestamps cause Drizzle to silently skip
# migrations — it compares `when` against `created_at` in the DB tracking
# table, so a new migration with a timestamp lower than the last applied
# one is treated as already applied.
#
# This happens when multiple branches generate migrations concurrently
# and get merged out of chronological order.
#
# Usage:
#   ./scripts/fix-migration-order.sh                        # Check + auto-fix
#   ./scripts/fix-migration-order.sh --check                # Check only (exit 1 if bad)
#   ./scripts/fix-migration-order.sh --against <ref>        # Auto-fix vs an explicit base
#   ./scripts/fix-migration-order.sh --check --against <ref> # + merge-order guard, check only
#
# ROK-1693: the neighbour check below cannot see a NEW entry inserted
# mid-journal with an older `when` (0176_lfg_invites merged after 0177 and
# never reached prod). scripts/check-migration-merge-order.mjs compares new
# entries against the base (--against <ref>, else the merge base with
# origin/main). Fix mode runs it FIRST: it re-stamps stale tail entries and
# stops on a mid-journal one, before the neighbour pass could bump an
# already-merged entry (which would make Drizzle re-run it).

set -euo pipefail

JOURNAL="api/src/drizzle/migrations/meta/_journal.json"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JOURNAL_PATH="$SCRIPT_DIR/$JOURNAL"

if [ ! -f "$JOURNAL_PATH" ]; then
    echo "ERROR: Journal not found at $JOURNAL_PATH"
    exit 1
fi

CHECK_ONLY=false
AGAINST=""
while [ $# -gt 0 ]; do
    case "$1" in
        --check) CHECK_ONLY=true ;;
        --against) AGAINST="${2:?--against needs a git ref}"; shift ;;
        *) echo "ERROR: unknown argument: $1"; exit 1 ;;
    esac
    shift
done

GUARD="$SCRIPT_DIR/scripts/check-migration-merge-order.mjs"
if $CHECK_ONLY; then
    if [ -n "$AGAINST" ]; then
        node "$GUARD" --base "$AGAINST" || exit 1
    fi
else
    guard_args=(--fix)
    if [ -n "$AGAINST" ]; then guard_args+=(--base "$AGAINST"); fi
    guard_rc=0
    node "$GUARD" "${guard_args[@]}" || guard_rc=$?
    # 3 = base unresolvable: fatal only when the caller named the base.
    if [ "$guard_rc" -eq 1 ] || { [ "$guard_rc" -ne 0 ] && [ -n "$AGAINST" ]; }; then
        exit 1
    fi
fi

# Use Node.js (already available in this repo) to parse and fix the JSON
node -e "
const fs = require('fs');
const journalPath = '$JOURNAL_PATH';
const checkOnly = $CHECK_ONLY;

const raw = fs.readFileSync(journalPath, 'utf-8');
const journal = JSON.parse(raw);
const entries = journal.entries;

let issues = [];
let fixed = false;

for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1];
    const curr = entries[i];
    if (curr.when <= prev.when) {
        issues.push({
            idx: curr.idx,
            tag: curr.tag,
            when: curr.when,
            prevIdx: prev.idx,
            prevTag: prev.tag,
            prevWhen: prev.when,
        });

        if (!checkOnly) {
            // Bump to 100ms after the previous entry
            const newWhen = prev.when + 100000;
            curr.when = newWhen;
            fixed = true;
        }
    }
}

if (issues.length === 0) {
    console.log('✓ Migration journal timestamps are in order (' + entries.length + ' entries)');
    process.exit(0);
}

console.log('');
for (const issue of issues) {
    console.log('  OUT OF ORDER: ' + issue.tag + ' (idx ' + issue.idx + ')');
    console.log('    timestamp ' + issue.when + ' <= previous ' + issue.prevTag + ' at ' + issue.prevWhen);
}
console.log('');

if (checkOnly) {
    console.log('✗ ' + issues.length + ' migration(s) with out-of-order timestamps');
    console.log('  Run without --check to auto-fix');
    process.exit(1);
} else {
    // Verify all timestamps are now in order after fixes
    for (let i = 1; i < entries.length; i++) {
        if (entries[i].when <= entries[i - 1].when) {
            entries[i].when = entries[i - 1].when + 100000;
        }
    }

    fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2) + '\n');
    console.log('✓ Fixed ' + issues.length + ' timestamp(s) in ' + journalPath);
    console.log('  Remember to commit the updated journal file');
}
"
