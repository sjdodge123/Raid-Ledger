import type { IgdbGameDto } from "@raid-ledger/contract";
import type { BindingPurpose, ChannelType } from "@raid-ledger/contract";
import {
  AUTO_CLOSE_HELP,
  BINDING_PURPOSE_LABELS,
  MIN_PLAYERS_CONSEQUENCE,
  MIN_PLAYERS_HELP,
  autoCloseLabel,
  minPlayersLabel,
} from "@raid-ledger/contract";
import { GameSearchInput } from "../events/game-search-input";

/**
 * Purpose options a channel of each type may legally carry (ROK-1415 invariant).
 * Labels come from the contract so the `/bind` reply and this select cannot
 * drift apart (ROK-1462 AC5).
 */
const PURPOSE_OPTIONS: Record<
  ChannelType,
  { value: BindingPurpose; label: string }[]
> = {
  voice: [
    {
      value: "game-voice-monitor",
      label: BINDING_PURPOSE_LABELS["game-voice-monitor"],
    },
    { value: "general-lobby", label: BINDING_PURPOSE_LABELS["general-lobby"] },
  ],
  text: [
    {
      value: "game-announcements",
      label: BINDING_PURPOSE_LABELS["game-announcements"],
    },
  ],
  forum: [
    { value: "lfg-board", label: BINDING_PURPOSE_LABELS["lfg-board"] },
  ],
};

const INPUT_CLASS =
  "w-full px-3 py-2 bg-panel border border-edge rounded-lg text-foreground " +
  "text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40";
const CHECKBOX_CLASS =
  "rounded border-edge bg-panel text-emerald-500 focus:ring-emerald-500/40";

/**
 * The minimum-players field. Purpose-aware because the threshold counts
 * different things per purpose (ROK-1445): a General Lobby counts a detected
 * game group, an Activity Monitor counts the channel.
 */
function MinPlayersField({
  purpose,
  minPlayers,
  onMinPlayersChange,
}: {
  purpose: BindingPurpose;
  minPlayers: number;
  onMinPlayersChange: (v: number) => void;
}) {
  const label = minPlayersLabel(purpose);
  return (
    <div>
      <label htmlFor="minPlayers" className="block text-xs text-muted mb-1">
        {label}
      </label>
      <input
        id="minPlayers"
        type="number"
        min={1}
        max={50}
        value={minPlayers}
        onChange={(e) => onMinPlayersChange(Number(e.target.value))}
        className={INPUT_CLASS}
      />
      <p className="text-[11px] text-muted mt-1">{MIN_PLAYERS_HELP[purpose]}</p>
      {purpose === "general-lobby" && (
        <p className="text-[11px] text-muted mt-1">{MIN_PLAYERS_CONSEQUENCE}</p>
      )}
    </div>
  );
}

/**
 * The auto-close toggle. ROK-1448 changed only the WORDS: closing has always
 * been per event group (`ad-hoc-event.service::handleVoiceLeave` resolves the
 * leaving member's event and waits for THAT group's member set to empty), and
 * the old "when voice empties" label described a channel-wide behaviour that
 * does not exist. The control itself is unchanged.
 */
function AutoCloseField({
  autoClose,
  onAutoCloseChange,
}: {
  autoClose: boolean;
  onAutoCloseChange: (v: boolean) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="autoClose"
          checked={autoClose}
          onChange={(e) => onAutoCloseChange(e.target.checked)}
          className={CHECKBOX_CLASS}
        />
        <label htmlFor="autoClose" className="text-sm text-foreground">
          {autoCloseLabel()}
        </label>
      </div>
      <p className="text-[11px] text-muted">{AUTO_CLOSE_HELP}</p>
    </div>
  );
}

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

/**
 * The voice-tuning settings for a monitor or lobby binding.
 *
 * @param props.purpose - Drives the threshold copy (ROK-1448 / ROK-1462 AC4).
 */
export function VoiceMonitorFields({
  purpose,
  minPlayers,
  onMinPlayersChange,
  autoClose,
  onAutoCloseChange,
  gracePeriod,
  onGracePeriodChange,
}: {
  purpose: BindingPurpose;
  minPlayers: number;
  onMinPlayersChange: (v: number) => void;
  autoClose: boolean;
  onAutoCloseChange: (v: boolean) => void;
  gracePeriod: number;
  onGracePeriodChange: (v: number) => void;
}) {
  return (
    <>
      <MinPlayersField
        purpose={purpose}
        minPlayers={minPlayers}
        onMinPlayersChange={onMinPlayersChange}
      />
      <AutoCloseField
        autoClose={autoClose}
        onAutoCloseChange={onAutoCloseChange}
      />
      <div>
        <label htmlFor="gracePeriod" className="block text-xs text-muted mb-1">
          Grace Period (minutes before closing)
        </label>
        <input
          id="gracePeriod"
          type="number"
          min={1}
          max={60}
          step={1}
          value={gracePeriod}
          onChange={(e) => onGracePeriodChange(Number(e.target.value))}
          className={INPUT_CLASS}
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
