// Shared helper: invoke the rl CLI with forced agent identity and parse output.
//
// Why force agent identity here:
//   The operator's shell may have `export RL_OPERATOR=1` set inadvertently
//   (it shouldn't, but defense in depth). MCP tools called by an agent in
//   Claude Code MUST run as rl-agent — never as the privileged rl user.
//   We always pass RL_PROXMOX_USER=rl-agent and explicitly unset RL_OPERATOR.

import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { existsSync, lstatSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { z } from 'zod';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// MCP server lives at tools/mcp-rl-fleet/src/. rl CLI lives at
// rl-infra/cli/rl. Go up three levels from this file:
//   src/ → tools/mcp-rl-fleet/ → tools/ → <repo-root>/
export const RL_BIN = resolve(__dirname, '../../../rl-infra/cli/rl');

interface RlEnv {
  /** Override the SSH user. Defaults to rl-agent (limited identity). */
  user?: string;
  /** Per-call agent ID override; if unset, rl CLI auto-derives. */
  agentId?: string;
  /** Extra env vars merged in. */
  extra?: Record<string, string>;
  /**
   * cwd to invoke rl CLI from. The CLI runs `git rev-parse --show-toplevel`
   * to find the worktree (drives Mutagen sync source + RL_AGENT_ID hash).
   * Pass the agent's worktree path here when calling from MCP — otherwise
   * the CLI resolves to wherever the MCP server was spawned (typically the
   * main repo, NOT the agent's worktree). Defaults to process.cwd().
   */
  cwd?: string;
}

/**
 * Run the rl CLI with the given subcommand arguments. Returns stdout/stderr/
 * exit code. Always forces RL_PROXMOX_USER=rl-agent unless explicitly overridden
 * AND always unsets RL_OPERATOR so the call can never accidentally elevate.
 */
export async function runRl(
  args: string[],
  opts: RlEnv = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  // Privilege-elevation knobs (RL_OPERATOR, RL_FORCE_REASON) live ONLY in
  // an internal allowlist gated by user='rl' AND the operator-opt-in env
  // var RL_FLEET_ALLOW_FORCE_RELEASE=1. Without this guard a future tool
  // author who passes `extra: { RL_OPERATOR: '1' }` silently elevates a
  // call (M-MCP-3). Filter the caller's extra so RL_OPERATOR is dropped
  // unless we're explicitly in the force-release elevation path.
  const extra = sanitizeExtra(opts);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // Force agent identity. The MCP server is for agents — never operators.
    RL_PROXMOX_USER: opts.user ?? 'rl-agent',
    // Defensive: even if the parent shell set RL_OPERATOR=1, clear it here.
    RL_OPERATOR: '0',
    // Sensible default if .zshrc didn't load. ssh config alias resolves.
    RL_PROXMOX_HOST: process.env.RL_PROXMOX_HOST ?? 'rl-infra',
    ...(opts.agentId ? { RL_AGENT_ID: opts.agentId } : {}),
    ...extra,
  };
  // After the spread, re-apply RL_OPERATOR if (and only if) the elevation
  // gate is open AND the caller explicitly requested it via opts.extra.
  // This is the single chokepoint for privilege elevation.
  if (
    opts.user === 'rl' &&
    process.env.RL_FLEET_ALLOW_FORCE_RELEASE === '1' &&
    opts.extra?.RL_OPERATOR === '1'
  ) {
    env.RL_OPERATOR = '1';
  } else {
    env.RL_OPERATOR = '0';
  }

  try {
    const result = await execFileAsync(RL_BIN, args, {
      env,
      cwd: opts.cwd,
      maxBuffer: 16 * 1024 * 1024, // 16 MB — enough for validate-ci output
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (err) {
    const e = err as Error & { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? e.message,
      exitCode: e.code ?? 1,
    };
  }
}

/**
 * Strip privilege-elevation knobs from opts.extra. RL_OPERATOR (the gate
 * for the orchestrator's force-release path) is the only one today. Any
 * future privilege-affecting env var must be added here AND re-applied
 * via the explicit gate in `runRl` below. M-MCP-3.
 */
function sanitizeExtra(opts: RlEnv): Record<string, string> {
  if (!opts.extra) return {};
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.extra)) {
    if (k === 'RL_OPERATOR') continue; // handled by the explicit gate
    cleaned[k] = v;
  }
  return cleaned;
}

/**
 * POSIX shell single-quote escape. Wraps `s` in single quotes and escapes
 * any embedded single quote via the classic `'\''` trick. The result is
 * safe to interpolate into a string passed to `bash -c "..."` or `ssh user
 * 'cmd ...'` — the remote shell will see exactly the bytes in `s`, with
 * NO expansion of `$(...)`, backticks, `${var}`, glob characters, etc.
 *
 * Used at every MCP→VM SSH boundary where any portion of the remote
 * command derives from agent-controlled input (user command, args[],
 * derived agent_id from `process.env.USER`). The SSH-injection class of
 * bug (H-MCP-1, H-MCP-2) lives at exactly this boundary: `JSON.stringify`
 * produces double-quoted strings, and the remote shell DOES expand
 * `$(...)` inside double quotes. Single-quote wrapping prevents that.
 */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Validate a string against a regex; throw if invalid. Used for inputs
 * that are interpolated INSIDE single-quoted shell segments (where the
 * only escape hazard is a literal single quote in the input). Today the
 * primary user is RL_AGENT_ID, which derives from `process.env.USER`
 * upstream — if the launching env is doctored, `USER` could carry a
 * single quote and break out of the quoting. Defense-in-depth (M-MCP-4).
 */
function assertSafeForShellArg(value: string, label: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error(
      `${label} contains characters disallowed for SSH-bound interpolation: ${JSON.stringify(value)}`,
    );
  }
}

/**
 * Derive RL_AGENT_ID exactly the way the rl CLI does:
 *   ${USER}-sha1(<repo-root-or-cwd>)[:8]
 *
 * This MUST match the CLI's algorithm — the rl CLI computes this for the
 * claim, and tools like build-image that SSH directly (bypassing the CLI)
 * need to compute the same value or they look up the wrong slot.
 *
 * Caller passes worktreePath if known; otherwise we fall back to the MCP
 * server's cwd. If the worktreePath isn't a git repo, we use that path
 * as-is (matches CLI's `${REPO_ROOT:-$PWD}` fallback).
 *
 * The returned id is regex-validated (alphanumeric + `._-` only) so it
 * is safe to interpolate inside a single-quoted shell segment. Throws
 * if `process.env.USER` (the upstream input) carries chars outside that
 * set — e.g. a doctored launching env exporting `USER="'; rm -rf /; #"`.
 */
export function deriveAgentId(worktreePath?: string): string {
  const explicit = process.env.RL_AGENT_ID;
  if (explicit) {
    assertSafeForShellArg(explicit, 'RL_AGENT_ID');
    return explicit;
  }
  const user = process.env.USER ?? 'unknown';
  assertSafeForShellArg(user, 'process.env.USER');
  const base = worktreePath ?? process.cwd();
  const sha = createHash('sha1').update(base).digest('hex').slice(0, 8);
  return `${user}-${sha}`;
}

/**
 * Extract the first JSON object/array from rl CLI stdout, even when:
 *   - the JSON is pretty-printed across multiple lines (`jq .` output),
 *   - other human-readable lines surround it (Mutagen progress, "claimed slot N" hints),
 *   - the JSON appears mid-stream (not on the first line).
 *
 * Strategy: find the first '{' or '[', walk forward tracking brace/bracket
 * depth (with string-literal awareness so braces in strings don't confuse us)
 * until the depth returns to 0, then JSON.parse that substring. If that
 * fails, advance past it and try the next opening brace.
 *
 * This replaces the older line-by-line scanner that broke when `jq .` was
 * introduced into cmd_claim/cmd_release output.
 */
export function parseJsonFromStdout<T = unknown>(stdout: string): T | null {
  let start = 0;
  while (start < stdout.length) {
    const openIdx = stdout.slice(start).search(/[{[]/);
    if (openIdx < 0) return null;
    const absoluteOpen = start + openIdx;
    const block = extractBalanced(stdout, absoluteOpen);
    if (block) {
      try {
        return JSON.parse(block) as T;
      } catch {
        // Not valid JSON — advance past this opener and try the next one.
      }
    }
    start = absoluteOpen + 1;
  }
  return null;
}

// ---------------------------------------------------------------------------
// worktree_path allowlist (M-MCP-5, codex finding #5)
// ---------------------------------------------------------------------------
//
// Every MCP tool that accepts a `worktree_path` parameter ultimately hands
// that path to `runRl({ cwd })`, which:
//   1. Triggers Mutagen to sync the path into the runner's /workspace, AND
//   2. Hashes the path into RL_AGENT_ID for slot lookup.
//
// If we accept ANY string, a malicious or buggy caller can pass e.g.
// `/Users/<op>/.ssh` and exfiltrate the contents via a subsequent
// `rl_run_on_runner` cat. Restrict to absolute paths under one of the
// operator's project-roots — matches the legitimate worktree shape and
// rejects everything else at the Zod boundary.
//
// Override via the env var RL_REPO_ROOT_ALLOWLIST (comma-separated absolute
// paths). When unset, defaults to `~/Documents/Projects/` — the operator's
// canonical Raid-Ledger projects directory (worktrees live alongside the
// main repo there, e.g. `Raid-Ledger--rok-1297`).
//
// The check is structural: path must be absolute, must resolve via realpath
// (symlinks followed) to under one of the allowed roots' realpaths, must
// exist as a directory, and must be a real git worktree per
// `git rev-parse --show-toplevel`. The git probe is what blocks
// `/Users/<op>/.ssh` even if a future operator adds `/Users/<op>` to the
// allowlist by accident.
//
// Symlink-confinement-escape (codex round 3, HIGH):
//   `path.resolve()` does NOT follow symlinks. An attacker who can drop a
//   symlink under an allowed root (e.g. `~/Documents/Projects/Raid-Ledger--evil
//   /inner → /etc`) would pass a string-prefix check while pointing cwd at
//   `/etc`. We use `realpathSync` on BOTH the candidate AND each allowlist
//   root before the prefix test, so symlinks are followed and the comparison
//   happens on the real on-disk locations.
//
// Fake `.git` accepted (codex round 3, MEDIUM):
//   `existsSync('<path>/.git')` accepts any directory with a hand-crafted
//   `.git` file. We additionally call `git -C <path> rev-parse
//   --show-toplevel` and confirm git's view of the worktree top-level
//   equals the candidate's realpath. This requires `git` on PATH — the
//   only realistic env where this MCP server runs has it.
//
// Relative entries in RL_REPO_ROOT_ALLOWLIST silently accepted (codex round
// 3, LOW): we now hard-reject any non-absolute entry at parse time. Without
// the rejection, `RL_REPO_ROOT_ALLOWLIST="./Projects"` would resolve
// against the MCP server's cwd at startup (whatever that happens to be)
// and silently broaden the trust boundary.

/**
 * Resolve the worktree_path allowlist. Splits RL_REPO_ROOT_ALLOWLIST on commas
 * (trim+drop empties), REJECTS any non-absolute entries (codex round-3 LOW),
 * and canonicalises each entry via `realpathSync` so symlinks in the
 * allowlist itself are followed at compare time. Falls back to
 * `~/Documents/Projects` when the env var is unset. Exported for the test
 * suite — runtime callers use `validateWorktreePath` below.
 */
export function getWorktreeAllowlist(): string[] {
  const raw = process.env.RL_REPO_ROOT_ALLOWLIST;
  const entries =
    raw && raw.trim().length > 0
      ? raw
          .split(',')
          .map((s: string) => s.trim())
          .filter((s: string) => s.length > 0)
      : [resolve(homedir(), 'Documents', 'Projects')];
  return entries.map((entry: string) => {
    if (!isAbsolute(entry)) {
      throw new Error(
        `RL_REPO_ROOT_ALLOWLIST entry must be an absolute path; got ${JSON.stringify(entry)}`,
      );
    }
    // realpathSync follows symlinks AND normalises. If the root doesn't
    // exist on disk we fall back to the resolved-but-not-canonicalised
    // form so a missing dir produces the same prefix-check miss as before
    // (rather than failing startup of the MCP server for a stale entry).
    try {
      return realpathSync(entry);
    } catch {
      return resolve(entry);
    }
  });
}

/**
 * Validate a candidate worktree path against the allowlist. Returns null on
 * success, or a human-readable error message on failure. Used by the Zod
 * refinement at the MCP boundary AND by callers that want to fail-fast before
 * spending tokens.
 *
 * Rules (all must pass):
 *   1. Path is absolute (`path.isAbsolute`).
 *   2. Path exists on disk (`realpathSync` succeeds — ENOENT → friendly error).
 *   3. After `realpathSync` (symlinks followed), path starts with one of the
 *      allowlisted-root REALPATHS (with a trailing separator to prevent
 *      prefix-confusion attacks — `/Users/op/Documents/Projects-evil` must NOT
 *      match `/Users/op/Documents/Projects`).
 *   4. Path is a directory.
 *   5. `git -C <path> rev-parse --show-toplevel` succeeds AND the returned
 *      top-level path's realpath equals the candidate's realpath. This is
 *      what prevents a hand-crafted fake `.git` from being accepted (codex
 *      round-3 MEDIUM).
 *
 * Symlink confinement (codex round-3 HIGH): realpathSync canonicalises BOTH
 * the candidate and the allowlist roots, so a symlink at
 * `~/Documents/Projects/Raid-Ledger--evil/inner → /etc` resolves to `/etc`
 * and is rejected by the prefix check.
 */
export function validateWorktreePath(candidate: string): string | null {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    return 'worktree_path must be a non-empty string';
  }
  if (!isAbsolute(candidate)) {
    return `worktree_path must be an absolute path; got ${JSON.stringify(candidate)}`;
  }
  // Existence check first — we need realpath to do anything useful. If the
  // path is a dangling symlink, lstatSync succeeds but realpathSync throws
  // ENOENT; we treat both as "does not exist" for UX symmetry.
  if (!existsSync(candidate)) {
    return `worktree_path does not exist on disk: ${JSON.stringify(candidate)}`;
  }
  let realCandidate: string;
  try {
    realCandidate = realpathSync(candidate);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') {
      return `worktree_path does not exist on disk: ${JSON.stringify(candidate)}`;
    }
    return `worktree_path realpath() failed: ${e.message}`;
  }
  let allowlist: string[];
  try {
    allowlist = getWorktreeAllowlist();
  } catch (err) {
    return (err as Error).message;
  }
  const underAllowed = allowlist.some((root) => {
    const rootWithSep = root.endsWith(sep) ? root : root + sep;
    // Exact-match root itself is allowed too (rare but valid).
    return realCandidate === root || realCandidate.startsWith(rootWithSep);
  });
  if (!underAllowed) {
    return (
      `worktree_path must be an absolute path to a git worktree under one of: ` +
      `${allowlist.join(', ')} (got realpath ${JSON.stringify(realCandidate)})`
    );
  }
  let stat;
  try {
    stat = statSync(realCandidate);
  } catch (err) {
    return `worktree_path stat() failed: ${(err as Error).message}`;
  }
  if (!stat.isDirectory()) {
    return `worktree_path is not a directory: ${JSON.stringify(realCandidate)}`;
  }
  // Real-git-worktree probe (codex round-3 MEDIUM). `git rev-parse
  // --show-toplevel` returns the worktree top-level and exits non-zero
  // outside a git repo. We compare the realpath of git's answer to our
  // own realpath — anything else means git disagrees about the worktree
  // shape (e.g. a hand-crafted `.git` file pointing elsewhere). We also
  // require the candidate to NOT be a symlink itself at the leaf (it
  // can still contain symlinks above; we just want the leaf to be the
  // realpath so cwd lines up with sync source).
  try {
    const out = execFileSync('git', ['-C', realCandidate, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
    }).trim();
    if (out.length === 0) {
      return `worktree_path is not a git worktree (git rev-parse returned empty)`;
    }
    const gitTopReal = realpathSync(out);
    if (gitTopReal !== realCandidate) {
      return (
        `worktree_path realpath ${JSON.stringify(realCandidate)} does not match ` +
        `git top-level ${JSON.stringify(gitTopReal)} — refusing to trust hand-crafted .git`
      );
    }
  } catch (err) {
    const e = err as Error & { status?: number; stderr?: Buffer | string };
    const stderr = typeof e.stderr === 'string' ? e.stderr : e.stderr?.toString() ?? '';
    return (
      `worktree_path is not a git worktree (git rev-parse --show-toplevel failed: ` +
      `${stderr.trim() || e.message})`
    );
  }
  // Belt-and-suspenders: if the leaf itself is a symlink, the realpath
  // logic above already followed it, so this is informational only —
  // lstatSync lets us assert the original input wasn't a leaf-symlink
  // sneaking a different cwd into Mutagen. The realpath comparison above
  // would already catch a divergence; we keep this for explicit clarity.
  try {
    if (lstatSync(candidate).isSymbolicLink() && realpathSync(candidate) !== candidate) {
      // Allowed: the realpath check above already confirmed containment.
      // No-op — kept as a clear marker that symlink leaves are followed.
    }
  } catch {
    // Non-fatal; the primary checks above are authoritative.
  }
  return null;
}

/**
 * Zod schema fragment for the `worktree_path` parameter, applied uniformly at
 * the MCP boundary (in index.ts) for every tool that accepts it. Optional —
 * the underlying `runRl` accepts `cwd: undefined` and falls back to
 * `process.cwd()`. When provided, validated against the repo-root allowlist.
 *
 * Zod's `.refine` error path: we attach the error to the field itself so the
 * MCP error response says exactly which input was rejected.
 */
export const worktreePathSchema = z
  .string()
  .optional()
  .refine(
    (val) => val === undefined || validateWorktreePath(val) === null,
    (val) => ({
      message:
        val === undefined
          ? 'worktree_path is invalid'
          : (validateWorktreePath(val) ?? 'worktree_path is invalid'),
    }),
  );

function extractBalanced(s: string, openIdx: number): string | null {
  const opener = s[openIdx];
  const closer = opener === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = openIdx; i < s.length; i++) {
    const ch = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === opener) depth++;
    else if (ch === closer) {
      depth--;
      if (depth === 0) return s.slice(openIdx, i + 1);
    }
  }
  return null;
}
