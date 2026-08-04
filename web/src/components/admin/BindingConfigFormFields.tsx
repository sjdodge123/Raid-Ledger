import type { IgdbGameDto } from "@raid-ledger/contract";
import type { BindingPurpose, ChannelType } from "@raid-ledger/contract";
import { GameSearchInput } from "../events/game-search-input";

/** Purpose options a channel of each type may legally carry (ROK-1415 invariant). */
const PURPOSE_OPTIONS: Record<
  ChannelType,
  { value: BindingPurpose; label: string }[]
> = {
  voice: [
    { value: "game-voice-monitor", label: "Activity Monitor" },
    { value: "general-lobby", label: "General Lobby" },
  ],
  text: [{ value: "game-announcements", label: "Announcements" }],
};

export function GeneralLobbySection({
  allowJustChatting,
  onChange,
}: {
  allowJustChatting: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">
        General Lobby: games are auto-detected from Discord Rich Presence.
        Players can use{" "}
        <code className="text-foreground bg-overlay px-1 py-0.5 rounded">
          /playing
        </code>{" "}
        as a manual fallback.
      </p>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="allowJustChatting"
          checked={allowJustChatting}
          onChange={(e) => onChange(e.target.checked)}
          className="rounded border-edge bg-panel text-emerald-500 focus:ring-emerald-500/40"
        />
        <label htmlFor="allowJustChatting" className="text-sm text-foreground">
          Allow &quot;Just Chatting&quot; events (no game required)
        </label>
      </div>
    </div>
  );
}

export function VoiceMonitorFields({
  minPlayers,
  onMinPlayersChange,
  autoClose,
  onAutoCloseChange,
  gracePeriod,
  onGracePeriodChange,
}: {
  minPlayers: number;
  onMinPlayersChange: (v: number) => void;
  autoClose: boolean;
  onAutoCloseChange: (v: boolean) => void;
  gracePeriod: number;
  onGracePeriodChange: (v: number) => void;
}) {
  return (
    <>
      <div>
        <label className="block text-xs text-muted mb-1">
          Minimum Players (to spawn Quick Play event)
        </label>
        <input
          type="number"
          min={1}
          max={50}
          value={minPlayers}
          onChange={(e) => onMinPlayersChange(Number(e.target.value))}
          className="w-full px-3 py-2 bg-panel border border-edge rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
        />
      </div>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="autoClose"
          checked={autoClose}
          onChange={(e) => onAutoCloseChange(e.target.checked)}
          className="rounded border-edge bg-panel text-emerald-500 focus:ring-emerald-500/40"
        />
        <label htmlFor="autoClose" className="text-sm text-foreground">
          Auto-close event when voice empties
        </label>
      </div>
      <div>
        <label className="block text-xs text-muted mb-1">
          Grace Period (minutes before closing)
        </label>
        <input
          type="number"
          min={1}
          max={60}
          step={1}
          value={gracePeriod}
          onChange={(e) => onGracePeriodChange(Number(e.target.value))}
          className="w-full px-3 py-2 bg-panel border border-edge rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
        />
      </div>
    </>
  );
}

export function PurposeSelect({
  id,
  channelType,
  value,
  onChange,
}: {
  id: string;
  channelType: ChannelType;
  value: BindingPurpose;
  onChange: (v: BindingPurpose) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs text-muted mb-1">
        Purpose
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as BindingPurpose)}
        className="w-full px-3 py-2 bg-panel border border-edge rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
      >
        {PURPOSE_OPTIONS[channelType].map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <p className="text-[11px] text-muted mt-1">
        Voice + a game = Activity Monitor · Voice, no game = General Lobby ·
        Text = Announcements. The form won&apos;t let you save an invalid
        combination.
      </p>
    </div>
  );
}

export function InertHealBanner({ onConvert }: { onConvert: () => void }) {
  return (
    <div className="border border-red-500/40 bg-red-500/10 rounded-lg p-2 text-xs">
      <div className="text-red-200 font-medium">
        ⚠ This voice monitor has no game — Quick Play can never fire on it.
      </div>
      <div className="flex items-center justify-between gap-2 mt-1">
        <span className="text-red-300/80">
          Pick a game below, or convert to a General Lobby (any game,
          auto-detected).
        </span>
        <button
          type="button"
          onClick={onConvert}
          className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[11px] whitespace-nowrap"
        >
          Convert to General Lobby
        </button>
      </div>
    </div>
  );
}

export function GameField({
  id,
  value,
  onChange,
  autoFocus,
  violationMessage,
}: {
  id: string;
  value: IgdbGameDto | null;
  onChange: (g: IgdbGameDto | null) => void;
  autoFocus: boolean;
  violationMessage?: string;
}) {
  return (
    <div>
      <GameSearchInput
        id={id}
        value={value}
        onChange={onChange}
        autoFocus={autoFocus}
        error={violationMessage}
      />
    </div>
  );
}

export function FormActions({
  saveDisabled,
  isSaving,
  onCancel,
}: {
  saveDisabled: boolean;
  isSaving: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="flex gap-2 pt-2">
      <button
        type="submit"
        disabled={saveDisabled}
        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-sm transition-colors"
      >
        {isSaving ? "Saving..." : "Save"}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="px-4 py-2 bg-overlay hover:bg-faint text-foreground rounded-lg text-sm transition-colors"
      >
        Cancel
      </button>
    </div>
  );
}
