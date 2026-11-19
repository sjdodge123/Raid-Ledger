/**
 * ROK-1901: warm the chunks that left app-entry — the event routes and the
 * More drawer's content — once the first route has rendered (App mounts
 * `PrefetchAfterFirstRoute` inside the route Suspense) and the main thread is
 * idle, so they never compete with StartupGate or the first page's own load.
 * Skipped under Data Saver and for logged-out visitors (no auth-method marker —
 * the same marker boot-session uses to decide whether there is a session to
 * restore, so a signed-in user always has it by now). Runs once per page load;
 * failures stay silent.
 */
import { prefetchEventRoutes } from './lazy-routes';
import { getAuthMethod } from './lib/api/silent-reauth';
import { prefetchMoreDrawerContent } from './components/layout/more-drawer-chunks';

let started = false;

function prefersSaveData(): boolean {
    const connection: unknown = Reflect.get(navigator, 'connection');
    return typeof connection === 'object' && connection !== null
        && 'saveData' in connection && connection.saveData === true;
}

export function prefetchDeferredChunksOnIdle(): void {
    if (started || prefersSaveData() || getAuthMethod() === null) return;
    started = true;
    const run = () => {
        prefetchEventRoutes();
        prefetchMoreDrawerContent();
    };
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run, { timeout: 5000 });
    else window.setTimeout(run, 2000);
}

/** Test seam: forget that the prefetch already ran. */
export function resetIdlePrefetchForTests(): void {
    started = false;
}
