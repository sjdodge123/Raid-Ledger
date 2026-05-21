#!/usr/bin/env bash
# ROK-1331 M1 — single source of truth for the validate-ci step-line regex.
# Sourced by task-start's background parser and by future readers (M2 task.ts
# documentation cross-references this file; the Zod schema lives in M2).
#
# The regex matches lines of the form:
#   <Name>: <PASS|FAIL|SKIPPED>
# with an optional ANSI color escape (validate-ci.sh prints
# "\033[0;32m<name>: PASS\033[0m"). Anchored — must consume the whole line.
#
# Capture groups (1-indexed; bash =~ stores in BASH_REMATCH):
#   [1] = opening ANSI escape (optional, may be empty)
#   [2] = name        e.g. "Build (all workspaces)"
#   [3] = status      one of PASS | FAIL | SKIPPED
#   [4] = closing ANSI escape (optional, may be empty)
#
# Heartbeat lines from M5b (e.g. "[heartbeat] elapsed=240s pid=...") do NOT
# match — they start with `[`, not `[A-Z]`, so they fall through. This is
# intentional: heartbeats and step-results share the same log stream but have
# disjoint shapes.
# Bash's =~ uses POSIX ERE — `\x1b` is NOT interpreted as a hex escape there
# (unlike Perl/Python). We build the pattern with an embedded literal ESC byte
# via $'\033' so the optional ANSI groups match real terminal output. The
# spec's documented pattern (`\x1b\[[0-9;]*m`) describes the byte sequence;
# this is its bash-=~-compatible realization.
_ESC=$'\033'
PATTERN_STEP_RESULT="^(${_ESC}\\[[0-9;]*m)?([A-Z][A-Za-z0-9 +()-]+): (PASS|FAIL|SKIPPED)(${_ESC}\\[[0-9;]*m)?$"
export PATTERN_STEP_RESULT
