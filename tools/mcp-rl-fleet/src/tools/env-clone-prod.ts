// rl_env_clone_prod — refresh operator's local DB from prod, then push to env.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const CLONE_SCRIPT = resolve(__dirname, '../../../../scripts/clone-prod-to-env.sh');

export const TOOL_NAME = 'rl_env_clone_prod';
export const TOOL_DESCRIPTION =
  "Clone production data into a test env. Two-step: (1) refreshes the operator's local DB from prod via the existing clone-prod-to-local.sh path (sanitized backup; app_settings preserved), (2) pushes that snapshot into the test env via rl_env_sync_from_local in `full` mode. Result: tester sees realistic prod-shaped data in their test env. Requires .env.clone at repo root with PROD_URL + auth creds. The destructive `--fresh` flag is used implicitly — operator's LOCAL DB gets overwritten by prod data. Set skip_local_refresh=true to skip the prod→local step if you've recently cloned (much faster).";

export interface EnvCloneProdParams {
  slug: string;
  /** Skip the prod→local refresh step. Use after a recent clone-prod-to-local. */
  skip_local_refresh?: boolean;
  /** Soft timeout. Defaults to 1200 (20 min) — prod backup + download + restore can be slow. */
  timeout_seconds?: number;
}

export interface EnvCloneProdResult {
  ok: boolean;
  slug: string;
  stdout: string;
  stderr: string;
  exit_code: number;
}

export async function execute(params: EnvCloneProdParams): Promise<EnvCloneProdResult> {
  const timeoutMs = (params.timeout_seconds ?? 1200) * 1000;
  const args = [params.slug];
  if (params.skip_local_refresh) args.push('--skip-local-refresh');
  try {
    const result = await execFileAsync(CLONE_SCRIPT, args, {
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env },
    });
    return { ok: true, slug: params.slug, stdout: result.stdout, stderr: result.stderr, exit_code: 0 };
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
}
