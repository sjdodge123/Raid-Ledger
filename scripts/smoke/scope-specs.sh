#!/usr/bin/env bash
# Map the branch diff to the Playwright smoke specs that cover it (CLAUDE.md
# "Scope it by the pages you touched", 2026-09-14). Prints one spec path per
# line, or the single word ALL when the diff touches a shared surface or a
# changed web file maps to nothing (then the full suite is the only safe answer).
#
#   npx playwright test $(scripts/smoke/scope-specs.sh)
#   SCOPE_FILES="web/src/pages/lfg/lfg-group-page.tsx" scripts/smoke/scope-specs.sh   # dry run
#
# Mapping (ROK-1603): a changed file's DIRECTORY segments are tried first,
# nearest folder first (`pages/lfg/`, `components/scheduling/`,
# `features/game-time/` name the surface even when the file is `utils.ts`);
# the basename's kebab / PascalCase tokens are the fallback. Generic role
# words (index, utils, helpers, types, constants, ...) are never tokens: they
# match many specs or none. A spec matches a token when its filename or one of
# its `page.goto(...)` routes contains it. Tests: scripts/scope-specs.spec.mjs.
set -euo pipefail
BASE="${SCOPE_BASE:-origin/main}"
SPEC_DIR="scripts/smoke"
changed="${SCOPE_FILES:-$(git diff --name-only "$BASE...HEAD" 2>/dev/null || true)}"
[ -z "$changed" ] && { echo ALL; exit 0; }
shared='^(web/src/components/layout/|web/src/components/ui/|web/src/index\.css|web/src/App\.tsx|web/src/routes|playwright\.config|scripts/smoke/base\.ts|scripts/smoke/[^/]*helpers)'
if echo "$changed" | grep -qE "$shared"; then echo ALL; exit 0; fi
generic='^(page|pages|index|component|components|features?|shared|common|hooks?|use|utils?|helpers?|types?|constants?|config|lib|src|web|api|app|test|tests|spec|smoke|stores?|context|dev|tsx?|ts|css|md|json|the|a|an|and|of|to)$'
# A usable token: lowercase kebab only (also keeps regex metacharacters out).
valid='^[a-z0-9]+(-[a-z0-9]+)*$'

# kebab-case a name: PascalCase -> pascal-case, `_` and `.` -> `-`.
kebab() { echo "$1" | sed -E 's/([a-z0-9])([A-Z])/\1-\2/g' | tr 'A-Z_.' 'a-z--'; }

# 0 when $1 is worth matching on (valid shape, not a generic role word).
is_token() { echo "$1" | grep -qE "$valid" && ! echo "$1" | grep -qE "$generic"; }

# Specs whose filename or a page.goto route contains token $1.
specs_for_token() {
  local t="$1" spec
  for spec in "$SPEC_DIR"/*.smoke.spec.ts; do
    case "${spec##*/}" in *"$t"*) echo "$spec" ;; esac
  done
  grep -lE "goto\(['\"\`][^'\"\`]*$t" "$SPEC_DIR"/*.smoke.spec.ts 2>/dev/null || true
}

# Specs for one changed file: nearest directory segment that maps wins; else
# the union over the basename's tokens. Prints nothing when unmappable.
specs_for_file() {
  local f="$1" seg tok out base
  for seg in $(dirname "$f" | tr '/' '\n' | awk '{a[NR]=$0} END {for (i = NR; i > 0; i--) print a[i]}'); do
    tok=$(kebab "$seg")
    is_token "$tok" || continue
    out=$(specs_for_token "$tok")
    [ -n "$out" ] && { echo "$out"; return 0; }
  done
  base=$(basename "$f"); base="${base%%.*}"
  for tok in $(kebab "$base" | tr '-' '\n'); do
    is_token "$tok" && specs_for_token "$tok"
  done
  return 0
}

# `result` collects EVERY spec we print, including ones listed directly in the
# diff. ROK-1565 (Codex P2): a spec-only diff must stay scoped to those specs,
# not escalate to ALL.
result=""
for f in $changed; do
  case "$f" in
    scripts/smoke/*.smoke.spec.ts) result="$result"$'\n'"$f"; continue ;;
    web/src/*|api/src/*) ;;
    *) continue ;;
  esac
  specs=$(specs_for_file "$f")
  if [ -z "$specs" ]; then
    # A web file nothing covers -> we cannot scope. api files are best-effort:
    # the Playwright tier is keyed to web surfaces.
    case "$f" in web/src/*) echo ALL; exit 0 ;; esac
    continue
  fi
  result="$result"$'\n'"$specs"
done
result=$(echo "$result" | grep -v '^$' | sort -u || true)
if [ -n "$result" ]; then echo "$result"; else echo ALL; fi
