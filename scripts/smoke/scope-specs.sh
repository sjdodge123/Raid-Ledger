#!/usr/bin/env bash
# Map the branch diff to the Playwright smoke specs that cover it (CLAUDE.md
# "Scope it by the pages you touched", 2026-09-14). Prints one spec path per
# line, or the single word ALL when the diff touches a shared surface or a
# changed web file maps to nothing (then the full suite is the only safe answer),
# or the single word NONE when every changed web file is KNOWN to be covered by
# no spec (see below) — validate-ci.sh then SKIPS the Playwright tier rather
# than run `npx playwright test NONE`; E2E_SPECS / E2E_SCOPE=all override it.
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
#
# Route files (ROK-1792): a change to web/src/app-routes.tsx or lazy-routes.ts
# is read as a diff. Each added/changed `<Route path="...">` (and each changed
# lazy export, via the route that renders it) maps to the specs that visit that
# path; a `/dev/**` (DEMO_MODE wireframe) route maps to none. A removed or
# renamed route, a guard, a pathless layout route or any other code -> ALL.
# components/ui/**: a NEW file maps through the files that import it (none when
# nothing outside ui/ does yet); an edit to an existing primitive -> ALL.
# When every changed web file maps to zero specs the output is NONE.
# SCOPE_DIFF (dry run only) supplies the route-file diff text instead of git.
set -euo pipefail
BASE="${SCOPE_BASE:-origin/main}"
SPEC_DIR="scripts/smoke"
changed="${SCOPE_FILES:-$(git diff --name-only "$BASE...HEAD" 2>/dev/null || true)}"
[ -z "$changed" ] && { echo ALL; exit 0; }
shared='^(web/src/components/layout/|web/src/index\.css|web/src/App\.tsx|web/src/routes|playwright\.config|scripts/smoke/base\.ts|scripts/smoke/[^/]*helpers)'
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

ROUTES_FILE="web/src/app-routes.tsx"
LAZY_FILE="web/src/lazy-routes.ts"

# Unified diff for one file: the SCOPE_DIFF fixture (dry run) or the branch diff.
file_diff() {
  if [ -n "${SCOPE_DIFF+x}" ]; then
    printf '%s\n' "$SCOPE_DIFF" | awk -v f="$1" '
      /^diff --git / { on = (substr($0, length($0) - length(f) - 2) == " b/" f) }
      on'
  else
    git diff "$BASE...HEAD" -- "$1" 2>/dev/null || true
  fi
}

# Changed lines of an app-routes.tsx diff -> `+ <path>` / `- <path>` per
# <Route path="..."> line; ALL for a guard, a pathless (layout) route or any
# other code. Imports, identifier lists, comments and `</Route>` are inert.
classify_route_lines() {
  awk '
    /^(\+\+\+|---) / || !/^[-+]/ { next }
    {
      s = substr($0, 1, 1); b = substr($0, 2)
      if (b ~ /^[[:space:]]*$/ || b ~ /^[[:space:]]*(\/\/|\/\*|\*|\{\/\*)/) next
      if (b ~ /Guard/) { print "ALL"; exit }
      if (b ~ /^[[:space:]]*import[[:space:]]/ || b ~ /^[[:space:]]*\}[[:space:]]*from[[:space:]]/) next
      if (b ~ /^[[:space:]]*[A-Za-z0-9_]+([[:space:]]*,[[:space:]]*[A-Za-z0-9_]+)*,?[[:space:]]*$/) next
      if (b ~ /^[[:space:]]*<\/Route>[[:space:]]*$/) next
      if (b ~ /<Route[[:space:]>]/ && match(b, /path="[^"]*"/)) {
        print s " " substr(b, RSTART + 6, RLENGTH - 7); next
      }
      print "ALL"; exit
    }'
}

# Changed lines of a lazy-routes.ts diff -> `+ <Export>` / `- <Export>` per
# lazy export; ALL for anything else (lazyWithRetry itself, other code).
classify_lazy_lines() {
  awk '
    /^(\+\+\+|---) / || !/^[-+]/ { next }
    {
      s = substr($0, 1, 1); b = substr($0, 2)
      if (b ~ /^[[:space:]]*$/ || b ~ /^[[:space:]]*(\/\/|\/\*|\*)/) next
      if (b ~ /^[[:space:]]*\);[[:space:]]*$/) next
      if (b ~ /^export const [A-Za-z0-9_]+ = lazyWithRetry\(\(\) =>[[:space:]]*$/) {
        n = b; sub(/^export const /, "", n); sub(/ =.*/, "", n); print s " " n; next
      }
      if (b ~ /^[[:space:]]*import\(/ && match(b, /default: m\.[A-Za-z0-9_]+ \}\)\),?[[:space:]]*$/)) {
        n = substr(b, RSTART + 11); sub(/ .*/, "", n); print s " " n; next
      }
      print "ALL"; exit
    }'
}

# Absolute path(s) for the route(s) in app-routes.tsx whose line contains $1
# (a `path="..."` or `<Element ` needle): relative paths are joined to their
# enclosing <Route path> openers. Returns 1 when nothing resolves.
resolve_routes() {
  local out
  out=$(awk -v needle="$1" '
    { L[NR] = $0 }
    END {
      for (i = 1; i <= NR; i++) {
        if (!index(L[i], needle) || !match(L[i], /path="[^"]*"/)) continue
        full = substr(L[i], RSTART + 6, RLENGTH - 7); depth = 0
        for (j = i - 1; j > 0 && full !~ /^\//; j--) {
          if (L[j] ~ /<\/Route>/) { depth++; continue }
          if (L[j] !~ /<Route[[:space:]>]/ || L[j] ~ /\/>[[:space:]]*$/) continue
          if (depth > 0) { depth--; continue }
          if (match(L[j], /path="[^"]*"/)) full = substr(L[j], RSTART + 6, RLENGTH - 7) "/" full
        }
        if (full ~ /^\//) print full; else print "ALL"
      }
    }' "$ROUTES_FILE" 2>/dev/null || true)
  [ -n "$out" ] && ! echo "$out" | grep -qx ALL || return 1
  echo "$out"
}

# Specs whose quoted URL (goto, toHaveURL, ...) starts with route prefix $1.
specs_visiting() {
  grep -lE "[\"'\`}]$1([\"'\`/?#\$]|\$)" "$SPEC_DIR"/*.smoke.spec.ts 2>/dev/null || true
}

# Specs for one absolute route path. /dev/** is DEMO_MODE-only: no spec. The
# static prefix (up to the first :param or *) is tried, then its first segment.
# Returns 1 when the path is unmappable or nothing visits it.
specs_for_route() {
  local p="$1" prefix out
  case "$p" in /dev | /dev/*) return 0 ;; esac
  prefix=$(echo "$p" | awk -F/ '{ o = ""; for (i = 2; i <= NF; i++) { if ($i == "" || $i ~ /^[:*]/) break; o = o "/" $i } print o }')
  echo "$prefix" | grep -qE '^(/[A-Za-z0-9_-]+)+$' || return 1
  out=$(specs_visiting "$prefix")
  [ -z "$out" ] && out=$(specs_visiting "/$(echo "${prefix#/}" | cut -d/ -f1)")
  [ -n "$out" ] || return 1
  echo "$out"
}

# Absolute route paths a route-file diff touches. Returns 1 (-> ALL) on an
# empty or unclassifiable diff, or a route/export that was removed or renamed.
changed_route_paths() {
  local f="$1" d cls added removed x
  d=$(file_diff "$f")
  [ -n "$d" ] || return 1
  if [ "$f" = "$ROUTES_FILE" ]; then cls=$(echo "$d" | classify_route_lines)
  else cls=$(echo "$d" | classify_lazy_lines); fi
  echo "$cls" | grep -qx ALL && return 1
  added=$(echo "$cls" | sed -n 's/^+ //p')
  removed=$(echo "$cls" | sed -n 's/^- //p')
  for x in $removed; do echo "$added" | grep -qxF "$x" || return 1; done
  for x in $added; do
    if [ "$f" = "$ROUTES_FILE" ]; then
      case "$x" in /*) echo "$x" ;; *) resolve_routes "path=\"$x\"" || return 1 ;; esac
    else
      resolve_routes "<$x " || resolve_routes "<$x>" || return 1
    fi
  done
}

# Specs for a route-file change; returns 1 when any touched route is unmappable.
specs_for_route_file() {
  local paths p
  paths=$(changed_route_paths "$1") || return 1
  for p in $paths; do specs_for_route "$p" || return 1; done
}

# Specs for a components/ui file. An existing primitive is shared -> return 1.
# A new one maps through the non-ui, non-test files that import it.
specs_for_ui_file() {
  local f="$1" stem imp importers out
  git rev-parse --verify -q "$BASE" >/dev/null 2>&1 || return 1
  git cat-file -e "$BASE:$f" 2>/dev/null && return 1
  stem=$(basename "$f"); stem="${stem%.*}"
  importers=$(grep -rlE "/ui/$stem['\"]" web/src --include='*.ts' --include='*.tsx' 2>/dev/null \
    | grep -v '^web/src/components/ui/' | grep -vE '\.(test|spec)\.tsx?$' || true)
  for imp in $importers; do
    out=$(specs_for_file "$imp")
    [ -n "$out" ] || return 1
    echo "$out"
  done
}

# `result` collects EVERY spec we print, including ones listed directly in the
# diff. ROK-1565 (Codex P2): a spec-only diff must stay scoped to those specs,
# not escalate to ALL.
result=""
mapped_none=0
for f in $changed; do
  case "$f" in
    scripts/smoke/*.smoke.spec.ts) result="$result"$'\n'"$f"; continue ;;
    "$ROUTES_FILE" | "$LAZY_FILE" | web/src/components/ui/*)
      if [ "${f#web/src/components/ui/}" != "$f" ]; then
        specs=$(specs_for_ui_file "$f") || { echo ALL; exit 0; }
      else
        specs=$(specs_for_route_file "$f") || { echo ALL; exit 0; }
      fi
      if [ -n "$specs" ]; then result="$result"$'\n'"$specs"; else mapped_none=1; fi
      continue ;;
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
if [ -n "$result" ]; then echo "$result"
elif [ "$mapped_none" = 1 ]; then echo NONE
else echo ALL; fi
