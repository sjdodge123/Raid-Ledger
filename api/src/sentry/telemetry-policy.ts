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

/** Opt-out spellings, compared trimmed + lower-cased. */
const ENABLE_OFF_VALUES: ReadonlySet<string> = new Set([
  'false',
  '0',
  'no',
  'off',
]);
const DISABLE_ON_VALUES: ReadonlySet<string> = new Set([
  'true',
  '1',
  'yes',
  'on',
]);

function normalised(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/**
 * The opt-out is forgiving (review MAJOR 1): `DISABLE_TELEMETRY` of
 * true/1/yes/on → off (always wins, back-compat). Otherwise `ENABLE_TELEMETRY`
 * of false/0/no/off → off. Case and surrounding whitespace are ignored.
 * Anything else (unset, empty, `'true'`, a typo) → {@link TELEMETRY_DEFAULT_ENABLED}.
 */
export function isTelemetryEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (DISABLE_ON_VALUES.has(normalised(env.DISABLE_TELEMETRY))) return false;
  if (ENABLE_OFF_VALUES.has(normalised(env.ENABLE_TELEMETRY))) return false;
  return TELEMETRY_DEFAULT_ENABLED;
}

/**
 * The api initialises Sentry only in production (instrument.ts). Shared so the
 * served flag applies the exact same condition.
 */
export function isProductionRuntime(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.NODE_ENV === 'production';
}

/** The env file ConfigModule loads (app.module.ts). instrument.ts loads it first. */
export const API_ENV_FILE = '.env';

let bootServed: boolean | undefined;

/**
 * Called once by instrument.ts, before Sentry.init: resolves the policy and
 * records what the api's Sentry gate will do (policy AND production).
 */
export function resolveBootTelemetry(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const enabled = isTelemetryEnabled(env);
  bootServed = enabled && isProductionRuntime(env);
  return enabled;
}

/**
 * What GET /system/status tells the browser: whether the api's own Sentry
 * gate is on (policy AND production), so a dev api never tells browsers to
 * report (review MAJOR 2 / Codex P2). Serves the boot record; falls back to a
 * live read only when instrument.ts never ran (tests, one-off scripts).
 */
export function servedTelemetryEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return bootServed ?? (isTelemetryEnabled(env) && isProductionRuntime(env));
}
