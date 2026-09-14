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

/** Build the remote one-liner that sources the shared ladder and runs it. */
function buildRemoteCommand(dryRun: boolean): string {
  const dry = dryRun ? '1' : '0';
  // RL_DISK_PRUNE_PCT=0 bypasses the sweeper's alarm threshold only — the
  // ladder still stops at RL_DISK_TARGET_PCT, so an explicit prune never
  // reclaims more than it has to.
  const inner =
    `source ${LADDER_LIB}; disk_pressure::guard; ` +
    `if [ "$RL_DISK_PRUNE_DRY_RUN" = "1" ]; then ` +
    `echo "${SYSTEM_DF_MARKER}$(docker system df --format '{{json .}}' 2>/dev/null | jq -sc . || echo '[]')"; fi`;
  return (
    `DOCKER_HOST=tcp://127.0.0.1:2375 RL_DISK_PRUNE_PCT=0 RL_DISK_PRUNE_DRY_RUN=${dry} ` +
    `bash -c '${inner}'`
  );
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
  return {
    ok: true,
    before: { used_pct: parsed.before_pct, free_gb: parsed.free_gb_before ?? parsed.free_gb },
    after: { used_pct: parsed.after_pct, free_gb: parsed.free_gb },
    rungs: (parsed.rungs ?? []).map((r) => ({
      ...r,
      ...(parseReclaimedBytes(r.reclaimed) !== undefined
        ? { reclaimed_bytes: parseReclaimedBytes(r.reclaimed) }
        : {}),
    })),
    pruned: parsed.pruned ?? false,
    dry_run: parsed.dry_run ?? dryRun,
    ...(systemDf ? { system_df: systemDf } : {}),
  };
}
