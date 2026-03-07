import { CHUNK_RELOAD_KEY } from '../App';

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

export function ErrorFallback({ error }: { error: unknown }) {
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
