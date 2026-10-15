/**
 * ROK-1779: the single home of the telemetry on/off decision.
 *
 * `instrument.ts` loads first in main.ts (before Nest and the DB exist), so
 * this file imports nothing. The api reads it at boot to gate Sentry.init and
 * serves it on GET /system/status so the web app follows the same switch —
 * one env var turns off BOTH halves of a prebuilt image, no rebuild.
 */

/**
 * ROK-1779 OPEN operator ruling: true = opt-out (today), false = opt-in.
 * The default for an instance that sets nothing. Flipping it to `false` is the
 * whole ruling change — set `DISABLE_TELEMETRY=false` on the maintainer's NAS
 * FIRST, or it goes dark too.
 */
export const TELEMETRY_DEFAULT_ENABLED = true;

/**
 * `DISABLE_TELEMETRY='true'` → off, `'false'` → on, anything else (unset,
 * empty, `'1'`) → {@link TELEMETRY_DEFAULT_ENABLED}.
 */
export function isTelemetryEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const value = env.DISABLE_TELEMETRY;
  if (value === 'true') return false;
  if (value === 'false') return true;
  return TELEMETRY_DEFAULT_ENABLED;
}
