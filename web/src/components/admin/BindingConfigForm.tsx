import { useState } from 'react';
import type { ChannelBindingDto, UpdateChannelBindingDto } from '@raid-ledger/contract';

interface BindingConfigFormProps {
  binding: ChannelBindingDto;
  onSave: (id: string, dto: UpdateChannelBindingDto) => void;
  onCancel: () => void;
  isSaving: boolean;
}

/**
 * Form for editing channel binding config (min players, grace period, auto-close).
 * Shown when a user clicks "Edit" on a binding row.
 */
export function BindingConfigForm({
  binding,
  onSave,
  onCancel,
  isSaving,
}: BindingConfigFormProps) {
  const [minPlayers, setMinPlayers] = useState(
    binding.config?.minPlayers ?? 2,
  );
  const [autoClose, setAutoClose] = useState(
    binding.config?.autoClose ?? true,
  );
  const [gracePeriod, setGracePeriod] = useState(
    binding.config?.gracePeriod ?? 300,
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(binding.id, {
      config: {
        minPlayers,
        autoClose,
        gracePeriod,
      },
    });
  };

  const isVoiceMonitor = binding.bindingPurpose === 'game-voice-monitor';

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4 bg-overlay/30 rounded-lg border border-border">
      <h4 className="text-sm font-medium text-foreground">
        Edit Config: #{binding.channelName ?? binding.channelId}
      </h4>

      {isVoiceMonitor && (
        <>
          <div>
            <label className="block text-xs text-muted mb-1">
              Minimum Players (to spawn ad-hoc event)
            </label>
            <input
              type="number"
              min={1}
              max={50}
              value={minPlayers}
              onChange={(e) => setMinPlayers(Number(e.target.value))}
              className="w-full px-3 py-2 bg-panel border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="autoClose"
              checked={autoClose}
              onChange={(e) => setAutoClose(e.target.checked)}
              className="rounded border-border bg-panel text-emerald-500 focus:ring-emerald-500/40"
            />
            <label htmlFor="autoClose" className="text-sm text-foreground">
              Auto-close event when voice empties
            </label>
          </div>

          <div>
            <label className="block text-xs text-muted mb-1">
              Grace Period (seconds before closing)
            </label>
            <input
              type="number"
              min={0}
              max={3600}
              step={30}
              value={gracePeriod}
              onChange={(e) => setGracePeriod(Number(e.target.value))}
              className="w-full px-3 py-2 bg-panel border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
            />
            <p className="text-xs text-muted mt-1">
              {gracePeriod >= 60
                ? `${Math.floor(gracePeriod / 60)}m ${gracePeriod % 60}s`
                : `${gracePeriod}s`}
            </p>
          </div>
        </>
      )}

      {!isVoiceMonitor && (
        <p className="text-sm text-muted">
          No additional configuration needed for announcement channels.
        </p>
      )}

      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          disabled={isSaving}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-sm transition-colors"
        >
          {isSaving ? 'Saving...' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 bg-overlay hover:bg-faint text-foreground rounded-lg text-sm transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
