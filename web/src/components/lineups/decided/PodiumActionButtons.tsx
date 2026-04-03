/**
 * Action buttons below the podium (ROK-989, ROK-932).
 * Share to Discord copies the decided view URL to clipboard.
 * Create Event removed -- events are created via scheduling poll (ROK-965).
 */
import { useState, useCallback } from 'react';
import type { JSX } from 'react';
import { useParams } from 'react-router-dom';

/** Podium action button: copies the decided view URL to clipboard. */
export function PodiumActionButtons(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const url = `${window.location.origin}/community-lineup/${id ?? ''}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [id]);

  return (
    <div className="flex items-center gap-3 mt-4 justify-center">
      <button
        type="button"
        onClick={handleCopy}
        className="px-4 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors"
      >
        {copied ? 'Copied!' : 'Share'}
      </button>
    </div>
  );
}
