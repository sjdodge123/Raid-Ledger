/**
 * Action buttons below the podium (ROK-989).
 * Share to Discord is disabled with "Coming soon" tooltip.
 * Create Event removed — events are created via scheduling poll (ROK-965).
 */
import type { JSX } from 'react';

/** Podium action button: disabled Share to Discord. */
export function PodiumActionButtons(): JSX.Element {
  return (
    <div className="flex items-center gap-3 mt-4 justify-center">
      <button
        type="button"
        disabled
        title="Coming soon"
        className="px-4 py-2 text-sm font-medium bg-zinc-700 text-zinc-400 rounded-lg cursor-not-allowed"
      >
        Share to Discord
      </button>
    </div>
  );
}
