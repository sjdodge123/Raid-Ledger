/**
 * ROK-1779/ROK-1838: the single home of the telemetry on/off decision.
 *
 * `instrument.ts` loads first in main.ts (before Nest and the DB exist), so
 * this file imports nothing. The api reads it at boot to gate Sentry.init and
 * serves it on GET /system/status so the web app follows the same switch —
 * one env var turns on (or off) BOTH halves of a prebuilt image, no rebuild.
 */

/**
 * ROK-1838 operator ruling 2026-10-17 (reverses ROK-1779's opt-in of
 * 2026-10-15): error reporting is ON by default. An instance that sets
 * nothing reports; `ENABLE_TELEMETRY=false` opts out. Non-prod instances (CI,
 * fleet envs, local dev) set `ENABLE_TELEMETRY=false` so they don't spend the
 * shared Sentry quota.
 */
export const TELEMETRY_DEFAULT_ENABLED = true;

/**
 * `DISABLE_TELEMETRY='true'` → off (always wins, back-compat). Otherwise
 * `ENABLE_TELEMETRY='false'` → off. Anything else (unset, empty, `'true'`,
 * `'1'`, `DISABLE_TELEMETRY='false'`) → {@link TELEMETRY_DEFAULT_ENABLED}.
 */
export function isTelemetryEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.DISABLE_TELEMETRY === 'true') return false;
  if (env.ENABLE_TELEMETRY === 'false') return false;
  return TELEMETRY_DEFAULT_ENABLED;
}

/** The env file ConfigModule loads (app.module.ts). instrument.ts loads it first. */
export const API_ENV_FILE = '.env';

let bootDecision: boolean | undefined;

/**
 * Called once by instrument.ts, before Sentry.init: resolves the policy and
 * records it as the decision this process booted with.
 */
export function resolveBootTelemetry(
  env: Record<string, string | undefined> = process.env,
): boolean {
  bootDecision = isTelemetryEnabled(env);
  return bootDecision;
}

/**
 * What GET /system/status tells the browser: the decision the api's Sentry
 * gate actually used, so the two halves can never disagree. Falls back to a
 * live read only when instrument.ts never ran (tests, one-off scripts).
 */
export function servedTelemetryEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return bootDecision ?? isTelemetryEnabled(env);
}
