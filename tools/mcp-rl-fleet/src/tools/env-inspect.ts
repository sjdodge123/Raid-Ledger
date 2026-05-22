// ROK-1338 PR-2 — rl_env_inspect: render nginx-conf / supervisor-conf from
// a fleet env's allinone container without needing SSH.
//
// Companion to rl_infra_logs (which renders docker logs for the infra stack
// services). This tool answers "what is THIS env actually serving / running?"
// by cat'ing two operator-locked config-file paths inside the per-env
// rl-env-<slug>-allinone container, routed through the rl-docker-proxy at
// loopback 2375 (rl-agent is not in the host docker group).
//
// No `worktree_path` parameter — read-only inspection only, no Mutagen sync
// or RL_AGENT_ID hashing required. Mirrors the rl_infra_logs / rl_task_inspect
// intentional omission.

import { z } from 'zod';
import { execFileP, synthesizeEmptyStderrDiagnostic } from '../exec.js';

export const TOOL_NAME = 'rl_env_inspect';
export const TOOL_DESCRIPTION =
  'Render the actual on-disk content of a config file inside a fleet env`s allinone container (nginx-conf or supervisor-conf). Use to confirm what nginx is REALLY serving for a slug, or what supervisor is REALLY running, without needing SSH. `what` is a strict 2-value enum; output is capped at 64KB with truncated:true on overflow.';

// Operator-locked enum. ANY change here must come with operator approval
// AND a Dockerfile.allinone path-mapping audit — these are the literal
// paths the allinone image installs the configs to.
export const ENV_INSPECT_TARGETS = ['nginx-conf', 'supervisor-conf'] as const;

export const EnvInspectTargetSchema = z.enum(ENV_INSPECT_TARGETS);
export type EnvInspectTarget = z.infer<typeof EnvInspectTargetSchema>;

// Path mapping — values confirmed against Dockerfile.allinone:
//   nginx-conf       → /etc/nginx/http.d/default.conf
//                      (Dockerfile.allinone lines 139, 544 — alpine nginx
//                      uses http.d/ not conf.d/; the conf is rendered from a
//                      template at boot via `envsubst < default.conf.template`)
//   supervisor-conf  → /etc/supervisor.d/raid-ledger.ini
//                      (Dockerfile.allinone lines 205, 547 — supervisord -c
//                      points at this exact ini, INCLUDING the heredoc that
//                      defines [program:nginx], [program:api], etc.)
export const TARGET_TO_PATH: Record<EnvInspectTarget, string> = {
  'nginx-conf': '/etc/nginx/http.d/default.conf',
  'supervisor-conf': '/etc/supervisor.d/raid-ledger.ini',
};

// Slug regex matches index.ts's slugSchema — kebab-case, lowercase, 1-63 chars.
// This is the ONLY gate on shell-safe interpolation into the container name;
// `shellQuote` is intentionally NOT used because the regex bans every shell
// metachar already and the surrounding `docker exec <name>` arg form has no
// quotes for it to break out of.
const SLUG_RE = /^[a-z0-9-]+$/;

export const EnvInspectParamsSchema = z.object({
  slug: z.string().min(1).max(63).regex(SLUG_RE),
  what: EnvInspectTargetSchema,
});

export type EnvInspectParams = z.infer<typeof EnvInspectParamsSchema>;

export interface EnvInspectResult {
  ok: boolean;
  slug?: string;
  what?: EnvInspectTarget;
  container?: string;
  path?: string;
  content?: string;
  truncated?: boolean;
  bytes?: number;
  error?: string;
  message?: string;
}

const sshUser = () => process.env.RL_PROXMOX_USER ?? 'rl-agent';
const sshHost = () => process.env.RL_PROXMOX_HOST ?? 'rl-infra';

const MAX_BUFFER = 64 * 1024;

/**
 * Execute rl_env_inspect: SSH to the rl-infra VM, route a docker exec cat
 * through rl-docker-proxy (loopback 2375), and return the file contents
 * capped at 64KB. Structured error codes: `env_not_found` (no container),
 * `config_file_not_found` (cat: no such file), `env_inspect_failed` (any
 * other SSH/docker failure).
 */
export async function execute(params: EnvInspectParams): Promise<EnvInspectResult> {
  // Defense-in-depth: re-validate at the executor boundary even though the
  // MCP server's Zod layer already guards. Executors don't trust callers.
  const validated = EnvInspectParamsSchema.safeParse(params);
  if (!validated.success) {
    return {
      ok: false,
      error: 'invalid_params',
      message: validated.error.message,
    };
  }
  const { slug, what } = validated.data;
  const container = `rl-env-${slug}-allinone`;
  const path = TARGET_TO_PATH[what];
  // Both slug and path are now known-safe: slug is regex-checked
  // [a-z0-9-]+ (no shell metachars) and path comes from the static
  // TARGET_TO_PATH table. Direct interpolation is safe. SSH still uses
  // execFile argv-array — never `bash -c`.
  //
  // 2>&1 redirect mirrors rl_infra_logs codex-P2 reasoning: docker exec's
  // own error text ("Error response from daemon: No such container...")
  // arrives on stderr, but with 2>&1 it merges into stdout so the executor
  // gets a unified stream to classify regardless of which side cat or
  // docker emitted on. The catch-block reads both streams anyway.
  const remote = `DOCKER_HOST=tcp://127.0.0.1:2375 docker exec ${container} cat ${path} 2>&1`;
  const args = [
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=5',
    `${sshUser()}@${sshHost()}`,
    remote,
  ];
  try {
    const { stdout, stderr } = await execFileP('ssh', args, {
      maxBuffer: MAX_BUFFER,
      timeout: 30_000,
    });
    const content = stdout + stderr;
    return {
      ok: true,
      slug,
      what,
      container,
      path,
      content,
      bytes: content.length,
      truncated: false,
    };
  } catch (err) {
    return classifyError(err, { slug, what, container, path });
  }
}

interface ErrCtx {
  slug: string;
  what: EnvInspectTarget;
  container: string;
  path: string;
}

/**
 * Map the raw execFile rejection into a structured EnvInspectResult.
 * Splits the maxBuffer-overflow happy path (truncated:true) from the
 * three classified failure codes (env_not_found, config_file_not_found,
 * env_inspect_failed).
 */
function classifyError(err: unknown, ctx: ErrCtx): EnvInspectResult {
  const e = err as Error & {
    stdout?: string;
    stderr?: string;
    code?: number | string;
  };
  // ERR_CHILD_PROCESS_STDIO_MAXBUFFER → return partial bytes + truncated:true.
  // Mirrors rl_infra_logs runaway-output handling.
  if (
    e.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ||
    /maxBuffer/i.test(e.message)
  ) {
    const captured = (e.stdout ?? '') + (e.stderr ?? '');
    return {
      ok: true,
      slug: ctx.slug,
      what: ctx.what,
      container: ctx.container,
      path: ctx.path,
      content: captured,
      bytes: captured.length,
      truncated: true,
    };
  }
  // With `2>&1` on the remote side, docker / cat error text lands on stdout.
  // Read BOTH streams so classification stays specific (mirrors infra-logs
  // codex-P2 fix). Empty-everything → synthesize a diagnostic so the agent
  // gets actionable info instead of "exit 255" with no body.
  const captured = ((e.stdout ?? '') + '\n' + (e.stderr ?? '')).trim();
  const stderr =
    captured === ''
      ? synthesizeEmptyStderrDiagnostic(typeof e.code === 'number' ? e.code : undefined)
      : captured;
  if (/No such container/i.test(stderr)) {
    return {
      ok: false,
      slug: ctx.slug,
      what: ctx.what,
      container: ctx.container,
      error: 'env_not_found',
      message: stderr,
    };
  }
  if (/No such file/i.test(stderr)) {
    return {
      ok: false,
      slug: ctx.slug,
      what: ctx.what,
      container: ctx.container,
      path: ctx.path,
      error: 'config_file_not_found',
      message: stderr,
    };
  }
  return {
    ok: false,
    slug: ctx.slug,
    what: ctx.what,
    container: ctx.container,
    error: 'env_inspect_failed',
    message: stderr,
  };
}
