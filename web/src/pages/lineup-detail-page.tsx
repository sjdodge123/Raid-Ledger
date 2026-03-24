import { useState } from 'react';
import type { JSX } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { LineupDetailResponseDto } from '@raid-ledger/contract';
import { useLineupDetail, useTransitionLineupStatus } from '../hooks/use-lineups';
import { useAuth, isOperatorOrAdmin } from '../hooks/use-auth';
import { LineupDetailHeader } from '../components/lineups/LineupDetailHeader';
import { LineupProgressBar } from '../components/lineups/LineupProgressBar';
import { NominationGrid } from '../components/lineups/NominationGrid';
import { LineupEmptyState } from '../components/lineups/LineupEmptyState';
import { LineupDetailSkeleton } from '../components/lineups/LineupDetailSkeleton';
import { CommonGroundPanel } from '../components/lineups/CommonGroundPanel';
import { NominateModal } from '../components/lineups/NominateModal';
import { PastLineups } from '../components/lineups/PastLineups';
import { ActivityTimeline } from '../components/common/ActivityTimeline';
import { PhaseCountdown } from '../components/lineups/phase-countdown';
import { toast } from '../lib/toast';

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

const NEXT_STATUS: Record<string, string> = {
  building: 'voting',
  voting: 'decided',
  decided: 'archived',
};

function ForceAdvanceButton({ lineup }: { lineup: LineupDetailResponseDto }) {
  const transition = useTransitionLineupStatus();
  const nextStatus = NEXT_STATUS[lineup.status];
  if (!nextStatus) return null;

  async function handleClick() {
    try {
      const body: { status: string; decidedGameId?: number | null } = { status: nextStatus };
      if (nextStatus === 'decided') {
        body.decidedGameId = lineup.entries[0]?.gameId ?? null;
      }
      await transition.mutateAsync({ lineupId: lineup.id, body });
      toast.success(`Advanced to ${nextStatus}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to advance phase');
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={transition.isPending}
      className="px-3 py-1.5 text-xs font-medium text-amber-400 border border-amber-500/50 rounded-lg hover:bg-amber-500/10 transition-colors disabled:opacity-50"
    >
      {transition.isPending ? 'Advancing...' : 'Force Advance'}
    </button>
  );
}

function PhaseSection({ lineup }: { lineup: LineupDetailResponseDto }) {
  const { user } = useAuth();
  const canForce = isOperatorOrAdmin(user) && lineup.status !== 'archived';

  return (
    <div className="flex items-center gap-4 mt-3 mb-4">
      <div className="flex-1">
        <PhaseCountdown phaseDeadline={lineup.phaseDeadline} status={lineup.status} />
      </div>
      {canForce && <ForceAdvanceButton lineup={lineup} />}
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

      <PhaseSection lineup={lineup} />

      <div className="mb-4">
        <LineupProgressBar lineup={lineup} />
      </div>

      <ActivityTimeline entityType="lineup" entityId={lineup.id} collapsible maxVisible={5} />

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
        <NominateModal isOpen={modalOpen} onClose={() => setModalOpen(false)} lineupId={lineup.id} />
      )}
    </div>
  );
}
