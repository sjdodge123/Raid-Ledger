/**
 * Admin panel for configuring default lineup phase durations (ROK-946).
 */
import { useState } from 'react';
import { useLineupSettings } from '../../hooks/admin/use-lineup-settings';
import { toast } from '../../lib/toast';

const MIN_DAYS = 1;
const MAX_DAYS = 30;

function DurationSlider({ label, name, testId, value, onChange }: {
  label: string;
  name: string;
  testId: string;
  value: number;
  onChange: (v: number) => void;
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

function usePanelState() {
  const { lineupDefaults, updateDefaults } = useLineupSettings();
  const defaults = lineupDefaults.data;

  const [building, setBuilding] = useState<number | null>(null);
  const [voting, setVoting] = useState<number | null>(null);
  const [decided, setDecided] = useState<number | null>(null);

  const bVal = building ?? defaults?.buildingDurationHours ?? 48;
  const vVal = voting ?? defaults?.votingDurationHours ?? 24;
  const dVal = decided ?? defaults?.decidedDurationHours ?? 72;

  return {
    isLoading: lineupDefaults.isLoading,
    building: bVal,
    voting: vVal,
    decided: dVal,
    setBuilding,
    setVoting,
    setDecided,
    updateDefaults,
  };
}

export function LineupDefaultsPanel() {
  const state = usePanelState();

  async function handleSave() {
    try {
      await state.updateDefaults.mutateAsync({
        buildingDurationHours: state.building,
        votingDurationHours: state.voting,
        decidedDurationHours: state.decided,
      });
      toast.success('Lineup phase durations updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    }
  }

  if (state.isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-foreground">
            Lineup Phase Durations
          </h2>
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-overlay rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">
          Lineup Phase Durations
        </h2>
        <p className="text-sm text-muted mt-1">
          Default durations for each lineup phase. These are used when creating
          new lineups unless overridden at creation time.
        </p>
      </div>
      <div className="bg-panel/50 rounded-xl border border-edge/50 p-6 space-y-4">
        <DurationSlider
          label="Building Phase"
          name="buildingDurationHours"
          testId="default-building-duration"
          value={state.building}
          onChange={(v) => state.setBuilding(v)}
        />
        <DurationSlider
          label="Voting Phase"
          name="votingDurationHours"
          testId="default-voting-duration"
          value={state.voting}
          onChange={(v) => state.setVoting(v)}
        />
        <DurationSlider
          label="Decided Phase"
          name="decidedDurationHours"
          testId="default-decided-duration"
          value={state.decided}
          onChange={(v) => state.setDecided(v)}
        />
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={state.updateDefaults.isPending}
          className="px-4 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors disabled:opacity-50"
        >
          {state.updateDefaults.isPending ? 'Saving...' : 'Save Defaults'}
        </button>
      </div>
    </div>
  );
}
