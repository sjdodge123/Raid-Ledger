/**
 * ROK-1779: hold startup errors while the telemetry decision is pending.
 *
 * bootstrap.ts holds the app import while GET /system/status is in flight,
 * so an error thrown in that window (or by the entry's own modules) happens
 * before any Sentry client exists.
 * This module (no Sentry import — it only collects) buffers those errors:
 * window `error` / `unhandledrejection` listeners plus the root error
 * handlers and the ErrorBoundary push here. `closeBootBuffer()` ends the
 * window: sentry.ts flushes the drained entries into Sentry when telemetry
 * is ON and drops them when OFF. Nothing here sends anything.
 */
export interface PendingCapture {
    error: unknown;
    source: 'window-error' | 'unhandledrejection' | 'react-root' | 'error-boundary';
    componentStack?: string;
}

export const MAX_PENDING = 20;

let queue: PendingCapture[] = [];
let open = true;
let detach: (() => void) | null = null;

/**
 * Queue an error while the decision is pending. Returns false once the
 * buffer is closed (the caller then reports — or drops — it directly).
 * The same error object is queued once (a caught render error reaches both
 * React's root handler and the ErrorBoundary). Past MAX_PENDING the newest
 * errors are dropped; the earliest ones usually name the root cause.
 */
export function bufferCapture(entry: PendingCapture): boolean {
    if (!open) return false;
    const { error } = entry;
    const isObject = typeof error === 'object' && error !== null;
    if (isObject && queue.some((e) => e.error === error)) return true;
    if (queue.length < MAX_PENDING) queue.push(entry);
    return true;
}

function onWindowError(event: ErrorEvent): void {
    const error: unknown = event.error ?? event.message;
    if (error) bufferCapture({ error, source: 'window-error' });
}

function onRejection(event: PromiseRejectionEvent): void {
    bufferCapture({ error: event.reason, source: 'unhandledrejection' });
}

/** Start listening for global errors. Idempotent; a no-op once closed or without a window. */
export function installBootErrorBuffer(): void {
    if (!open || detach || typeof window === 'undefined') return;
    window.addEventListener('error', onWindowError);
    window.addEventListener('unhandledrejection', onRejection);
    detach = () => {
        window.removeEventListener('error', onWindowError);
        window.removeEventListener('unhandledrejection', onRejection);
    };
}

/** End the pending window: stop listening, stop queueing, hand back what was held. */
export function closeBootBuffer(): PendingCapture[] {
    open = false;
    detach?.();
    detach = null;
    const drained = queue;
    queue = [];
    return drained;
}
