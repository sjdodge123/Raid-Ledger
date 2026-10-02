// Sentry MUST be imported first — before any other modules.
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

const reportToSentry = Sentry.reactErrorHandler();
// React hands an absent componentStack as `undefined`; Sentry's ErrorInfo wants the key omitted.
const forwardToSentry = (error: unknown, { componentStack }: { componentStack?: string | undefined }) =>
  reportToSentry(error, componentStack === undefined ? {} : { componentStack });

const root = createRoot(document.getElementById('root')!, {
  // React 19 error hooks — forward uncaught/caught/recoverable errors to Sentry.
  onUncaughtError: forwardToSentry,
  onCaughtError: forwardToSentry,
  onRecoverableError: forwardToSentry,
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
