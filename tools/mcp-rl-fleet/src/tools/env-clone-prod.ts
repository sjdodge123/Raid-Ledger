// rl_env_clone_prod — refresh operator's local DB from prod, then push to env.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildSshArgs } from '../exec.js';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const CLONE_SCRIPT = resolve(__dirname, '../../../../scripts/clone-prod-to-env.sh');

export const TOOL_NAME = 'rl_env_clone_prod';
export const TOOL_DESCRIPTION =
  "Clone production data into a test env. Two-step: (1) refreshes the operator's local DB from prod via the existing clone-prod-to-local.sh path (sanitized backup; app_settings preserved), (2) pushes that snapshot into the test env via rl_env_sync_from_local in `full` mode. Result: tester sees realistic prod-shaped data in their test env. Requires .env.clone at repo root with PROD_URL + auth creds. The destructive `--fresh` flag is used implicitly — operator's LOCAL DB gets overwritten by prod data. Set skip_local_refresh=true to skip the prod→local step if you've recently cloned (much faster). NOTE: this tool runs synchronously today — the wait / wait_timeout_seconds params exist for shape symmetry with rl_validate_ci + rl_env_build_image_from_runner but currently have no effect (clone-prod-to-env.sh runs on the operator laptop, not the VM, so task-start dispatch doesn't apply). Async dispatch is a follow-up; for now treat this as SYNC.";

export interface EnvCloneProdParams {
  slug: string;
  /** Skip the prod→local refresh step. Use after a recent clone-prod-to-local. */
  skip_local_refresh?: boolean;
  /** Soft timeout. Defaults to 1200 (20 min) — prod backup + download + restore can be slow. */
  timeout_seconds?: number;
  /**
   * ROK-1331 M2: schema-symmetric with rl_validate_ci / rl_env_build_image_from_runner.
   * Currently advisory only — clone-prod-to-env.sh runs on the operator's
   * laptop, not the VM, so task-start dispatch doesn't apply. Sync execution
   * is the only path today. Tracked as a follow-up: laptop-side task tracker.
   */
  wait?: boolean;
  /** Advisory — see `wait` above. Default 1800. */
  wait_timeout_seconds?: number;
}

export interface EnvCloneProdResult {
  ok: boolean;
  slug: string;
  stdout: string;
  stderr: string;
  exit_code: number;
  /** Whether the allinone was restarted after the clone to refresh SettingsService cache. */
  restarted_for_settings?: boolean;
  restart_error?: string;
}

export async function execute(params: EnvCloneProdParams): Promise<EnvCloneProdResult> {
  const timeoutMs = (params.timeout_seconds ?? 1200) * 1000;
  const args = [params.slug];
  if (params.skip_local_refresh) args.push('--skip-local-refresh');
  let cloneResult: { stdout: string; stderr: string };
  try {
    cloneResult = await execFileAsync(CLONE_SCRIPT, args, {
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env },
    });
  } catch (err) {
    const e = err as Error & { stdout?: string; stderr?: string; code?: number };
    return {
      ok: false,
      slug: params.slug,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? e.message,
      exit_code: e.code ?? 1,
    };
  }

  // Restart allinone so SettingsService re-reads + re-caches the new
  // app_settings rows. Without this, the 30-min boot cache holds the
  // pre-clone state and integrations look broken until TTL.
  let restartedForSettings = false;
  let restartError: string | undefined;
  try {
    const sshArgs = await buildSshArgs(
      // DOCKER_HOST→wollomatic proxy (rl-agent has no docker group; Bug G).
      `DOCKER_HOST=tcp://127.0.0.1:2375 docker restart rl-env-${params.slug}-allinone && sleep 6`,
    );
    await execFileAsync(
      'ssh',
      sshArgs,
      { timeout: 60_000 },
    );
    restartedForSettings = true;
  } catch (err) {
    const e = err as Error & { stderr?: string };
    restartError = e.stderr || e.message;
  }

  return {
    ok: true,
    slug: params.slug,
    stdout: cloneResult.stdout,
    stderr: cloneResult.stderr,
    exit_code: 0,
    restarted_for_settings: restartedForSettings,
    restart_error: restartError,
  };
}
