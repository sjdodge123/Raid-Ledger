// Sentry MUST be imported first — before any other modules.
// ROK-306: Maintainer telemetry for error tracking.
import { Sentry } from './sentry';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/query-client';
import { initPerformanceMonitoring } from './lib/performance';
import './index.css';
import App, { CHUNK_RELOAD_KEY } from './App.tsx';

const root = createRoot(document.getElementById('root')!, {
  // React 19 error hooks — forward uncaught/caught/recoverable errors to Sentry.
  onUncaughtError: Sentry.reactErrorHandler(),
  onCaughtError: Sentry.reactErrorHandler(),
  onRecoverableError: Sentry.reactErrorHandler(),
});

// ROK-343: Web Vitals monitoring (FCP <1.8s, LCP <2.5s targets)
initPerformanceMonitoring();

function isChunkError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (/dynamically imported module/i.test(error.message) ||
      /failed to fetch/i.test(error.message) ||
      /loading (?:css )?chunk/i.test(error.message))
  );
}

const reloadBtnStyle = {
  marginTop: '1rem',
  padding: '0.5rem 1rem',
  borderRadius: '0.5rem',
  border: '1px solid #444',
  cursor: 'pointer',
} as const;

function ErrorFallback({ error }: { error: unknown }) {
  const isChunk = isChunkError(error);
  const message = isChunk
    ? 'The app has been updated. Please reload to get the latest version.'
    : error instanceof Error
      ? error.message
      : 'An unexpected error occurred';

  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <h1>{isChunk ? 'New Version Available' : 'Something went wrong'}</h1>
      <p style={{ color: '#888', marginTop: '0.5rem' }}>{message}</p>
      <button
        onClick={() => {
          sessionStorage.removeItem(CHUNK_RELOAD_KEY);
          window.location.reload();
        }}
        style={reloadBtnStyle}
      >
        Reload Page
      </button>
    </div>
  );
}

root.render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={({ error }) => <ErrorFallback error={error} />}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
