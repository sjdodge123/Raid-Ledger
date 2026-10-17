// rl_env_sync_from_local — copy operator's local DB data into a test env.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
// MCP server → tools/ → repo root → scripts/.
const SYNC_SCRIPT = resolve(__dirname, '../../../../scripts/sync-local-to-env.sh');

export const TOOL_NAME = 'rl_env_sync_from_local';
export const TOOL_DESCRIPTION =
  "Copy data from the operator's local dev DB into a test env's Postgres. Two modes: `settings` (default — just app_settings + local_credentials + consumed_intent_tokens, so the env has working Discord/Blizzard/ITAD/OAuth API keys + the admin login) or `full` (everything; use AFTER clone-prod-to-local for prod-shaped test data). Requires (a) operator's local raid-ledger-db container running, (b) the target env spun via rl_env_spin. Caveat: app_settings rows are encrypted with the operator's JWT_SECRET; the env must run with the same JWT_SECRET (set RL_ENV_JWT_SECRET in /srv/rl-infra/.env) for them to decrypt at runtime.";

export interface EnvSyncParams {
  slug: string;
  /** 'settings' (default) or 'full'. */
  mode?: 'settings' | 'full';
  /** Soft timeout. Defaults to 600 (10 min) — full clone of large DBs can be slow. */
  timeout_seconds?: number;
}

export interface EnvSyncResult {
  ok: boolean;
  slug: string;
  mode: 'settings' | 'full';
  stdout: string;
  stderr: string;
  exit_code: number;
}

export async function execute(params: EnvSyncParams): Promise<EnvSyncResult> {
  const mode = params.mode ?? 'settings';
  const timeoutMs = (params.timeout_seconds ?? 600) * 1000;
  try {
    const result = await execFileAsync(SYNC_SCRIPT, [params.slug, mode], {
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env },
    });
    return {
      ok: true,
      slug: params.slug,
      mode,
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: 0,
    };
  } catch (err) {
    const e = err as Error & { stdout?: string; stderr?: string; code?: number };
    return {
      ok: false,
      slug: params.slug,
      mode,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? e.message,
      exit_code: e.code ?? 1,
    };
  }
}
