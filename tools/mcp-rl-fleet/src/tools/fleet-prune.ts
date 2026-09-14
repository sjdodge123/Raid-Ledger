// ROK-1568 — rl_fleet_prune MCP tool.
//
// On 2026-09-14 the rl-infra host hit 98% used (240G/245G): two parallel image
// builds died at `chmod -R` with ENOSPC and an overlapping Playwright run
// produced net::ERR_TIMED_OUT false reds. The gc-sweeper's scoped prune only
// touches `rl.role=env` objects and reclaimed nothing — the 87 GB was in the
// buildkit cache, untagged images and 285 anonymous volumes — so the operator
// had to prune by hand. This tool gives agents the same ladder on demand.
//
// It runs the SHARED library (orchestrator/bin/_disk_pressure.sh), not a
// re-implementation, so the sweeper's ordering, the runner-image guard and the
// stop-at-target rule can never drift from what an agent triggers by hand.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildSshArgs } from '../exec.js';

const execFileAsync = promisify(execFile);
const RUN_ON_VM_TIMEOUT_MS = 600_000;
const LADDER_LIB = '/srv/rl-infra/orchestrator/bin/_disk_pressure.sh';
const SYSTEM_DF_MARKER = 'RL_SYSTEM_DF:';

export const TOOL_NAME = 'rl_fleet_prune';
export const TOOL_DESC =
  "Reclaim disk on the rl-infra host by running the gc-sweeper's disk-pressure ladder on demand: docker builder prune → aged image prune (never a running container's image, never `rl.role=runner`) → anonymous volume prune, re-reading df after each rung and stopping the moment usage clears RL_DISK_TARGET_PCT. Use it when rl_status shows host.disk_free_gb low, when an image build fails with `disk_pressure`, or before a big build. Returns before/after used% + free GB and what each rung reclaimed. Pass dry_run:true to list the rungs it WOULD run plus `docker system df` reclaimable numbers, without touching the host.";

export interface FleetPruneParams {
  dry_run?: boolean;
}

export interface PruneRung {
  rung: string;
  /** Only present on a real run. */
  before_pct?: number;
  after_pct?: number;
  /** Docker's human string, e.g. "14.5GB". */
  reclaimed?: string;
  /** Same figure normalized to bytes so agents can compare/sum it. */
  reclaimed_bytes?: number;
  /** Dry-run only: the exact command, and that it was not executed. */
  command?: string;
  would_run?: boolean;
  /** Non-zero when docker (or the proxy allowlist) refused the rung. */
  exit_code?: number;
  /** Tail of the rung's output when it failed. */
  stderr?: string;
}

export interface FleetPruneResult {
  ok: boolean;
  before?: { used_pct: number; free_gb: number };
  after?: { used_pct: number; free_gb: number };
  rungs?: PruneRung[];
  pruned?: boolean;
  dry_run?: boolean;
  /** Dry-run only: raw `docker system df` rows. */
  system_df?: unknown[];
  /** `ssh_failed` | `failed_to_parse_response` | `prune_rung_failed`. */
  error?: string;
  message?: string;
}

const UNITS: Record<string, number> = {
  B: 1,
  KB: 1000,
  MB: 1000 ** 2,
  GB: 1000 ** 3,
  TB: 1000 ** 4,
};

/**
 * Convert docker's human reclaim string ("14.5GB", "512MB", "0B") to bytes.
 * Docker prints decimal (SI) units here, so 1GB is 1e9 — not 2^30. Returns
 * undefined for anything that doesn't parse, rather than a misleading 0.
 */
export function parseReclaimedBytes(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const m = /^([\d.]+)\s*([KMGT]?B)$/i.exec(raw.trim());
  if (!m) return undefined;
  const unit = UNITS[m[2].toUpperCase()];
  if (!unit) return undefined;
  return Math.round(parseFloat(m[1]) * unit);
}

/**
 * The remote script, as plain multi-line bash. Kept free of any wrapper
 * quoting: v1 inlined this into `bash -c '…'` and the nested single quotes in
 * `'{{json .}}'` / `'[]'` closed the wrapper early, so EVERY call — dry-run and
 * real — died with "unexpected EOF while looking for matching `)'" and came
 * back as failed_to_parse_response (review BLOCKER 2). It is shipped
 * base64-encoded by buildRemoteCommand below, which makes the quoting
 * unbreakable by construction. Exported so a test can decode and `bash -n` it.
 */
export function buildRemoteScript(dryRun: boolean): string {
  const dry = dryRun ? '1' : '0';
  // RL_DISK_PRUNE_PCT=0 bypasses the sweeper's alarm threshold only — the
  // ladder still stops at RL_DISK_TARGET_PCT, so an explicit prune never
  // reclaims more than it has to.
  return [
    'set -u',
    'export DOCKER_HOST=tcp://127.0.0.1:2375',
    'export RL_DISK_PRUNE_PCT=0',
    `export RL_DISK_PRUNE_DRY_RUN=${dry}`,
    `source ${LADDER_LIB}`,
    'disk_pressure::guard',
    `if [ "$RL_DISK_PRUNE_DRY_RUN" = "1" ]; then`,
    `  DF=$(docker system df --format '{{json .}}' 2>/dev/null | jq -sc . 2>/dev/null)`,
    '  [ -n "$DF" ] || DF="[]"',
    `  echo "${SYSTEM_DF_MARKER}$DF"`,
    'fi',
    '',
  ].join('\n');
}

/** Wrap the script so no quoting inside it can ever reach the remote shell. */
export function buildRemoteCommand(dryRun: boolean): string {
  const b64 = Buffer.from(buildRemoteScript(dryRun), 'utf8').toString('base64');
  return `bash -c "$(echo ${b64} | base64 -d)"`;
}

/** Split the ladder JSON (first line) from the optional system-df marker line. */
function splitOutput(stdout: string): { ladder: string; systemDf?: unknown[] } {
  let ladder = '';
  let systemDf: unknown[] | undefined;
  for (const line of stdout.split('\n')) {
    if (line.startsWith(SYSTEM_DF_MARKER)) {
      try {
        const parsed: unknown = JSON.parse(line.slice(SYSTEM_DF_MARKER.length));
        if (Array.isArray(parsed)) systemDf = parsed;
      } catch {
        systemDf = undefined;
      }
    } else if (!ladder && line.trim().startsWith('{')) {
      ladder = line.trim();
    }
  }
  return { ladder, systemDf };
}

interface LadderJson {
  before_pct: number;
  after_pct: number;
  free_gb_before?: number;
  free_gb: number;
  pruned?: boolean;
  dry_run?: boolean;
  rungs?: PruneRung[];
}

/**
 * Run the host disk-pressure ladder on the rl-infra VM (or, with
 * `dry_run: true`, report what it would do). Never throws: an unreachable VM
 * or unparseable output comes back as `{ok:false, error}` so a failed prune
 * can't take down the caller mid-incident.
 */
export async function execute(p: FleetPruneParams = {}): Promise<FleetPruneResult> {
  const dryRun = p.dry_run === true;
  let stdout = '';
  try {
    const sshArgs = await buildSshArgs(buildRemoteCommand(dryRun));
    const r = await execFileAsync('ssh', sshArgs, {
      timeout: RUN_ON_VM_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
    });
    stdout = r.stdout;
  } catch (err) {
    const e = err as Error & { code?: number; stderr?: string };
    return {
      ok: false,
      error: 'ssh_failed',
      message: e.stderr || e.message || 'ssh execFile rejected',
    };
  }
  const { ladder, systemDf } = splitOutput(stdout);
  let parsed: LadderJson | null = null;
  try {
    parsed = ladder ? (JSON.parse(ladder) as LadderJson) : null;
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed.before_pct !== 'number') {
    return { ok: false, error: 'failed_to_parse_response', message: stdout.slice(0, 500) };
  }
  const rungs = (parsed.rungs ?? []).map((r) => ({
    ...r,
    ...(parseReclaimedBytes(r.reclaimed) !== undefined
      ? { reclaimed_bytes: parseReclaimedBytes(r.reclaimed) }
      : {}),
  }));
  // A rung the docker proxy refused (403 → non-zero exit) reclaims nothing and
  // reports "0B". Reporting ok:true for that is how a denied prune looked
  // exactly like a clean one during the 2026-09-14 incident (review MAJOR 3).
  const failed = rungs.find((r) => typeof r.exit_code === 'number' && r.exit_code !== 0);
  const base: Omit<FleetPruneResult, 'ok'> = {
    before: { used_pct: parsed.before_pct, free_gb: parsed.free_gb_before ?? parsed.free_gb },
    after: { used_pct: parsed.after_pct, free_gb: parsed.free_gb },
    rungs,
    pruned: parsed.pruned ?? false,
    dry_run: parsed.dry_run ?? dryRun,
    ...(systemDf ? { system_df: systemDf } : {}),
  };
  if (failed) {
    return {
      ...base,
      ok: false,
      error: 'prune_rung_failed',
      message: `rung ${failed.rung} exited ${failed.exit_code}: ${failed.stderr ?? ''}`.trim(),
    };
  }
  return { ...base, ok: true };
}
