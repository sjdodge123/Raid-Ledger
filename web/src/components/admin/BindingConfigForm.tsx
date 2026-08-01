import { useState } from "react";
import type {
  ChannelBindingDto,
  IgdbGameDto,
  UpdateChannelBindingDto,
} from "@raid-ledger/contract";
import {
  classifyBindingTriple,
  deriveBindingPurpose,
  type BindingPurpose,
  type ChannelType,
} from "@raid-ledger/contract";
import { GameSearchInput } from "../events/game-search-input";

interface BindingConfigFormProps {
  binding: ChannelBindingDto;
  onSave: (id: string, dto: UpdateChannelBindingDto) => void;
  onCancel: () => void;
  isSaving: boolean;
  /** ROK-1416: a rejected PATCH (400/409) surfaced above the actions; the form stays open. */
  saveError?: string | null;
}

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

interface ConfigValues {
  minPlayers: number;
  autoClose: boolean;
  gracePeriod: number;
  allowJustChatting: boolean;
}

/** AC5 — only emit config keys the resolved purpose actually uses. */
function configForPurpose(
  purpose: BindingPurpose,
  v: ConfigValues,
): UpdateChannelBindingDto["config"] {
  if (purpose === "game-announcements") return {};
  return {
    minPlayers: v.minPlayers,
    autoClose: v.autoClose,
    gracePeriod: v.gracePeriod,
    ...(purpose === "general-lobby" && {
      allowJustChatting: v.allowJustChatting,
    }),
  };
}

function toInitialGame(binding: ChannelBindingDto): IgdbGameDto | null {
  if (binding.gameId == null) return null;
  return {
    id: binding.gameId,
    igdbId: null,
    name: binding.gameName ?? `Game #${binding.gameId}`,
    slug: "",
    coverUrl: null,
  };
}

function GeneralLobbySection({
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

function VoiceMonitorFields({
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

function PurposeSelect({
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

function InertHealBanner({ onConvert }: { onConvert: () => void }) {
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

function GameField({
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

function useBindingConfigForm(binding: ChannelBindingDto) {
  const [purpose, setPurpose] = useState<BindingPurpose>(
    binding.bindingPurpose,
  );
  const [game, setGame] = useState<IgdbGameDto | null>(() =>
    toInitialGame(binding),
  );
  const [minPlayers, setMinPlayers] = useState(binding.config?.minPlayers ?? 2);
  const [autoClose, setAutoClose] = useState(binding.config?.autoClose ?? true);
  const [gracePeriod, setGracePeriod] = useState(
    binding.config?.gracePeriod ?? 5,
  );
  const [allowJustChatting, setAllowJustChatting] = useState(
    binding.config?.allowJustChatting ?? false,
  );

  const channelType = binding.channelType;
  const gameId = game?.id ?? null;
  const violation = classifyBindingTriple(channelType, purpose, gameId);
  const gameRequired = violation?.code === "BINDING_MONITOR_REQUIRES_GAME";

  // Clearing the game auto-derives the purpose (voice → General Lobby) so the
  // triple stays valid without the operator touching the purpose select (AC6).
  const handleGameChange = (next: IgdbGameDto | null) => {
    setGame(next);
    if (next == null) setPurpose(deriveBindingPurpose(channelType, null));
  };

  const buildDto = (finalPurpose: BindingPurpose): UpdateChannelBindingDto => {
    const dto: UpdateChannelBindingDto = {
      config: configForPurpose(finalPurpose, {
        minPlayers,
        autoClose,
        gracePeriod,
        allowJustChatting,
      }),
    };
    if (finalPurpose !== binding.bindingPurpose)
      dto.bindingPurpose = finalPurpose;
    // Codex P2: saving as General Lobby CLEARS the game explicitly — the
    // field is hidden for lobbies, so a silently-kept game would be
    // uneditable and contradict the form copy ("Voice, no game = lobby").
    const effectiveGameId = finalPurpose === "general-lobby" ? null : gameId;
    if (effectiveGameId !== (binding.gameId ?? null))
      dto.gameId = effectiveGameId;
    return dto;
  };

  return {
    purpose,
    setPurpose,
    game,
    handleGameChange,
    gameRequired,
    violation,
    channelType,
    gameId,
    buildDto,
    minPlayers,
    setMinPlayers,
    autoClose,
    setAutoClose,
    gracePeriod,
    setGracePeriod,
    allowJustChatting,
    setAllowJustChatting,
  };
}

function FormActions({
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

/**
 * Edit a channel binding's purpose, game, and config (ROK-1416). Purpose is
 * channelType-filtered; the game picker shows for a voice Activity Monitor and
 * hides for General Lobby. A shared classifier gates Save on every render so the
 * form structurally cannot save the inert (voice monitor, no game) triple — it
 * offers a one-click "Convert to General Lobby" repair instead.
 */
export function BindingConfigForm({
  binding,
  onSave,
  onCancel,
  isSaving,
  saveError,
}: BindingConfigFormProps) {
  const f = useBindingConfigForm(binding);
  // The game maps to a purpose for a monitor / announcement channel; a General
  // Lobby auto-detects it, so the field is hidden there (wireframe B1).
  const showGameField = f.purpose !== "general-lobby";
  const showVoiceFields =
    f.purpose === "game-voice-monitor" || f.purpose === "general-lobby";
  const saveDisabled = isSaving || f.gameRequired;
  const purposeId = `binding-purpose-${binding.id}`;
  const gameFieldId = `binding-game-${binding.id}`;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(binding.id, f.buildDto(f.purpose));
  };
  const handleConvert = () => {
    f.setPurpose("general-lobby");
    onSave(binding.id, f.buildDto("general-lobby"));
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 p-4 bg-overlay/30 rounded-lg border border-edge"
    >
      <h4 className="text-sm font-medium text-foreground">
        Edit Config: #{binding.channelName ?? binding.channelId}
      </h4>
      {f.gameRequired && <InertHealBanner onConvert={handleConvert} />}
      <PurposeSelect
        id={purposeId}
        channelType={f.channelType}
        value={f.purpose}
        onChange={f.setPurpose}
      />
      {showGameField && (
        <GameField
          id={gameFieldId}
          value={f.game}
          onChange={f.handleGameChange}
          autoFocus={f.gameRequired}
          violationMessage={f.gameRequired ? f.violation?.message : undefined}
        />
      )}
      {f.purpose === "general-lobby" && (
        <GeneralLobbySection
          allowJustChatting={f.allowJustChatting}
          onChange={f.setAllowJustChatting}
        />
      )}
      {showVoiceFields && (
        <VoiceMonitorFields
          minPlayers={f.minPlayers}
          onMinPlayersChange={f.setMinPlayers}
          autoClose={f.autoClose}
          onAutoCloseChange={f.setAutoClose}
          gracePeriod={f.gracePeriod}
          onGracePeriodChange={f.setGracePeriod}
        />
      )}
      {f.purpose === "game-announcements" && (
        <p className="text-sm text-muted">
          No additional configuration needed for announcement channels.
        </p>
      )}
      {saveError && (
        <p className="text-sm text-red-400" role="alert">
          {saveError}
        </p>
      )}
      <FormActions
        saveDisabled={saveDisabled}
        isSaving={isSaving}
        onCancel={onCancel}
      />
    </form>
  );
}
