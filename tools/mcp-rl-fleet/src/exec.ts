// Shared helper: invoke the rl CLI with forced agent identity and parse output.
//
// Why force agent identity here:
//   The operator's shell may have `export RL_OPERATOR=1` set inadvertently
//   (it shouldn't, but defense in depth). MCP tools called by an agent in
//   Claude Code MUST run as rl-agent — never as the privileged rl user.
//   We always pass RL_PROXMOX_USER=rl-agent and explicitly unset RL_OPERATOR.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

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
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // Force agent identity. The MCP server is for agents — never operators.
    RL_PROXMOX_USER: opts.user ?? 'rl-agent',
    // Defensive: even if the parent shell set RL_OPERATOR=1, clear it here.
    RL_OPERATOR: '0',
    // Sensible default if .zshrc didn't load. ssh config alias resolves.
    RL_PROXMOX_HOST: process.env.RL_PROXMOX_HOST ?? 'rl-infra',
    ...(opts.agentId ? { RL_AGENT_ID: opts.agentId } : {}),
    ...(opts.extra ?? {}),
  };

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
 */
export function deriveAgentId(worktreePath?: string): string {
  const user = process.env.USER ?? 'unknown';
  const explicit = process.env.RL_AGENT_ID;
  if (explicit) return explicit;
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
