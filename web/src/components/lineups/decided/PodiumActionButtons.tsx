/**
 * Action buttons below the podium: "Create Event" and "Share to Discord" (ROK-989).
 * Create Event links to event creation with gameId context.
 * Share to Discord is disabled with "Coming soon" tooltip.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import type { LineupEntryResponseDto } from '@raid-ledger/contract';

interface PodiumActionButtonsProps {
  championEntry: LineupEntryResponseDto | undefined;
  lineupId: number;
}

/** Build the "Create Event" link target with query params. */
function buildCreateEventHref(
  gameId: number,
  lineupId: number,
): string {
  return `/events/new?gameId=${gameId}&from=lineup&lineupId=${lineupId}`;
}

/** Podium action buttons: Create Event link + disabled Share to Discord. */
export function PodiumActionButtons({
  championEntry,
  lineupId,
}: PodiumActionButtonsProps): JSX.Element {
  return (
    <div className="flex items-center gap-3 mt-4 justify-center">
      {championEntry && (
        <Link
          to={buildCreateEventHref(championEntry.gameId, lineupId)}
          className="px-4 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors"
        >
          Create Event
        </Link>
      )}
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
