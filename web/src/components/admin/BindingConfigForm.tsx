import type {
  ChannelBindingDto,
  UpdateChannelBindingDto,
} from "@raid-ledger/contract";
import {
  FormActions,
  GameField,
  GeneralLobbySection,
  InertHealBanner,
  PurposeSelect,
  VoiceMonitorFields,
} from "./BindingConfigFormFields";
import { useBindingConfigForm } from "./use-binding-config-form";

interface BindingConfigFormProps {
  binding: ChannelBindingDto;
  onSave: (id: string, dto: UpdateChannelBindingDto) => void;
  onCancel: () => void;
  isSaving: boolean;
  /** ROK-1416: a rejected PATCH (400/409) surfaced above the actions; the form stays open. */
  saveError?: string | null;
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
          purpose={f.purpose}
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
