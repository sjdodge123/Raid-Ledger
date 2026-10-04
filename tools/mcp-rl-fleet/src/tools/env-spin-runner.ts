// rl_env_spin — the detached laptop runner's spin step.
//
// runner-entry.ts calls runSpinTask for an `rl_env_spin` task. It runs the
// synchronous spinEnv() core and copies the result fields into the laptop task
// JSON so a terminal `rl_task_status local-...` hands back the url / admin_email
// the old SYNC tool returned inline.
//
// A3-B P4: spinEnv is called with include_credentials:true because the 0600
// task JSON is the only sink — the same boundary as the rl_env_deploy chain.
// readLocalTask redacts admin_password on every status read unless the caller
// passes include_credentials:true there.

import type { LocalTaskJson } from '../local-task.js';
import type { ChainCtx } from './env-deploy-steps.js';
import { spinEnv, type EnvSpinParams, type EnvSpinResult } from './env-spin.js';

export interface SpinTaskOutcome {
  ok: boolean;
  error?: string;
  message: string;
}

/** Copy the spin result fields onto the task JSON (null when absent). */
function copySpinFields(res: EnvSpinResult, current: LocalTaskJson): void {
  if (typeof res.slot === 'number') current.slot = res.slot;
  current.url = res.url ?? null;
  current.slot_url = res.slot_url ?? null;
  current.internal_url = res.internal_url ?? null;
  current.admin_email = res.admin_email ?? null;
  current.admin_password = res.admin_password ?? null;
  current.operator_admin = res.operator_admin ?? null;
  current.bootstrap_warnings = res.bootstrap_warnings ?? null;
  // Structured failure diagnostics the sync tool returned inline (Codex P2).
  if (res.hint) current.hint = res.hint;
}

/** phase / exit_code / hint folded into one line so a plain status read keeps them. */
function failureDetail(res: EnvSpinResult): string {
  const parts: string[] = [];
  if (res.phase) parts.push(`phase=${res.phase}`);
  if (typeof res.exit_code === 'number') parts.push(`exit_code=${res.exit_code}`);
  const tags = parts.length ? ` (${parts.join(', ')})` : '';
  return res.hint ? `${tags} — hint: ${res.hint}` : tags;
}

function outcomeMessage(slug: string, res: EnvSpinResult): string {
  if (res.ok) return `Env ${slug} is up at ${res.url ?? '(no url returned)'}.`;
  return `env spin failed for ${slug}: ${res.message ?? res.error ?? 'unknown'}${failureDetail(res)}`;
}

export async function runSpinTask(
  params: EnvSpinParams,
  current: LocalTaskJson,
  ctx: ChainCtx,
): Promise<SpinTaskOutcome> {
  ctx.setCurrent('env_spin');
  const t0 = Date.now();
  const res = await spinEnv({ ...params, include_credentials: true });
  ctx.recordStep('env_spin', res.ok, (Date.now() - t0) / 1000, undefined, res.error);
  copySpinFields(res, current);
  return {
    ok: res.ok,
    error: res.ok ? undefined : (res.error ?? 'env_spin_failed'),
    message: outcomeMessage(params.slug, res),
  };
}
