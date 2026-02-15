// Sentry MUST be imported first — before any other modules.
// ROK-306: Maintainer telemetry for error tracking.
import { Sentry } from './sentry';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/query-client';
import './index.css';
import App from './App.tsx';

const root = createRoot(document.getElementById('root')!, {
  // React 19 error hooks — forward uncaught/caught/recoverable errors to Sentry.
  onUncaughtError: Sentry.reactErrorHandler(),
  onCaughtError: Sentry.reactErrorHandler(),
  onRecoverableError: Sentry.reactErrorHandler(),
});

root.render(
  <StrictMode>
    <Sentry.ErrorBoundary
      fallback={({ error }) => (
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <h1>Something went wrong</h1>
          <p style={{ color: '#888', marginTop: '0.5rem' }}>
            {error instanceof Error ? error.message : 'An unexpected error occurred'}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: '1rem',
              padding: '0.5rem 1rem',
              borderRadius: '0.5rem',
              border: '1px solid #444',
              cursor: 'pointer',
            }}
          >
            Reload Page
          </button>
        </div>
      )}
    >
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
