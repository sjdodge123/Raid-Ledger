import { isChunkLoadError } from '../lib/chunk-error';
import { Button } from './ui/button';
import { ErrorDetails } from './common/error-details';

/**
 * The root boundary's fallback (app-entry.tsx) — only reached when the app shell
 * itself crashes; a page crash is caught in-shell by `RouteErrorBoundary`. Themed
 * through tokens (ROK-2342 C10); the raw message sits in "Technical details".
 */
export function ErrorFallback({ error }: { error: unknown }) {
  const isChunk = isChunkLoadError(error);
  const message = isChunk
    ? 'The app has been updated. Please reload to get the latest version.'
    : 'Something went wrong. Reload the page to try again.';

  return (
    <div role="alert" className="min-h-screen bg-backdrop px-4 py-16 text-center">
      <h1 className="text-xl font-semibold text-foreground">{isChunk ? 'New Version Available' : 'Something went wrong'}</h1>
      <p className="mt-2 text-sm text-muted">{message}</p>
      <Button
        variant="secondary"
        className="mt-6"
        // Leaves the auto-reload stamp alone: if the chunk still fails after
        // this reload, the page shows this screen again instead of looping.
        onClick={() => window.location.reload()}
      >
        Reload Page
      </Button>
      {!isChunk && <ErrorDetails error={error} />}
    </div>
  );
}
