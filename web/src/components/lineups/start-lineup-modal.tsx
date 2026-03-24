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
  const [decided, setDecided] = useState<number | ''>('');

  const buildingVal = building === '' ? (defaults?.buildingDurationHours ?? 48) : building;
  const votingVal = voting === '' ? (defaults?.votingDurationHours ?? 24) : voting;
  const decidedVal = decided === '' ? (defaults?.decidedDurationHours ?? 72) : decided;

  return {
    building: buildingVal,
    voting: votingVal,
    decided: decidedVal,
    setBuilding,
    setVoting,
    setDecided,
    isLoading: lineupDefaults.isLoading,
  };
}

function DurationInput({ label, name, testId, value, onChange }: {
  label: string;
  name: string;
  testId: string;
  value: number;
  onChange: (v: number | '') => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-secondary mb-1">{label}</label>
      <input
        type="number"
        name={name}
        data-testid={testId}
        min={1}
        max={720}
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === '' ? '' : Number(v));
        }}
        className="w-full px-3 py-2 bg-surface/50 border border-edge rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
      />
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
        decidedDurationHours: durations.decided,
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
        <DurationInput
          label="Building Phase (hours)"
          name="buildingDurationHours"
          testId="building-duration"
          value={durations.building}
          onChange={durations.setBuilding}
        />
        <DurationInput
          label="Voting Phase (hours)"
          name="votingDurationHours"
          testId="voting-duration"
          value={durations.voting}
          onChange={durations.setVoting}
        />
        <DurationInput
          label="Decided Phase (hours)"
          name="decidedDurationHours"
          testId="decided-duration"
          value={durations.decided}
          onChange={durations.setDecided}
        />
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
