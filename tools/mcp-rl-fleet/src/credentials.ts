// A3-B P4 — credential redaction at the MCP return boundary.
//
// The fleet's admin@local password is seeded by the orchestrator's env-spin
// (from RL_ADMIN_PASSWORD, else a generated `rl-<hex>`). Until now every tool
// that could see it returned it UNASKED, so the value landed in the calling
// agent's context and transcript purely as a side effect of deploying an env.
// An agent cannot hold a "never pull a credential into context" line by
// declining to ask for something it is handed unbidden — so the boundary,
// not the agent, has to withhold it.
//
// FIVE MCP surfaces carried it (traced 2026-09-03, `git grep admin_password`):
//   1. rl_env_spin              — the orchestrator's JSON, passed through
//   2. rl_task_status           — `local-` ids, via readLocalTask
//   3. rl_task_wait             — `local-` ids, via waitLocalTask
//   4. rl_env_deploy(wait:true) — inline waitLocalTask on its own task
//   5. rl_task_inspect          — `local-` ids, raw task-JSON dump
// (rl_env_deploy's DEFAULT async payload never carried it: since ROK-1362 it
// returns {ok, task_id, started_at, message} and nothing else.)
//
// What is deliberately NOT changed:
//   - orchestrator/bin/env-spin still emits `admin_password`. It is the
//     operator's own `rl env spin` stdout (a human terminal, not an agent
//     context), and the value must still reach this layer for the opt-in to
//     have anything to return.
//   - ~/.raid-ledger/tasks/<id>.json still stores it (written 0600 by
//     local-task.ts). That file is the recovery path `include_credentials`
//     reads back from; it is disk, not context.
//
// Scope note: this is a TEST credential for a throwaway fleet env. The point
// is context hygiene, not secrets management — hence one ~40-line helper and
// an opt-in flag rather than a handle/vault mechanism.

/** Explains how to get the value, on results where one actually exists. */
export const ADMIN_PASSWORD_WITHHELD_HINT =
  'admin_password withheld by default so it does not enter your context unasked. ' +
  're-call this tool with include_credentials:true ONLY if you must authenticate as ' +
  'admin@local yourself. You usually do not: rl_validate_ci({against_env_slug}) re-seeds ' +
  'and threads the password into the runner on its own, and testers log in via Discord OAuth.';

/** The shape this helper acts on. Every field is optional — non-credential
 *  results (clone tasks, error envelopes) pass through untouched. */
export interface AdminPasswordCarrier {
  admin_password?: string | null;
}

/**
 * Strip `admin_password` from a tool result unless the caller explicitly asked
 * for it, replacing it with a presence marker.
 *
 * The marker matters: `admin_password: null` was itself diagnostic — it is how
 * env-spin reports that the bootstrap-admin exec failed. Dropping the key
 * silently would delete that signal, so callers get `admin_password_available:
 * false` instead and can go read `bootstrap_warnings`.
 *
 * A result that never carried the key (a clone task, an SSH-failure envelope,
 * a VM task) is returned byte-identical — no marker is invented for it.
 *
 * @param result - Any tool result that may carry `admin_password`.
 * @param include - true iff the caller passed `include_credentials: true`.
 * @returns The result, redacted unless `include` is exactly true.
 */
export function redactAdminPassword<T extends object>(result: T, include?: boolean): T {
  if (include === true) return result;
  if (!result || typeof result !== 'object') return result;
  if (!('admin_password' in result)) return result;

  // `T extends object` (not `T extends AdminPasswordCarrier`) on purpose: the
  // call sites pass wide result unions — ExecuteStatusReturn, the raw task
  // JSON — that do not all declare the key, and a narrower constraint rejects
  // object literals with no property in common (TS2559).
  const { admin_password: value, ...rest } = result as T & AdminPasswordCarrier;
  const available = typeof value === 'string' && value.length > 0;
  // Cast: we are removing an optional key and adding two informational ones,
  // which keeps the value assignable to T for every call site.
  return {
    ...rest,
    admin_password_available: available,
    ...(available ? { admin_password_hint: ADMIN_PASSWORD_WITHHELD_HINT } : {}),
  } as unknown as T;
}
