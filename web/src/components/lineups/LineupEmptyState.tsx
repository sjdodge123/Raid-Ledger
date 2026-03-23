import type { JSX } from 'react';

export function LineupEmptyState(): JSX.Element {
  return (
    <div className="text-center py-12">
      <p className="text-muted text-sm">
        No nominations yet. Be the first to nominate a game!
      </p>
    </div>
  );
}
