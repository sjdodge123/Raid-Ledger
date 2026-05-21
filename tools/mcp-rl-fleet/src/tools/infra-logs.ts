// ROK-1338 PR-1 — rl_infra_logs: read-only `docker logs` for infra services.
//
// Surfaces gc-sweeper / dashboard / traefik / loki / registry / promtail /
// docker-proxy logs without needing SSH access or docker-socket-proxy POST.
// Strict service enum + tail cap. SSH via execFile argv-array.

import { execFile } from 'node:child_process';
import { z } from 'zod';
import { synthesizeEmptyStderrDiagnostic } from '../exec.js';

export const TOOL_NAME = 'rl_infra_logs';
export const TOOL_DESCRIPTION =
  'Read-only docker logs for an infra service on the rl-infra VM. Use this to diagnose fleet-side issues (gc-sweeper claim reaps, dashboard 5xx, traefik routing, loki ingest, registry pulls, promtail scrape, docker-proxy denials) without needing SSH. service is a strict enum; tail defaults to 100, max 5000.';

// Operator-locked enum + container-name mapping. ANY change here must match
// what's actually running on the VM — these are the literal `docker ps`
// names of the rl-infra stack containers.
export const INFRA_SERVICE_VALUES = [
  'gc-sweeper',
  'dashboard',
  'traefik',
  'loki',
  'registry',
  'promtail',
  'docker-proxy',
] as const;

export const InfraServiceSchema = z.enum(INFRA_SERVICE_VALUES);
export type InfraService = z.infer<typeof InfraServiceSchema>;

export const SERVICE_TO_CONTAINER: Record<InfraService, string> = {
  'gc-sweeper': 'rl-gc-sweeper',
  dashboard: 'rl-dashboard',
  traefik: 'rl-traefik',
  loki: 'rl-loki',
  registry: 'rl-registry',
  promtail: 'rl-promtail',
  'docker-proxy': 'rl-docker-proxy',
};

const TAIL_MAX = 5000;
const TAIL_DEFAULT = 100;

export const InfraLogsParamsSchema = z.object({
  service: InfraServiceSchema,
  tail: z.number().int().positive().max(TAIL_MAX).optional(),
});

export type InfraLogsParams = z.infer<typeof InfraLogsParamsSchema>;

export interface InfraLogsResult {
  ok: boolean;
  service?: InfraService;
  container?: string;
  lines?: string[];
  truncated?: boolean;
  error?: string;
  message?: string;
}

const sshUser = () => process.env.RL_PROXMOX_USER ?? 'rl-agent';
const sshHost = () => process.env.RL_PROXMOX_HOST ?? 'rl-infra';

function execFileP(
  cmd: string,
  args: string[],
  opts: { timeout?: number; maxBuffer?: number } = {},
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

export async function execute(params: InfraLogsParams): Promise<InfraLogsResult> {
  // Defense-in-depth: re-validate at the executor boundary. Zod at the MCP
  // layer already guards, but executors don't trust that.
  const validated = InfraLogsParamsSchema.safeParse(params);
  if (!validated.success) {
    return {
      ok: false,
      error: 'invalid_params',
      message: validated.error.message,
    };
  }
  const { service } = validated.data;
  const tail = validated.data.tail ?? TAIL_DEFAULT;
  // Both `service` and `tail` are now known-safe: service is an enum value
  // and tail is a Zod-checked positive int <= 5000. Direct interpolation is
  // safe (no string input from the caller reaches the shell unchecked), but
  // we still pass via execFile argv-array — never `bash -c`.
  const container = SERVICE_TO_CONTAINER[service];
  // ROK-1338 PR-1 dogfood-1: route docker calls through the rl-docker-proxy
  // (wollomatic socket-proxy) at 127.0.0.1:2375 instead of the host's unix
  // socket. The proxy whitelists GET /containers/[id]/logs, so this is the
  // intended read path. rl-agent is NOT in the host's docker group; talking
  // directly to /var/run/docker.sock returns permission-denied. The proxy
  // listens only on loopback so security posture is preserved.
  //
  // codex P2 (2026-05-21): redirect stderr to stdout (2>&1) on the remote
  // side. docker logs streams the container's stdout + stderr as two
  // separate streams; preserving temporal ordering requires merging them
  // upstream rather than locally (where we'd be left concatenating two
  // already-buffered streams in the wrong order). `--timestamps` keeps each
  // line individually datable if a consumer needs to re-sort.
  const remote = `DOCKER_HOST=tcp://127.0.0.1:2375 docker logs --tail ${tail} --timestamps ${container} 2>&1`;
  const args = [
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=5',
    `${sshUser()}@${sshHost()}`,
    remote,
  ];
  // 64KB buffer cap per spec — protects against runaway container output
  // even when tail is small (each "line" can be megabytes for badly-behaved
  // services).
  const MAX_BUFFER = 64 * 1024;
  try {
    const { stdout, stderr } = await execFileP('ssh', args, {
      maxBuffer: MAX_BUFFER,
      timeout: 30_000,
    });
    // docker logs emits stdout AND stderr from the container, both arriving
    // on our local stdout/stderr respectively. Merge so callers see the full
    // operational picture (gc-sweeper writes status to stderr).
    const merged = [stdout, stderr].filter((s) => s.length > 0).join('');
    const lines = merged.split('\n').filter((l) => l.length > 0);
    return {
      ok: true,
      service,
      container,
      lines,
      truncated: false,
    };
  } catch (err) {
    const e = err as Error & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };
    // ERR_CHILD_PROCESS_STDIO_MAXBUFFER → return the partial bytes we DID get,
    // mark truncated:true. This is the "runaway container" path.
    if (
      e.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ||
      /maxBuffer/i.test(e.message)
    ) {
      const captured = (e.stdout ?? '') + (e.stderr ?? '');
      const lines = captured.split('\n').filter((l) => l.length > 0);
      return {
        ok: true,
        service,
        container,
        lines,
        truncated: true,
      };
    }
    // ROK-1338 PR-1 codex P2 (2026-05-21): with the remote command using
    // `2>&1`, docker's own error text (e.g. "Error: No such container") now
    // arrives via stdout, not stderr. Read from BOTH streams when classifying
    // the failure so the structured error keeps its specificity. Without
    // this, "container not found" would silently degrade to the generic
    // infra_logs_failed bucket and lose actionable info for the caller.
    const captured = ((e.stdout ?? '') + '\n' + (e.stderr ?? '')).trim();
    const stderr =
      captured === ''
        ? synthesizeEmptyStderrDiagnostic(typeof e.code === 'number' ? e.code : undefined)
        : captured;
    // Common case: container missing → "Error: No such container: rl-foo".
    if (/No such container/i.test(stderr)) {
      return {
        ok: false,
        service,
        container,
        error: 'container_not_found',
        message: stderr,
      };
    }
    return {
      ok: false,
      service,
      container,
      error: 'infra_logs_failed',
      message: stderr,
    };
  }
}
