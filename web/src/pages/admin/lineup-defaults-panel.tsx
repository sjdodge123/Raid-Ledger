/**
 * Admin panel for configuring default lineup phase durations (ROK-946).
 */
import { useState } from 'react';
import { useLineupSettings } from '../../hooks/admin/use-lineup-settings';
import { toast } from '../../lib/toast';

function DurationField({ label, name, testId, value, onChange }: {
  label: string;
  name: string;
  testId: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-secondary mb-1">
        {label}
      </label>
      <input
        type="number"
        name={name}
        data-testid={testId}
        min={1}
        max={720}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full sm:max-w-xs px-4 py-3 min-h-[44px] bg-surface/50 border border-edge rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors"
      />
      <p className="text-xs text-muted mt-1">
        {Math.floor(value / 24)} days, {value % 24} hours
      </p>
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
        <DurationField
          label="Building Phase (hours)"
          name="buildingDurationHours"
          testId="default-building-duration"
          value={state.building}
          onChange={(v) => state.setBuilding(v)}
        />
        <DurationField
          label="Voting Phase (hours)"
          name="votingDurationHours"
          testId="default-voting-duration"
          value={state.voting}
          onChange={(v) => state.setVoting(v)}
        />
        <DurationField
          label="Decided Phase (hours)"
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
