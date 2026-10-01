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

/** Matches a shell assignment whose NAME ends in a secret-bearing word —
 *  `ADMIN_PASSWORD=`, `RL_ADMIN_PASSWORD=`, `DISCORD_BOT_TOKEN=`,
 *  `JWT_SECRET=`, … — with the value quoted with ', quoted with ", or bare.
 *
 *  ROK-1534: the original pattern matched `*ADMIN_PASSWORD` only. A task `cmd`
 *  is an arbitrary env prefix, so the next credential threaded onto one (a bot
 *  token, a webhook secret) would have leaked through the same seam that was
 *  already closed for the env admin password. Match the CLASS, not the one
 *  member of it we happened to hit first. */
const SECRET_ASSIGNMENT = /\b([A-Z0-9_]*(?:PASSWORD|TOKEN|SECRET|PASSWD))=(?:'[^']*'|"[^"]*"|[^\s]*)/g;

/** Matches an env-map KEY that carries a secret, same word class as above. */
const SECRET_KEY = /(?:PASSWORD|TOKEN|SECRET|PASSWD)$/;

/** Replace the value of any secret-bearing assignment in one string. */
function redactCmdString(s: string): string {
  return s.replace(SECRET_ASSIGNMENT, (_m, name: string) => `${name}='***'`);
}

/**
 * Redact env-credential assignments out of a command array.
 *
 * Pure: returns a new array, never mutates the input. Non-string elements (a
 * malformed payload) pass through untouched.
 *
 * @param cmd The task's command array as the orchestrator recorded it.
 * @returns The same array with every `*PASSWORD=` / `*TOKEN=` / `*SECRET=`
 *          value rewritten to `'***'`. Other assignments are left intact.
 */
export function redactCmd(cmd: string[]): string[] {
  return cmd.map((part) => (typeof part === 'string' ? redactCmdString(part) : part));
}

/**
 * Strip credentials out of the three places a task record carries them:
 * `cmd` (the argv the orchestrator recorded), `args_summary` (the same command
 * line, flattened) and `env` (the process environment map).
 *
 * ROK-1534: this used to live inline in {@link applyStatusProjection}, so ONLY
 * rl_task_status / rl_task_wait were covered. rl_task_inspect returns the raw
 * task JSON and rl_task_list returns every task record whole — both handed the
 * poller the `ADMIN_PASSWORD='…'` in `cmd` that A3-B withholds from
 * `admin_password`. Hoisted to its own export so every task-shaped return
 * boundary can apply the SAME rule.
 *
 * Pure: returns a new object, never mutates the input. A record that carries
 * none of the three keys comes back structurally unchanged.
 *
 * @param record Any task-shaped payload (status result, raw task JSON, list row).
 * @returns A shallow copy with cmd/args_summary/env redacted.
 */
export function redactTaskSecrets<T extends object>(record: T): T {
  if (!record || typeof record !== 'object') return record;
  const out: Record<string, unknown> = { ...(record as Record<string, unknown>) };
  if (Array.isArray(out.cmd)) out.cmd = redactCmd(out.cmd as string[]);
  if (typeof out.args_summary === 'string') out.args_summary = redactCmdString(out.args_summary);
  if (out.env && typeof out.env === 'object' && !Array.isArray(out.env)) {
    out.env = Object.fromEntries(
      Object.entries(out.env as Record<string, unknown>).map(([k, v]) =>
        SECRET_KEY.test(k) ? [k, '***'] : [k, v],
      ),
    );
  }
  return out as T;
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
  // M5b liveness fields — one short line each, and the only way a poller tells
  // "still working" from "hung". Dropping them would defeat the point.
  'last_output_at',
  'last_line',
  'progress_hint',
  'steps',
  'elapsed_seconds',
  'started_at',
  'playwright_verified',
  'playwright_sentinel',
  // A3-B credential contract + the deploy result fields. One line each, and
  // dropping them would make the withheld-password signal vanish silently on a
  // running local- deploy (review MAJOR 2). `admin_password` itself is NOT here:
  // an explicit include_credentials opt-in forces the full payload instead.
  'admin_password_available',
  'admin_password_hint',
  'url',
  'slot_url',
  'internal_url',
  'admin_email',
  // TDB:1452: one human line naming the watchdog when it killed the run.
  'exit_reason',
  // Error envelopes are already tiny; keep their payload legible in brief mode.
  'error',
  'message',
  'hint',
] as const;

/** TDB:1452 — the exit code task-start's timeout watchdog leaves behind:
 *  128 + SIGTERM(15). The orchestrator records it as a plain `failed`, so
 *  without a gloss the poller sees "failed, exit 143" and reads it as a red
 *  gate rather than a run that simply outlived its `timeout_seconds`. */
export const WATCHDOG_EXIT_CODE = 143;

/** The `exit_reason` a watchdog-killed task carries. */
export const WATCHDOG_EXIT_REASON =
  'killed by the gate watchdog (SIGTERM, exit 143) — raise timeout_seconds';

/**
 * Name the cause of a terminal exit code when it is one we can identify.
 *
 * Only exit 143 is glossed. A `cancelled` task is excluded: task-cancel also
 * SIGTERMs the process group, so its 143 is the caller's own cancel, not the
 * watchdog. 137 (SIGKILL) is deliberately NOT claimed — the watchdog's 10s
 * grace SIGKILL and a kernel OOM kill both produce it.
 *
 * @param result A status payload.
 * @returns A short human string, or undefined when there is nothing to say.
 */
export function describeExitReason(result: Record<string, unknown>): string | undefined {
  if (result.script_exit_code !== WATCHDOG_EXIT_CODE) return undefined;
  const s = result.mcp_runtime_status ?? result.status;
  if (s === 'cancelled') return undefined;
  return WATCHDOG_EXIT_REASON;
}

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
 * credential out of `cmd` / `args_summary` / `env`, gloss a watchdog exit as
 * `exit_reason` (TDB:1452), then project to the brief
 * field set when `brief` (explicit, else {@link shouldDefaultBrief}) is true.
 *
 * @param result The full status payload.
 * @param brief  Explicit caller preference; `undefined` means "use the default".
 * @param includeCredentials The caller's A3-B opt-in. When true the default flips
 *   to FULL: a caller that explicitly asked for `admin_password` must not have it
 *   eaten by a projection it never opted into (review MAJOR 2).
 * @returns A new object — the input is never mutated.
 */
export function applyStatusProjection<T extends object>(
  result: T,
  brief?: boolean,
  includeCredentials?: boolean,
): T {
  const out = redactTaskSecrets(result) as unknown as Record<string, unknown>;
  const exitReason = describeExitReason(out);
  if (exitReason) out.exit_reason = exitReason;
  if (!(brief ?? (shouldDefaultBrief(out) && !includeCredentials))) return out as T;
  const briefed: Record<string, unknown> = {};
  for (const key of BRIEF_FIELDS) {
    if (key in out) briefed[key] = out[key];
  }
  return briefed as T;
}
