/**
 * ROK-1779 (Codex r6): the app half of the boot. main.tsx imports this module
 * dynamically, only AFTER the telemetry decision (see bootstrap.ts), so every
 * module below evaluates with Sentry already initialised when telemetry is ON
 * — `lib/api/native-fetch.ts` then captures Sentry's fetch/XHR wrappers.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import type { SystemStatusDto } from '@raid-ledger/contract';
import { queryClient } from './lib/query-client';
import { initPerformanceMonitoring } from './lib/performance';
import './index.css';
import App from './App';
import { ErrorFallback } from './components/ErrorFallback';
import { systemStatusQueryOptions } from './hooks/use-system-status';
import { Sentry, bufferBoundaryError, captureReactError } from './sentry';
// ROK-1366 / ROK-1754: third-party tooltips.js is injected only now — after
// the fragment strip (main.tsx's first import) AND after App's graph above
// ran native-fetch.ts, so it can never patch fetch/XHR before the capture.
// Keep it the last import (magic-link-capture.test.ts pins it).
import './lib/wowhead-tooltips-loader';

/** Mount React. `status` (null on a failed/timed-out fetch) seeds the query cache. */
export function mountApp(status: SystemStatusDto | null): void {
    const container = document.getElementById('root');
    if (!container) throw new Error('#root element missing');
    if (status) queryClient.setQueryData(systemStatusQueryOptions.queryKey, status);

    const root = createRoot(container, {
        // React 19 error hooks — forward uncaught/caught/recoverable errors to Sentry.
        onUncaughtError: captureReactError,
        onCaughtError: captureReactError,
        onRecoverableError: captureReactError,
    });

    // ROK-343: Web Vitals monitoring (FCP <1.8s, LCP <2.5s targets)
    initPerformanceMonitoring();

    root.render(
        <StrictMode>
            <Sentry.ErrorBoundary
                fallback={({ error }) => <ErrorFallback error={error} />}
                onError={bufferBoundaryError}
            >
                <QueryClientProvider client={queryClient}>
                    <App />
                </QueryClientProvider>
            </Sentry.ErrorBoundary>
        </StrictMode>,
    );
}
