/**
 * ROK-1779 (Codex r4-r6): the boot order, as a function main.tsx runs.
 *
 *   1. The telemetry decision first: GET /system/status with the browser's
 *      own `fetch` and a hard timeout. A failure or a timeout means telemetry
 *      stays OFF for this page load (fail closed) — the app mounts anyway.
 *   2. `initSentry` — when ON, this is where Sentry wraps `window.fetch` and
 *      `XMLHttpRequest` with its standard instrumentation. It also closes the
 *      boot buffer (held startup errors sent on ON, dropped on OFF).
 *   3. Only then the app module graph is imported. `lib/api/native-fetch.ts`
 *      captures fetch/XHR at module load, so it captures Sentry's wrappers
 *      (breadcrumbs, spans, trace headers) instead of the pristine globals,
 *      and a throw while App's modules evaluate reaches a live client.
 *
 * A failed app import is reported (when ON) and the user still sees a minimal
 * message instead of a blank page. Keep this module's imports to the config
 * and types: everything it pulls in evaluates before the decision.
 */
import type { SystemStatusDto } from '@raid-ledger/contract';
import { API_BASE_URL } from './lib/config';

/** How long the telemetry decision may hold the first paint. */
export const STATUS_TIMEOUT_MS = 1500;

/** The lazily imported app half (app-entry.tsx). */
export interface AppEntry {
    mountApp: (status: SystemStatusDto | null) => void;
}

export interface BootSteps {
    loadStatus: (signal: AbortSignal) => Promise<SystemStatusDto>;
    initSentry: (serverEnabled: boolean | undefined) => boolean;
    loadApp: () => Promise<AppEntry>;
    reportFatal: (error: unknown, telemetryOn: boolean) => void;
}

/** GET /system/status with the browser's fetch (Sentry has not wrapped it yet). */
export async function fetchSystemStatus(signal: AbortSignal): Promise<SystemStatusDto> {
    const res = await fetch(`${API_BASE_URL}/system/status`, { credentials: 'include', signal });
    if (!res.ok) throw new Error(`system status ${res.status}`);
    return (await res.json()) as SystemStatusDto;
}

/** Resolve to the status, or null on failure or after `ms` (the request is aborted). */
export function statusWithin(
    load: BootSteps['loadStatus'],
    ms: number,
): Promise<SystemStatusDto | null> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<null>((resolve) => {
        timer = setTimeout(() => {
            controller.abort();
            resolve(null);
        }, ms);
    });
    const loaded = load(controller.signal).catch(() => null);
    return Promise.race([loaded, timedOut]).finally(() => clearTimeout(timer));
}

/** Decide telemetry, then import and mount the app. Never rejects. */
export async function bootstrap(steps: BootSteps, timeoutMs = STATUS_TIMEOUT_MS): Promise<void> {
    const status = await statusWithin(steps.loadStatus, timeoutMs);
    const telemetryOn = steps.initSentry(status?.telemetryEnabled);
    try {
        const app = await steps.loadApp();
        app.mountApp(status);
    } catch (error) {
        steps.reportFatal(error, telemetryOn);
    }
}

/** The no-React fallback when the app itself failed to load. */
export function renderBootFailure(root: HTMLElement | null): void {
    const host = root ?? document.body;
    const message = document.createElement('p');
    message.setAttribute('role', 'alert');
    message.textContent = 'Raid Ledger failed to load. Reload the page to try again.';
    host.replaceChildren(message);
}
