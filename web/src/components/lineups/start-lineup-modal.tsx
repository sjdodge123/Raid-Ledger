/**
 * Start Lineup modal with configurable duration fields (ROK-946).
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '../ui/modal';
import { useCreateLineup } from '../../hooks/use-lineups';
import { useLineupSettings } from '../../hooks/admin/use-lineup-settings';
import { toast } from '../../lib/toast';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

function useDurationState() {
  const { lineupDefaults } = useLineupSettings();
  const defaults = lineupDefaults.data;
  const [building, setBuilding] = useState<number | ''>('');
  const [voting, setVoting] = useState<number | ''>('');
  const [matchThreshold, setMatchThreshold] = useState<number>(35);
  const [votesPerPlayer, setVotesPerPlayer] = useState<number>(3);
  const [tiebreakerMode, setTiebreakerMode] = useState<'bracket' | 'veto' | null>('bracket');
  const buildingVal = building === '' ? (defaults?.buildingDurationHours ?? 48) : building;
  const votingVal = voting === '' ? (defaults?.votingDurationHours ?? 24) : voting;

  return {
    building: buildingVal,
    voting: votingVal,
    matchThreshold,
    votesPerPlayer,
    tiebreakerMode,
    setBuilding,
    setVoting,
    setMatchThreshold,
    setVotesPerPlayer,
    setTiebreakerMode,
    isLoading: lineupDefaults.isLoading,
  };
}

const MIN_DAYS = 1;
const MAX_DAYS = 30;

function DurationSlider({ label, name, testId, value, onChange }: {
  label: string;
  name: string;
  testId: string;
  value: number;
  onChange: (v: number | '') => void;
}) {
  const days = Math.round(value / 24) || 1;
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-secondary">{label}</label>
        <span className="text-sm text-muted tabular-nums">
          {days} {days === 1 ? 'day' : 'days'}
        </span>
      </div>
      <input
        type="range"
        name={name}
        data-testid={testId}
        min={MIN_DAYS}
        max={MAX_DAYS}
        step={1}
        value={days}
        onChange={(e) => onChange(Number(e.target.value) * 24)}
        className="w-full h-2 bg-surface/50 rounded-lg appearance-none cursor-pointer accent-emerald-500"
      />
      <div className="flex justify-between text-xs text-muted/60 mt-1">
        <span>1 day</span>
        <span>30 days</span>
      </div>
    </div>
  );
}

function VotesPerPlayerSlider({ value, onChange }: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-secondary">Votes per Player</label>
        <span className="text-sm text-muted tabular-nums">{value}</span>
      </div>
      <input
        type="range"
        data-testid="votes-per-player"
        min={1}
        max={10}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-2 bg-surface/50 rounded-lg appearance-none cursor-pointer accent-emerald-500"
      />
      <div className="flex justify-between text-xs text-muted/60 mt-1">
        <span>1 vote</span>
        <span>10 votes</span>
      </div>
    </div>
  );
}

function ThresholdSlider({ value, onChange }: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-secondary">Match Threshold</label>
        <span className="text-sm text-muted tabular-nums">{value}%</span>
      </div>
      <input
        type="range"
        data-testid="match-threshold"
        min={0}
        max={100}
        step={5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-2 bg-surface/50 rounded-lg appearance-none cursor-pointer accent-emerald-500"
      />
      <div className="flex justify-between text-xs text-muted/60 mt-1">
        <span>More matches</span>
        <span>Fewer, larger matches</span>
      </div>
    </div>
  );
}

export function StartLineupModal({ isOpen, onClose }: Props) {
  const navigate = useNavigate();
  const createLineup = useCreateLineup();
  const durations = useDurationState();

  async function handleSubmit() {
    try {
      const result = await createLineup.mutateAsync({
        buildingDurationHours: durations.building,
        votingDurationHours: durations.voting,
        matchThreshold: durations.matchThreshold,
        votesPerPlayer: durations.votesPerPlayer,
        defaultTiebreakerMode: durations.tiebreakerMode,
      });
      onClose();
      navigate(`/community-lineup/${result.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create lineup');
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Start Community Lineup">
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Configure the duration for each phase. The lineup will automatically
          advance through phases when time expires.
        </p>
        <DurationSlider
          label="Building Phase"
          name="buildingDurationHours"
          testId="building-duration"
          value={durations.building}
          onChange={durations.setBuilding}
        />
        <DurationSlider
          label="Voting Phase"
          name="votingDurationHours"
          testId="voting-duration"
          value={durations.voting}
          onChange={durations.setVoting}
        />
        <div className="border-t border-edge/30 pt-4">
          <ThresholdSlider
            value={durations.matchThreshold}
            onChange={durations.setMatchThreshold}
          />
        </div>
        <VotesPerPlayerSlider
          value={durations.votesPerPlayer}
          onChange={durations.setVotesPerPlayer}
        />
        <div className="border-t border-edge/30 pt-4">
          <label className="text-sm font-medium text-secondary">Tiebreaker Mode</label>
          <p className="text-xs text-muted mb-2">Used when voting produces tied games at deadline.</p>
          <div className="flex gap-2">
            {([['bracket', 'Bracket'], ['veto', 'Veto'], [null, 'None']] as const).map(([val, label]) => (
              <button
                key={String(val)}
                type="button"
                onClick={() => durations.setTiebreakerMode(val as 'bracket' | 'veto' | null)}
                className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
                  durations.tiebreakerMode === val
                    ? 'bg-emerald-600/20 border-emerald-500/50 text-emerald-400'
                    : 'bg-panel border-edge text-muted hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-secondary bg-panel border border-edge rounded-lg hover:bg-overlay transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={createLineup.isPending}
            className="px-4 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors disabled:opacity-50"
          >
            {createLineup.isPending ? 'Creating...' : 'Create Lineup'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
