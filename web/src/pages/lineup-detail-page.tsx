import { useState } from 'react';
import type { JSX } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useLineupDetail } from '../hooks/use-lineups';
import { LineupDetailHeader } from '../components/lineups/LineupDetailHeader';
import { NominationGrid } from '../components/lineups/NominationGrid';
import { VotingLeaderboard } from '../components/lineups/VotingLeaderboard';
import { LineupEmptyState } from '../components/lineups/LineupEmptyState';
import { LineupDetailSkeleton } from '../components/lineups/LineupDetailSkeleton';
import { CommonGroundPanel } from '../components/lineups/CommonGroundPanel';
import { NominateModal } from '../components/lineups/NominateModal';
import { PastLineups } from '../components/lineups/PastLineups';
import { ActivityTimeline } from '../components/common/ActivityTimeline';
import { SteamNudgeBanner } from '../components/lineups/SteamNudgeBanner';
import { useAuth } from '../hooks/use-auth';

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
  const { user } = useAuth();
  const [modalOpen, setModalOpen] = useState(false);

  if (isLoading) return <LineupDetailSkeleton />;
  if (error || !lineup) return <LineupNotFound />;

  const hasEntries = lineup.entries.length > 0;
  const isBuilding = lineup.status === 'building';

  return (
    <div className="max-w-4xl mx-auto px-4 py-4">
      <div className="flex items-start justify-between gap-4 mb-4">
        <LineupDetailHeader lineup={lineup} />
        {isBuilding && (
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="mt-1 px-4 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors flex-shrink-0"
          >
            Nominate
          </button>
        )}
      </div>

      <ActivityTimeline entityType="lineup" entityId={lineup.id} collapsible maxVisible={5} />

      {isBuilding && (
        <div className="mt-3">
          <SteamNudgeBanner lineupId={lineup.id} lineupStatus={lineup.status} userSteamId={user?.steamId ?? null} />
        </div>
      )}

      {lineup.status === 'building' && (
        <div className="mt-4">
          <CommonGroundPanel lineupId={lineup.id} />
        </div>
      )}

      {lineup.status === 'voting' && hasEntries ? (
        <VotingLeaderboard
          entries={lineup.entries}
          lineupId={lineup.id}
          myVotes={lineup.myVotes ?? []}
          totalVoters={lineup.totalVoters}
          totalMembers={lineup.totalMembers}
          maxVotesPerPlayer={lineup.maxVotesPerPlayer}
        />
      ) : hasEntries ? (
        <NominationGrid entries={lineup.entries} lineupId={lineup.id} />
      ) : (
        <LineupEmptyState />
      )}

      <PastLineups />

      {isBuilding && (
        <NominateModal isOpen={modalOpen} onClose={() => setModalOpen(false)} lineupId={lineup.id} />
      )}
    </div>
  );
}
