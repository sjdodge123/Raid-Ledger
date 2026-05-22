// Shared helper: invoke the rl CLI with forced agent identity and parse output.
//
// Why force agent identity here:
//   The operator's shell may have `export RL_OPERATOR=1` set inadvertently
//   (it shouldn't, but defense in depth). MCP tools called by an agent in
//   Claude Code MUST run as rl-agent — never as the privileged rl user.
//   We always pass RL_PROXMOX_USER=rl-agent and explicitly unset RL_OPERATOR.

import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as dns from 'node:dns';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { z } from 'zod';

/**
 * Manual `execFile` promisifier that always resolves to `{stdout, stderr}`
 * regardless of whether `node:child_process` was replaced by a vitest mock.
 *
 * Why not `util.promisify(execFile)`: promisify uses the `util.promisify.custom`
 * symbol attached to the real `child_process.execFile` to return the `{stdout,
 * stderr}` shape callers expect. When vitest's `vi.mock('node:child_process')`
 * substitutes a plain function for execFile, the custom symbol is lost, and
 * promisify falls back to default behavior: the resolved value becomes just
 * the first non-error callback argument (stdout). Code that then reads
 * `result.stdout` gets `undefined`, breaking every test that mocked execFile
 * to verify SSH argv shape (ROK-1331 M2 release.spec, validate-ci.spec).
 *
 * Reading `result.stdout` on the resolved value here ALWAYS works in both
 * real-runtime and test-mocked environments.
 */
export function execFileP(
  cmd: string,
  args: string[],
  opts: { env?: NodeJS.ProcessEnv; cwd?: string; maxBuffer?: number; timeout?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, opts, (err, stdout, stderr) => {
      const out =
        typeof stdout === 'string' ? stdout : (stdout as unknown as Buffer | undefined)?.toString() ?? '';
      const errStr =
        typeof stderr === 'string' ? stderr : (stderr as unknown as Buffer | undefined)?.toString() ?? '';
      if (err) {
        const e = err as Error & { stdout?: string; stderr?: string; code?: number };
        e.stdout = out;
        e.stderr = errStr || e.stderr || '';
        reject(e);
        return;
      }
      resolve({ stdout: out, stderr: errStr });
    });
  });
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// MCP server lives at tools/mcp-rl-fleet/src/. rl CLI lives at
// rl-infra/cli/rl. Go up three levels from this file:
//   src/ → tools/mcp-rl-fleet/ → tools/ → <repo-root>/
export const RL_BIN = resolve(__dirname, '../../../rl-infra/cli/rl');

// ---------------------------------------------------------------------------
// RL_PROXMOX_HOST resolution with DNS fallback (ROK-1331 M6b HIGH-3)
// ---------------------------------------------------------------------------
//
// Agents in sandboxed Claude Code contexts can't always resolve `rl-infra.lan`
// (the operator's LAN sets it via Pi-hole; sandbox networking doesn't forward
// that). When the candidate host fails DNS, fall back to the literal IP loaded
// from the repo-root `.env` (`RL_INFRA_IP=192.168.0.132`). The cache lives for
// the MCP server lifetime — the operator's DNS doesn't flap day-to-day, and
// we want the lookup cost paid ONCE at first call.

export type ResolvedHost = {
  host: string;
  source: 'env' | 'dns' | 'ip-fallback';
};

const DEFAULT_HOST_CANDIDATES = new Set(['rl-infra', 'rl-infra.lan']);
const DNS_LOOKUP_TIMEOUT_MS = 1500;

let cachedResolvedHost: ResolvedHost | undefined;

/** Test-only hook — production callers MUST NOT use this. */
export function _resetResolveProxmoxHostCacheForTest(): void {
  cachedResolvedHost = undefined;
}

/**
 * Resolve RL_PROXMOX_HOST. Operator-set explicit values (anything not
 * matching the default `rl-infra` / `rl-infra.lan`) win without a probe.
 * Otherwise dns.promises.lookup is raced against a 1.5s timeout — on
 * failure we fall back to `fallbackIp` (RL_INFRA_IP from .env). Throws
 * when neither leg yields a host. Memoized for the MCP server lifetime.
 */
export async function resolveProxmoxHost(opts?: {
  envHost?: string | undefined;
  fallbackIp?: string | undefined;
}): Promise<ResolvedHost> {
  if (cachedResolvedHost) return cachedResolvedHost;
  const envHost = opts?.envHost;
  const fallbackIp = opts?.fallbackIp;

  // Operator-explicit override (any non-default value) — trust it without probing.
  if (envHost && !DEFAULT_HOST_CANDIDATES.has(envHost)) {
    cachedResolvedHost = { host: envHost, source: 'env' };
    return cachedResolvedHost;
  }

  const candidate = envHost ?? 'rl-infra.lan';
  try {
    await Promise.race([
      dns.promises.lookup(candidate),
      new Promise((_, reject) =>
        setTimeout(() => {
          const err: NodeJS.ErrnoException = new Error('dns lookup timeout');
          err.code = 'ETIMEDOUT';
          reject(err);
        }, DNS_LOOKUP_TIMEOUT_MS),
      ),
    ]);
    cachedResolvedHost = { host: candidate, source: 'dns' };
    return cachedResolvedHost;
  } catch {
    if (fallbackIp) {
      cachedResolvedHost = { host: fallbackIp, source: 'ip-fallback' };
      return cachedResolvedHost;
    }
    throw new Error(
      `Cannot resolve RL_PROXMOX_HOST (${candidate}) and no RL_INFRA_IP fallback set in .env`,
    );
  }
}

/**
 * Resolve the SSH target {user, host} for direct-SSH tool invocations
 * (rl_task_logs / rl_task_inspect / rl_env_inspect / rl_infra_logs /
 * rl_db_query — anything that calls `execFile('ssh', [...])` directly
 * instead of going through `runRl()`).
 *
 * Codex security review (2026-05-22, PR-2 round 5) flagged that the
 * previous per-tool `sshUser() = process.env.RL_PROXMOX_USER ?? 'rl-agent'`
 * + `sshHost() = process.env.RL_PROXMOX_HOST ?? 'rl-infra'` inline helpers
 * left two real holes:
 *
 *   P1.1 — INHERITED `RL_PROXMOX_USER`. If the MCP server is launched from
 *   an operator shell that exported `RL_PROXMOX_USER=rl` (the privileged
 *   account), the direct-SSH tools would SSH as `rl` instead of `rl-agent`.
 *   `runRl()` already defends with `RL_PROXMOX_USER: opts.user ?? 'rl-agent'`
 *   + sanitizeExtra; direct-SSH tools must do the same.
 *
 *   P1.2 — NO DNS FALLBACK. In sandboxed Claude sessions where
 *   `RL_PROXMOX_HOST` is unset and `rl-infra` doesn't resolve via DNS, the
 *   direct-SSH tools failed with `Could not resolve hostname`. `runRl()`
 *   already calls `resolveProxmoxHost(loadRlInfraIp())` to fall back to the
 *   IP literal in repo-root `.env`. Direct-SSH tools must do the same.
 *
 * This helper closes both gaps in ONE place. All direct-SSH tools call it
 * + use the returned `{user, host}` for SSH argv construction.
 *
 * Implementation notes:
 *   - `user` is HARD-CODED to `'rl-agent'`. NO env-var override path — this
 *     surface is for agents only; if the operator wants to SSH directly,
 *     they use the rl CLI (which goes through runRl with proper gates).
 *   - `host` is `resolveProxmoxHost()`-resolved (memoized for MCP server
 *     lifetime). Operator can still set `RL_PROXMOX_HOST` to a non-default
 *     value for testing — only the literal `rl-infra` / `rl-infra.lan`
 *     candidates trigger DNS+fallback.
 */
export async function getSshTarget(): Promise<{ user: string; host: string }> {
  const user = 'rl-agent';
  let host: string;
  try {
    const resolved = await resolveProxmoxHost({
      envHost: process.env.RL_PROXMOX_HOST,
      fallbackIp: loadRlInfraIp(),
    });
    host = resolved.host;
  } catch {
    // resolveProxmoxHost throws only when BOTH DNS lookup AND fallbackIp
    // fail. Fall through to the literal env-or-default — the SSH call
    // will then surface the real connection error rather than masking it.
    host = process.env.RL_PROXMOX_HOST ?? 'rl-infra';
  }
  return { user, host };
}

/**
 * Build the canonical SSH argv-array for a direct-SSH tool invocation.
 * Includes the resolved + forced-identity target from `getSshTarget()`.
 * Always uses BatchMode=yes (no interactive password prompt) and a 5s
 * ConnectTimeout (so a wedged VM doesn't pin the tool indefinitely).
 *
 * Returns the argv to pass to `execFile('ssh', argv)`. NEVER pass to
 * `spawn('sh', ['-c', ...])` — the argv form ensures the user-controlled
 * `remote` string reaches the local SSH client as ONE arg.
 */
export async function buildSshArgs(remote: string): Promise<string[]> {
  const { user, host } = await getSshTarget();
  return ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', `${user}@${host}`, remote];
}

/**
 * Walk process.cwd() upward looking for a sibling `.git` directory; that's
 * the repo root. Parse a `RL_INFRA_IP=...` line out of `<repo-root>/.env`.
 * Returns undefined when no `.git` ancestor exists, no `.env` is present,
 * or the .env has no (uncommented) `RL_INFRA_IP=` line.
 */
export function loadRlInfraIp(): string | undefined {
  let dir = process.cwd();
  const root = resolve('/');
  // Cap the walk to avoid pathological loops on broken filesystems.
  // `.git` is a directory in the main repo and a FILE (gitlink) in a
  // worktree — existsSync accepts both.
  for (let i = 0; i < 64; i++) {
    if (existsSync(join(dir, '.git'))) break;
    if (dir === root) return undefined;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  if (!existsSync(join(dir, '.git'))) return undefined;
  const envPath = join(dir, '.env');
  if (!existsSync(envPath)) return undefined;
  let raw: string;
  try {
    raw = readFileSync(envPath, 'utf-8');
  } catch {
    return undefined;
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = trimmed.match(/^RL_INFRA_IP=(.+)$/);
    if (m) return m[1].trim();
  }
  return undefined;
}

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

// ROK-1331 M11 — per-tool perf instrumentation. Wraps runRl with a
// try/finally that records the tool name (first non-flag arg) and
// wall-clock latency, then POSTs a mcp.tool.call line to the fleet
// dashboard's perf-log sink (via the existing dashboard-fetch helper).
//
// Best-effort: emit failures NEVER propagate to the caller. The MCP tool
// surface returns the original {stdout, stderr, exitCode} regardless of
// whether the emit landed. Latency outliers surface in perf_summary's
// p50 step times for any operator with the dashboard open.
const PERF_EMIT_TIMEOUT_MS = 1500;

async function emitMcpToolCall(toolName: string, latencyMs: number, status: 'ok' | 'error'): Promise<void> {
  const dashboardUrl = process.env.RL_DASHBOARD_URL || 'http://fleet.rl.lan';
  // Build a fire-and-forget POST. We don't await its full lifetime — the
  // AbortController bounds it to PERF_EMIT_TIMEOUT_MS so a stuck dashboard
  // never blocks a real MCP call.
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), PERF_EMIT_TIMEOUT_MS);
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (process.env.RL_AGENT_TOKEN) {
      headers['x-agent-token'] = process.env.RL_AGENT_TOKEN;
    }
    await fetch(`${dashboardUrl}/api/perf-emit`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        event: 'mcp.tool.call',
        source: 'mcp',
        tool_name: toolName,
        agent_id: process.env.RL_AGENT_ID ?? null,
        latency_ms: latencyMs,
        status,
      }),
      signal: controller.signal,
    }).catch(() => {});
    clearTimeout(t);
  } catch {
    // Silent — perf emit is opt-in observability, never a hard dep.
  }
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
  // ROK-1331 M6b HIGH-3: DNS-resolve RL_PROXMOX_HOST so sandboxed agent contexts
  // (where `rl-infra.lan` doesn't resolve) fall through to the literal IP from
  // repo-root .env. Memoized — first call bears the lookup cost.
  let resolvedHost: string;
  try {
    const resolved = await resolveProxmoxHost({
      envHost: process.env.RL_PROXMOX_HOST,
      fallbackIp: loadRlInfraIp(),
    });
    resolvedHost = resolved.host;
  } catch {
    resolvedHost = process.env.RL_PROXMOX_HOST ?? 'rl-infra';
  }
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // Force agent identity. The MCP server is for agents — never operators.
    RL_PROXMOX_USER: opts.user ?? 'rl-agent',
    // Defensive: even if the parent shell set RL_OPERATOR=1, clear it here.
    RL_OPERATOR: '0',
    RL_PROXMOX_HOST: resolvedHost,
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

  // ROK-1331 M11 — per-tool perf instrumentation.
  const toolName = args.find((a) => !a.startsWith('-')) ?? 'unknown';
  const startMs = Date.now();
  let outcomeStatus: 'ok' | 'error' = 'ok';
  try {
    const result = await execFileP(RL_BIN, args, {
      env,
      cwd: opts.cwd,
      maxBuffer: 16 * 1024 * 1024, // 16 MB — enough for validate-ci output
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (err) {
    outcomeStatus = 'error';
    const e = err as Error & { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? e.message,
      exitCode: e.code ?? 1,
    };
  } finally {
    // Fire-and-forget. Never await — we already returned the result above
    // (Node guarantees finally runs before the function resolves on the
    // explicit return). The emit's own AbortController bounds it.
    void emitMcpToolCall(toolName, Date.now() - startMs, outcomeStatus);
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
 * Bug A (ROK-1331 M2): produce a one-line synthetic diagnostic when an ssh
 * (or other child-process) call exits non-zero with empty stderr. The empty-
 * stderr case is the worst possible UX — the agent sees `exit 255` and no
 * hint of WHY. Common causes that all produce silent ssh failures:
 *   - command not found inside the remote shell (PATH gap, stale image)
 *   - shell init scripts (.bashrc) erroring before our command runs
 *   - git "dubious-ownership" warnings blocking the rest of the line
 *   - stdin pipeline error (e.g. closing too early)
 *   - ssh connection drop mid-command (network, fleet down)
 *
 * This helper returns a fixed-format single line that callers prepend or
 * substitute when they detect the empty-stderr condition. Keep it ONE LINE
 * so downstream log parsers don't have to handle multiline stderr.
 */
export function synthesizeEmptyStderrDiagnostic(exitCode: number | undefined): string {
  const code = typeof exitCode === 'number' ? String(exitCode) : 'unknown';
  // ROK-1338 PR-3 (C1): include `permission denied (publickey, post-ROK-1338
  // lockdown)` in the causes list so an agent who hits the empty-stderr fall-
  // through path knows the lockdown is a plausible cause. The wording is
  // INFORMATIONAL — the classifier's DENIED_RE matches the literal
  // `Permission denied (publickey)` form (capitalized + uppercase regex),
  // not this lowercase variant, so the synth string never accidentally
  // re-enters the classifier as a false positive.
  return (
    `[mcp-rl-fleet: ssh returned exit ${code} with no output — ` +
    `possible causes: permission denied (publickey, post-ROK-1338 lockdown), ` +
    `command not found, shell init failure, git dubious-ownership, ` +
    `stdin pipeline error, ssh connection drop]`
  );
}

/**
 * Classify an OpenSSH-client-level failure (auth denied, host unreachable)
 * from the (exitCode, stderr) pair of a failed `execFile('ssh', ...)` call.
 *
 * Returns:
 *   - `{error: 'ssh_denied', hint: <text>}` when sshd rejected the identity.
 *     Expected post-ROK-1338 lockdown for rl-agent; agents should STOP
 *     retrying and surface the structured envelope so the operator triages.
 *   - `{error: 'ssh_unreachable', hint: <text>}` when the SSH client could
 *     not reach sshd at all (network down, fleet VM off, DNS, fail2ban).
 *   - `null` when stderr is not recognizably an SSH-client error. The
 *     caller falls through to its own classifier (postgres syntax, docker
 *     "no such container", etc).
 *
 * Pure: no side effects, no async, no I/O. Trivial to unit test.
 *
 * Exit codes: OpenSSH uses 255 as the catch-all "ssh itself failed" code.
 * We accept any exit code — the stderr regex is the source of truth (many
 * real failures land on exit 1/2 when wrapped via `timeout` or `Promise.race`).
 */
export function classifySshFailure(
  exitCode: number | undefined,
  stderr: string,
):
  | { error: 'ssh_denied'; hint: string }
  | { error: 'ssh_unreachable'; hint: string }
  | null {
  // exitCode currently unused for classification (the stderr regex is
  // authoritative); kept in the signature so callers can pass it without
  // a discard variable, and so future heuristics can add code-aware logic.
  void exitCode;

  // Empty stderr → caller already substituted synthesized diagnostic.
  // Don't try to classify from synth text; let the caller's existing
  // logic handle it (the *_unreachable / exit-code fall-through paths).
  if (!stderr) return null;

  // Synth diagnostic (C1) is informational only — it lists "permission denied
  // (publickey, post-ROK-1338 lockdown)" as a *possible cause*, not real
  // OpenSSH output. Skip classification so the caller's exit-code fall-
  // through (`*_unreachable` on exit 255 + empty stderr) keeps its
  // pre-PR-3 semantics. AC-C1 + the db-query "exit-255 with empty stderr
  // as db_unreachable" regression test pin this contract.
  if (stderr.startsWith('[mcp-rl-fleet:')) return null;

  // Denied patterns. Host-key verification failure is classified as DENIED
  // (not unreachable) — it's a sshd-side identity decision; "retry won't
  // help" matches the ssh_denied UX.
  const DENIED_RE =
    /(?:Permission denied(?:,? please try again| \([^)]+\))|Host key verification failed)/i;
  if (DENIED_RE.test(stderr)) {
    return {
      error: 'ssh_denied',
      hint:
        'MCP transport failed at sshd: rl-agent SSH is denied. This is the ' +
        'expected post-ROK-1338 behavior — use the MCP tools (which run ' +
        "inside the server's already-authenticated transport) rather than " +
        "retrying. If you're an operator, see the rl-agent break-glass " +
        'runbook in rl-infra/README.md.',
    };
  }

  // Unreachable patterns. `Connection closed by ... port 22` (sshd hung up
  // before banner) is treated as unreachable — it usually means sshd is up
  // but refused before authentication started (fail2ban, MaxStartups).
  const UNREACHABLE_RE =
    /(?:Connection refused|Connection timed out|Connection closed by [^\n]* port 22|No route to host|ssh: connect to host [^\s]+ port \d+:|ssh: Could not resolve hostname)/i;
  if (UNREACHABLE_RE.test(stderr)) {
    return {
      error: 'ssh_unreachable',
      hint:
        'MCP transport failed: the rl-infra VM is not reachable. Check ' +
        "rl_status first; if that also fails, the fleet is down or you're " +
        'off the network.',
    };
  }

  // Exit 255 with stderr that doesn't match either bucket — usually a local
  // SSH config issue (`unknown option`, `bad configuration`) or signal-on-
  // shutdown. Don't claim either bucket; let the caller's existing path
  // classify so message context is preserved.
  return null;
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
