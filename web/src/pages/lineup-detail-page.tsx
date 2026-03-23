import { useState } from 'react';
import type { JSX } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useLineupDetail } from '../hooks/use-lineups';
import { LineupDetailHeader } from '../components/lineups/LineupDetailHeader';
import { LineupProgressBar } from '../components/lineups/LineupProgressBar';
import { NominationGrid } from '../components/lineups/NominationGrid';
import { LineupEmptyState } from '../components/lineups/LineupEmptyState';
import { LineupDetailSkeleton } from '../components/lineups/LineupDetailSkeleton';
import { CommonGroundPanel } from '../components/lineups/CommonGroundPanel';
import { NominateModal } from '../components/lineups/NominateModal';
import { PastLineups } from '../components/lineups/PastLineups';
import { ActivityTimeline } from '../components/common/ActivityTimeline';

function LineupNotFound(): JSX.Element {
  return (
    <div className="max-w-4xl mx-auto px-4 py-12 text-center">
      <p className="text-muted mb-4">Lineup not found.</p>
      <Link to="/games" className="text-emerald-400 hover:underline text-sm">
        Back to Games
      </Link>
    </div>
  );
}

export function LineupDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const lineupId = id ? parseInt(id, 10) : undefined;
  const { data: lineup, isLoading, error } = useLineupDetail(lineupId);
  const [modalOpen, setModalOpen] = useState(false);

  if (isLoading) return <LineupDetailSkeleton />;
  if (error || !lineup) return <LineupNotFound />;

  const hasEntries = lineup.entries.length > 0;
  const isBuilding = lineup.status === 'building';

  return (
    <div className="max-w-4xl mx-auto px-4 py-4">
      <div className="flex items-start justify-between">
        <LineupDetailHeader lineup={lineup} />
        {isBuilding && (
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="px-4 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors flex-shrink-0"
          >
            Nominate
          </button>
        )}
      </div>

      <div className="mt-3 mb-4">
        <LineupProgressBar lineup={lineup} />
      </div>

      <ActivityTimeline
        entityType="lineup"
        entityId={lineup.id}
        collapsible
        maxVisible={5}
      />

      {lineup.status === 'building' && (
        <div className="mt-4">
          <CommonGroundPanel lineupId={lineup.id} />
        </div>
      )}

      {hasEntries ? (
        <NominationGrid entries={lineup.entries} lineupId={lineup.id} />
      ) : (
        <LineupEmptyState />
      )}

      <PastLineups />

      {isBuilding && (
        <NominateModal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          lineupId={lineup.id}
        />
      )}
    </div>
  );
}
