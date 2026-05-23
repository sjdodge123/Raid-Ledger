// ROK-1331 M7 — rl_fleet_health MCP tool.
//
// Agent-side monitor for the rl-infra fleet. SSHes the VM and curls the
// dashboard's /api/fleet-health endpoint via the rl-net curl pattern (same
// shape as test-plan.ts's curlOnVM — kept inline here to avoid a one-tool
// utility module). Returns the aggregated snapshot directly so agents can
// poll after a flake to see if known fleet-bug-class signals just spiked.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildSshArgs } from '../exec.js';

const execFileAsync = promisify(execFile);
const RUN_ON_VM_TIMEOUT_MS = 15_000;

export const TOOL_NAME = 'rl_fleet_health';
export const TOOL_DESC =
  "Snapshot of fleet-wide health signals — stale-heartbeat slots, queue-stuck waiters, recent audit-log error categories (permission_denied / exit_255 / oom / socket_hang_up / inotify_missing / dubious_ownership / illegal_instruction), per-runner warnings, plus a 15-minute perf_summary (last_validate_ci, p50_validate_step_ms, claims_held_minutes, pkill_survivors_last_release, gc_sweep_last_cycle_ms). Cheap, read-only, no flock. Returns the same shape the dashboard's /api/fleet-health endpoint produces. Use after a flake to discriminate 'known fleet-bug-class' (e.g. spike in socket_hang_up counts) vs 'new failure'. severity_threshold is reserved for future filtering — v1 returns everything.";

export interface FleetHealthParams {
  severity_threshold?: 'warn' | 'error';
}

export interface FleetHealthResult {
  ok: boolean;
  generated_at?: string;
  stale_heartbeat_slots?: Array<{
    slot: number;
    agent_id: string | null;
    branch: string | null;
    heartbeat_age_seconds: number;
  }>;
  queue_stuck?: Array<{
    agent_id: string | null;
    branch: string | null;
    queued_for_seconds: number;
    exceeds_ttl: boolean;
  }>;
  runner_warnings?: Array<{
    runner: string;
    kind: string;
    value: string;
    since: string;
  }>;
  recent_audit_errors?: Array<{
    category: string;
    count: number;
    last_seen: string | null;
    sample: string;
  }>;
  /** ROK-1331 M11 — rolling-window perf rollup. Window default 15 min. */
  perf_summary?: {
    window_minutes: number;
    last_validate_ci: {
      ts: string;
      branch: string | null;
      duration_ms: number;
      exit_code: number;
      slot: number;
    } | null;
    p50_validate_step_ms: Record<string, number>;
    claims_held_minutes: number[];
    pkill_survivors_last_release: number;
    gc_sweep_last_cycle_ms: number;
  };
  /** Slots whose held claim's last validate-ci ended with a non-zero exit. */
  held_slots_with_failed_validate_ci?: Array<{
    slot: number;
    agent_id: string | null;
    branch: string | null;
    last_exit_code: number;
  }>;
  summary?: {
    ok: boolean;
    warning_count: number;
    stale_slots: number;
    stuck_queue_entries: number;
    held_slots_with_failed_validate_ci: number;
  };
  error?: string;
  status?: number;
  message?: string;
}

export async function execute(_p: FleetHealthParams = {}): Promise<FleetHealthResult> {
  // Construct the remote curl-on-rl-net command. The dashboard is reachable
  // by service name from within rl-net; we never need the public hostname.
  // -s suppresses progress, -w prints the http_code so we can separate body
  // from status. Path is hardcoded — no caller-controlled string in the
  // shell context.
  const url = 'http://rl-dashboard:8080/api/fleet-health';
  const remote =
    `docker run --rm --network rl-net curlimages/curl:8.10.1 ` +
    `curl -s -X GET -w '\\nRL_STATUS:%{http_code}' '${url}'`;
  let stdout = '';
  try {
    const sshArgs = await buildSshArgs(`DOCKER_HOST=tcp://127.0.0.1:2375 ${remote}`);
    const r = await execFileAsync(
      'ssh',
      sshArgs,
      { timeout: RUN_ON_VM_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
    );
    stdout = r.stdout;
  } catch (err) {
    const e = err as Error & { code?: number; stderr?: string };
    return {
      ok: false,
      error: 'ssh_failed',
      status: e.code,
      message: e.stderr || e.message || 'ssh execFile rejected',
    };
  }
  const match = stdout.match(/\nRL_STATUS:(\d+)\s*$/);
  const status = match ? parseInt(match[1], 10) : 0;
  const rawBody = match ? stdout.slice(0, match.index ?? 0) : stdout;
  if (status !== 200) {
    return {
      ok: false,
      error: 'dashboard_http_error',
      status,
      message: rawBody.slice(0, 500),
    };
  }
  let parsed: unknown;
  try { parsed = JSON.parse(rawBody); } catch {
    return {
      ok: false,
      error: 'failed_to_parse_response',
      status,
      message: rawBody.slice(0, 500),
    };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'failed_to_parse_response', status };
  }
  return { ok: true, ...(parsed as Omit<FleetHealthResult, 'ok'>) };
}
