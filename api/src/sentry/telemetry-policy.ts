/**
 * ROK-1779: the single home of the telemetry on/off decision.
 *
 * `instrument.ts` loads first in main.ts (before Nest and the DB exist), so
 * this file imports nothing. The api reads it at boot to gate Sentry.init and
 * serves it on GET /system/status so the web app follows the same switch —
 * one env var turns on (or off) BOTH halves of a prebuilt image, no rebuild.
 */

/**
 * ROK-1779 operator ruling 2026-10-15: error reporting is OPT-IN. An instance
 * that sets nothing sends nothing. The maintainer's production instance must
 * set `ENABLE_TELEMETRY=true` to keep reporting.
 */
export const TELEMETRY_DEFAULT_ENABLED = false;

/**
 * `DISABLE_TELEMETRY='true'` → off (always wins). Otherwise
 * `ENABLE_TELEMETRY='true'` → on. Anything else (unset, empty, `'1'`,
 * `DISABLE_TELEMETRY='false'`) → {@link TELEMETRY_DEFAULT_ENABLED}.
 */
export function isTelemetryEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.DISABLE_TELEMETRY === 'true') return false;
  if (env.ENABLE_TELEMETRY === 'true') return true;
  return TELEMETRY_DEFAULT_ENABLED;
}
