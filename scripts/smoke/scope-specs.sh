#!/usr/bin/env bash
# Map the branch diff to the Playwright smoke specs that cover it (CLAUDE.md
# "Scope it by the pages you touched", 2026-09-14). Prints one spec path per
# line, or the single word ALL when the diff touches a shared surface or a
# changed file maps to nothing (then the full suite is the only safe answer).
#
#   npx playwright test $(scripts/smoke/scope-specs.sh)
#   SCOPE_FILES="web/src/pages/lfg/lfg-group-page.tsx" scripts/smoke/scope-specs.sh   # dry run
#
# Mapping: each changed web file contributes its basename tokens (kebab and
# PascalCase split on hyphens / case boundaries, minus generic words); a spec
# matches when its filename or its `page.goto(...)` routes share a token.
set -euo pipefail
BASE="${SCOPE_BASE:-origin/main}"
SPEC_DIR="scripts/smoke"
changed="${SCOPE_FILES:-$(git diff --name-only "$BASE...HEAD" 2>/dev/null || true)}"
[ -z "$changed" ] && { echo ALL; exit 0; }
shared='^(web/src/components/layout/|web/src/components/ui/|web/src/index\.css|web/src/App\.tsx|web/src/routes|playwright\.config|scripts/smoke/base\.ts|scripts/smoke/[^/]*helpers)'
if echo "$changed" | grep -qE "$shared"; then echo ALL; exit 0; fi
generic='^(page|pages|index|component|components|hooks?|use|utils?|helpers?|types?|lib|src|web|test|tests|spec|smoke|tsx?|ts|css|md|json|the|a|an|and|of|to)$'
tokens=""
# `found` counts EVERY spec we print, including the ones echoed directly from the
# diff below. ROK-1565 (Codex P2): a diff of nothing but *.smoke.spec.ts files
# left `tokens` empty, so the script printed those specs AND then `ALL` — and
# once validate-ci.sh learned to escalate on a trailing ALL, the one case
# scoping serves best (you edited exactly the specs you want to run) became a
# full-suite run.
found=0
for f in $changed; do
  case "$f" in
    scripts/smoke/*.smoke.spec.ts) echo "$f"; found=1; continue ;;
    web/src/*|api/src/*) ;;
    *) continue ;;
  esac
  base=$(basename "$f"); base="${base%%.*}"
  toks=$(echo "$base" | sed -E 's/([a-z0-9])([A-Z])/\1-\2/g' | tr 'A-Z' 'a-z' | tr '_.' '--' | tr '-' '\n' | grep -vE "$generic" || true)
  [ -z "$toks" ] && { echo ALL; exit 0; }
  tokens="$tokens $toks"
done
tokens=$(echo "$tokens" | tr ' ' '\n' | sort -u | grep -v '^$' || true)
# No tokens AND nothing printed = we mapped nothing at all -> ALL. No tokens but
# specs already printed = a spec-only diff, which is exactly scoped.
if [ -z "$tokens" ]; then
  [ "$found" -eq 1 ] || echo ALL
  exit 0
fi
for spec in "$SPEC_DIR"/*.smoke.spec.ts; do
  for t in $tokens; do
    if echo "$(basename "$spec")" | grep -q -- "$t" || grep -qE "goto\(['\"\`][^'\"\`]*$t" "$spec"; then echo "$spec"; found=1; break; fi
  done
done
[ "$found" -eq 1 ] || echo ALL
