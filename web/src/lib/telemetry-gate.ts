/**
 * ROK-1779: the web runtime opt-out. Sentry initialises only when the api's
 * /system/status says `telemetryEnabled: true` AND the image was not built
 * with VITE_DISABLE_TELEMETRY=true. A missing flag (old api, failed fetch)
 * fails closed: an opted-out instance must never report.
 */
export function shouldInitTelemetry(
    serverEnabled: boolean | undefined,
    buildDisabled: boolean,
): boolean {
    return !buildDisabled && serverEnabled === true;
}
