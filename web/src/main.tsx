// ROK-1366: capture + strip the magic-link fragment token BEFORE Sentry
// initialises, so it never reaches breadcrumbs, tracing or replay. This MUST
// stay the very first import (magic-link-capture.test.ts pins it).
import './lib/magic-link-capture';
// ROK-1366: third-party tooltips.js is injected (async) only now, after the
// strip above — never from index.html (magic-link-capture.test.ts pins it).
import './lib/wowhead-tooltips-loader';
// Sentry next — before any other modules.
// ROK-306: Maintainer telemetry for error tracking.
import { Sentry } from './sentry';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/query-client';
import { initPerformanceMonitoring } from './lib/performance';
import './index.css';
import App from './App.tsx';
import { ErrorFallback } from './components/ErrorFallback';

const root = createRoot(document.getElementById('root')!, {
  // React 19 error hooks — forward uncaught/caught/recoverable errors to Sentry.
  onUncaughtError: Sentry.reactErrorHandler(),
  onCaughtError: Sentry.reactErrorHandler(),
  onRecoverableError: Sentry.reactErrorHandler(),
});

// ROK-343: Web Vitals monitoring (FCP <1.8s, LCP <2.5s targets)
initPerformanceMonitoring();

root.render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={({ error }) => <ErrorFallback error={error} />}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
