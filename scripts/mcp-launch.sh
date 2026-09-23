#!/bin/sh
# mcp-launch.sh <server> [args...]
#
# Launches one of the repo's stdio MCP servers (tools/<server>/src/index.ts)
# for `.mcp.json`. Claude Code starts these from the SESSION's folder, so a
# bare `npx tsx tools/...` needs a working node_modules right there — and a
# freshly created worktree has none, while a half-finished `npm install` can
# leave one with an empty package dir. Either way the server died in <1s and
# the session silently lost every rl_* / env / discord tool (2026-09-19: three
# sessions in 24h).
#
# This launcher keeps the session's folder as the working directory — the
# fleet server derives its default `worktree_path` and RL_AGENT_ID from it —
# and only changes where the code and packages are LOADED from: this checkout
# when its install is usable, otherwise the main checkout's.
#
# It never runs `npm install` itself: that outlasts the MCP startup window,
# and an interrupted install is how the package dir got hollowed out.

server="$1"
if [ -z "$server" ]; then
  echo "[mcp-launch] usage: mcp-launch.sh <server> [args...]" >&2
  exit 2
fi
shift

here="$(pwd)"
# The first entry of `git worktree list` is always the main checkout.
main="$(git -C "$here" worktree list --porcelain 2>/dev/null | sed -n '1s/^worktree //p')"

# Checks the PACKAGE, not the folder: the failure this guards against was a
# node_modules that existed with an empty @modelcontextprotocol/sdk inside.
has_install() {
  [ -n "$1" ] &&
    [ -f "$1/node_modules/@modelcontextprotocol/sdk/package.json" ] &&
    [ -x "$1/node_modules/.bin/tsx" ] &&
    [ -f "$1/tools/$server/src/index.ts" ]
}

if has_install "$here"; then
  root="$here"
elif has_install "$main"; then
  root="$main"
  echo "[mcp-launch] $here has no usable install; running $main's copy of $server" >&2
else
  echo "[mcp-launch] no usable install for $server in $here${main:+ or $main}." >&2
  echo "[mcp-launch] fix: run 'npm install' in ${main:-the main checkout}, then restart the Claude session." >&2
  exit 1
fi

exec "$root/node_modules/.bin/tsx" "$root/tools/$server/src/index.ts" "$@"
