import { useState, useCallback } from 'react';
import type { JSX } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useLineupDetail } from '../hooks/use-lineups';
import { useTiebreakerDetail } from '../hooks/use-tiebreaker';
import { LineupDetailHeader } from '../components/lineups/LineupDetailHeader';
import { NominationGrid } from '../components/lineups/NominationGrid';
import { VotingLeaderboard } from '../components/lineups/VotingLeaderboard';
import { LineupEmptyState } from '../components/lineups/LineupEmptyState';
import { LineupDetailSkeleton } from '../components/lineups/LineupDetailSkeleton';
import { CommonGroundPanel } from '../components/lineups/CommonGroundPanel';
import { NominateModal } from '../components/lineups/NominateModal';
import type { SelectedGame } from '../components/lineups/NominateModal';
import { PastLineups } from '../components/lineups/PastLineups';
import { DecidedView } from '../components/lineups/decided/DecidedView';
import { ActivityTimeline } from '../components/common/ActivityTimeline';
import { SteamNudgeBanner } from '../components/lineups/SteamNudgeBanner';
import { TiebreakerView } from '../components/lineups/tiebreaker/TiebreakerView';
import { TiebreakerPromptModal } from '../components/lineups/tiebreaker/TiebreakerPromptModal';
import { useAuth, isOperatorOrAdmin } from '../hooks/use-auth';
import { useSteamPasteDetection } from '../hooks/use-steam-paste';

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
  const { data: tiebreaker } = useTiebreakerDetail(lineupId);
  const { user } = useAuth();
  const [modalOpen, setModalOpen] = useState(false);
  const [preSelectedGame, setPreSelectedGame] = useState<SelectedGame | null>(null);
  const [promptDismissed, setPromptDismissed] = useState(false);
  const [tiebreakerPromptOpen, setTiebreakerPromptOpen] = useState(false);

  const isBuilding = !isLoading && !error && lineup?.status === 'building';

  const handleGameResolved = useCallback((game: SelectedGame) => {
    setPreSelectedGame(game);
    setModalOpen(true);
  }, []);

  useSteamPasteDetection({
    enabled: isBuilding,
    modalOpen,
    onGameResolved: handleGameResolved,
  });

  if (isLoading) return <LineupDetailSkeleton />;
  if (error || !lineup) return <LineupNotFound />;

  const hasEntries = lineup.entries.length > 0;
  const hasTiebreaker = lineup.status === 'voting' && tiebreaker && ['active', 'pending', 'resolved'].includes(tiebreaker.status);
  const isOperator = isOperatorOrAdmin(user);

  // Tiebreaker prompt: server-created pending tiebreaker OR operator tried to advance with ties
  const showPrompt = isOperator && !promptDismissed && (
    (hasTiebreaker && tiebreaker?.status === 'pending') || tiebreakerPromptOpen
  );

  return (
    <div className="max-w-4xl mx-auto px-4 py-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
        <LineupDetailHeader lineup={lineup} onTiebreakerIntercept={() => {
          setPromptDismissed(false);
          setTiebreakerPromptOpen(true);
        }} />
        {isBuilding && (
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="sm:mt-1 px-4 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors flex-shrink-0 w-full sm:w-auto"
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

      {hasTiebreaker && (tiebreaker?.status === 'active' || tiebreaker?.status === 'resolved') ? (
        <TiebreakerView tiebreaker={tiebreaker} lineupId={lineup.id} />
      ) : lineup.status === 'decided' ? (
        <DecidedView lineup={lineup} />
      ) : lineup.status === 'voting' && hasEntries ? (
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
        <NominateModal
          isOpen={modalOpen}
          onClose={() => { setModalOpen(false); setPreSelectedGame(null); }}
          lineupId={lineup.id}
          preSelectedGame={preSelectedGame}
        />
      )}

      {showPrompt && (
        <TiebreakerPromptModal
          lineupId={lineup.id}
          lineupTitle={lineup.title}
          tiebreaker={tiebreaker ?? null}
          onClose={() => { setPromptDismissed(true); setTiebreakerPromptOpen(false); }}
        />
      )}
    </div>
  );
}
