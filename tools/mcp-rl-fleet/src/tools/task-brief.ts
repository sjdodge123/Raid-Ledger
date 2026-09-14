// ROK-1567 — brief task-status projection + command redaction.
//
// WHY: the orchestrator's task-status JSON is a forensic dump — the full `cmd`
// array, the process `env`, `cwd`, the log URL/path and a 50KB `log_tail`. That
// is the right payload ONCE, when a task finishes. It is the wrong payload for
// the 50 polls that happen while it runs: one session spent ~75k tokens
// re-reading the same command line to learn a step name.
//
// So a NON-TERMINAL read is brief by default (progress fields only) and a
// TERMINAL read stays full. `brief` overrides in both directions.
//
// Second defect, independent of brief mode: the `cmd` array carries
// `ADMIN_PASSWORD='...'` for env-targeted runs, so every full read handed the
// poller the fleet env credential unasked — the same context-hygiene line
// credentials.ts::redactAdminPassword holds for `admin_password`. redactCmd
// closes it in EVERY mode.
//
// This is a LEAF module (no imports) so task.ts can use it without adding to
// its own size and the CLI (task-wait-cli.ts) can import it standalone.

/** Matches `ADMIN_PASSWORD=`, plus prefixed variants (`RL_ADMIN_PASSWORD=`),
 *  with the value quoted with ', quoted with ", or bare. */
const ADMIN_PASSWORD_ASSIGNMENT = /\b([A-Z0-9_]*ADMIN_PASSWORD)=(?:'[^']*'|"[^"]*"|[^\s]*)/g;

/** Replace the value of any ADMIN_PASSWORD-ish assignment in one string. */
function redactCmdString(s: string): string {
  return s.replace(ADMIN_PASSWORD_ASSIGNMENT, (_m, name: string) => `${name}='***'`);
}

/**
 * Redact env-credential assignments out of a command array.
 *
 * Pure: returns a new array, never mutates the input. Non-string elements (a
 * malformed payload) pass through untouched.
 *
 * @param cmd The task's command array as the orchestrator recorded it.
 * @returns The same array with every `*ADMIN_PASSWORD=<value>` rewritten to
 *          `*ADMIN_PASSWORD='***'`. Other assignments are left intact.
 */
export function redactCmd(cmd: string[]): string[] {
  return cmd.map((part) => (typeof part === 'string' ? redactCmdString(part) : part));
}

/** Fields a brief (non-terminal) status read keeps. Everything else is dropped
 *  — notably cmd, env, cwd, log_path, log_url and log_tail. */
export const BRIEF_FIELDS = [
  'ok',
  'task_id',
  'tool',
  'slot',
  'status',
  'mcp_runtime_status',
  'admission_state',
  'current_step',
  'steps',
  'elapsed_seconds',
  'started_at',
  'playwright_verified',
  'playwright_sentinel',
  // Error envelopes are already tiny; keep their payload legible in brief mode.
  'error',
  'message',
  'hint',
] as const;

/** Status values that mean "the task has not finished yet". */
const NON_TERMINAL_STATUSES = new Set(['running', 'queued', 'waiting']);

/**
 * Whether a status result should be returned brief when the caller expressed no
 * preference: yes while the task is non-terminal, no once it is terminal.
 *
 * An error envelope (no recognisable status) defaults to FULL — it is a
 * one-shot failure the caller needs to diagnose, not a poll.
 *
 * @param result A status payload from the orchestrator or the laptop registry.
 */
export function shouldDefaultBrief(result: Record<string, unknown>): boolean {
  const s = result.mcp_runtime_status ?? result.status;
  return typeof s === 'string' && NON_TERMINAL_STATUSES.has(s);
}

/**
 * Apply ROK-1567's return-boundary rules to a status payload: always redact the
 * credential out of `cmd` / `args_summary` / `env`, then project to the brief
 * field set when `brief` (explicit, else {@link shouldDefaultBrief}) is true.
 *
 * @param result The full status payload.
 * @param brief  Explicit caller preference; `undefined` means "use the default".
 * @returns A new object — the input is never mutated.
 */
export function applyStatusProjection<T extends object>(result: T, brief?: boolean): T {
  const out: Record<string, unknown> = { ...(result as Record<string, unknown>) };
  if (Array.isArray(out.cmd)) out.cmd = redactCmd(out.cmd as string[]);
  if (typeof out.args_summary === 'string') out.args_summary = redactCmdString(out.args_summary);
  if (out.env && typeof out.env === 'object' && !Array.isArray(out.env)) {
    out.env = Object.fromEntries(
      Object.entries(out.env as Record<string, unknown>).map(([k, v]) =>
        /ADMIN_PASSWORD$/.test(k) ? [k, '***'] : [k, v],
      ),
    );
  }
  if (!(brief ?? shouldDefaultBrief(out))) return out as T;
  const briefed: Record<string, unknown> = {};
  for (const key of BRIEF_FIELDS) {
    if (key in out) briefed[key] = out[key];
  }
  return briefed as T;
}
