import type { JSX } from 'react';
import type { LineupDetailResponseDto, LineupStatusDto } from '@raid-ledger/contract';
import { useAuth, isOperatorOrAdmin } from '../../hooks/use-auth';

interface Props {
  lineup: LineupDetailResponseDto;
}

const PHASES: LineupStatusDto[] = ['building', 'voting', 'scheduling', 'decided', 'archived'];
const PHASE_LABELS: Record<LineupStatusDto, string> = {
  building: 'Nominating',
  voting: 'Voting',
  scheduling: 'Scheduling',
  decided: 'Decided',
  archived: 'Archived',
};

function phaseIndex(status: string): number {
  return PHASES.indexOf(status as LineupStatusDto);
}

function PhaseSteps({ status }: { status: string }): JSX.Element {
  const current = phaseIndex(status);
  return (
    <div className="flex items-center gap-1">
      {PHASES.map((phase, i) => (
        <div key={phase} className="flex items-center gap-1">
          <div
            className={`h-1.5 rounded-full transition-all ${
              i <= current ? 'bg-emerald-500 w-12' : 'bg-panel border border-edge w-12'
            }`}
          />
          {i < PHASES.length - 1 && <div className="w-1" />}
        </div>
      ))}
    </div>
  );
}

function BuildingInfo({ lineup }: Props): JSX.Element {
  const { user } = useAuth();
  const count = lineup.entries.length;
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-dim">
        {count} / 20 nominated
      </span>
      {user && isOperatorOrAdmin(user) && (
        <span className="text-xs text-emerald-400 font-medium cursor-pointer hover:underline">
          Start Voting →
        </span>
      )}
    </div>
  );
}

function VotingInfo({ lineup }: Props): JSX.Element {
  const total = lineup.totalMembers ?? 0;
  return (
    <span className="text-xs text-dim">
      {lineup.totalVoters} of {total} members voted
    </span>
  );
}

function DecidedInfo({ lineup }: Props): JSX.Element {
  return (
    <span className="text-xs text-dim">
      Winner: {lineup.decidedGameName ?? 'TBD'}
    </span>
  );
}

export function LineupProgressBar({ lineup }: Props): JSX.Element {
  const current = phaseIndex(lineup.status);
  const label = PHASE_LABELS[lineup.status as LineupStatusDto] ?? lineup.status;

  return (
    <div className="rounded-lg border border-edge bg-surface p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-secondary font-medium">{label}</span>
        <span className="text-[11px] text-dim">
          {PHASES.map((p, i) => (
            <span key={p} className={i === current ? 'text-emerald-400 font-medium' : ''}>
              {i > 0 && ' → '}{PHASE_LABELS[p]}
            </span>
          ))}
        </span>
      </div>
      <PhaseSteps status={lineup.status} />
      <div className="mt-2">
        {lineup.status === 'building' && <BuildingInfo lineup={lineup} />}
        {lineup.status === 'voting' && <VotingInfo lineup={lineup} />}
        {lineup.status === 'decided' && <DecidedInfo lineup={lineup} />}
      </div>
    </div>
  );
}
