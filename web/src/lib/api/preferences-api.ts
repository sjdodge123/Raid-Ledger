import { fetchApi } from './fetch-api';

/** Fetch current user's preferences as a key-value map */
export async function getMyPreferences(): Promise<Record<string, unknown>> {
    const response = await fetchApi<{
        data: Record<string, unknown>;
    }>('/users/me/preferences');
    return response.data;
}

/**
 * Debounced preference batcher (ROK-666).
 * Coalesces rapid preference changes into a single PATCH request
 * after 800ms of inactivity. A batch still pending when the page is hidden
 * or unloaded is sent at once with `keepalive`, so a reload inside the
 * debounce window does not drop the write (Bearer auth rules out sendBeacon).
 */
const preferenceBatcher = (() => {
    let pending: Record<string, unknown> = {};
    let timer: ReturnType<typeof setTimeout> | null = null;
    let flushPromise: Promise<void> | null = null;
    let resolveFlush: (() => void) | null = null;
    let rejectFlush: ((err: unknown) => void) | null = null;
    let unloadBound = false;

    function flush(keepalive: boolean): void {
        if (timer) clearTimeout(timer);
        timer = null;
        const batch = pending;
        const resolve = resolveFlush;
        const reject = rejectFlush;
        pending = {};
        flushPromise = null;
        resolveFlush = null;
        rejectFlush = null;

        fetchApi('/users/me/preferences', {
            method: 'PATCH',
            body: JSON.stringify({ preferences: batch }),
            ...(keepalive ? { keepalive: true } : {}),
        }).then(
            () => resolve?.(),
            (err) => reject?.(err),
        );
    }

    function flushIfPending(): void {
        if (timer) flush(true);
    }

    function bindUnloadFlush(): void {
        if (unloadBound || typeof window === 'undefined') return;
        unloadBound = true;
        window.addEventListener('pagehide', flushIfPending);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') flushIfPending();
        });
    }

    return {
        queue(key: string, value: unknown): Promise<void> {
            bindUnloadFlush();
            pending[key] = value;
            if (timer) clearTimeout(timer);

            if (!flushPromise) {
                flushPromise = new Promise<void>((resolve, reject) => {
                    resolveFlush = resolve;
                    rejectFlush = reject;
                });
            }

            timer = setTimeout(() => flush(false), 800);
            return flushPromise;
        },
    };
})();

/**
 * Update a single user preference (upsert).
 * Calls are debounced and batched (ROK-666).
 */
export async function updatePreference(
    key: string,
    value: unknown,
): Promise<void> {
    return preferenceBatcher.queue(key, value);
}
