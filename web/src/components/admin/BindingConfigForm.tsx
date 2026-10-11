import type {
  ChannelBindingDto,
  UpdateChannelBindingDto,
} from "@raid-ledger/contract";
import { QUICK_PLAY_ANNOUNCE_HELP } from "@raid-ledger/contract";
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
  saveError?: string | null | undefined;
  /** Another row's PATCH is in flight: Save (and Convert) are native-disabled, not loading. */
  saveLocked?: boolean | undefined;
}

type BindingForm = ReturnType<typeof useBindingConfigForm>;

/** The purpose-specific config: lobby toggle, voice timings, announcement note. */
function PurposeConfigSections({ f }: { f: BindingForm }) {
  const showVoiceFields =
    f.purpose === "game-voice-monitor" || f.purpose === "general-lobby";
  return (
    <>
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
      <AnnouncementNotes purpose={f.purpose} />
    </>
  );
}

/** Announcement purposes have no config; Quick Play adds its one-line help (ROK-1766). */
function AnnouncementNotes({ purpose }: { purpose: BindingForm["purpose"] }) {
  const isQuickPlay = purpose === "quick-play-announcements";
  if (purpose !== "game-announcements" && !isQuickPlay) return null;
  return (
    <>
      {isQuickPlay && (
        <p className="text-xs text-muted">{QUICK_PLAY_ANNOUNCE_HELP}</p>
      )}
      <p className="text-sm text-muted">
        No additional configuration needed for announcement channels.
      </p>
    </>
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
  saveLocked = false,
}: BindingConfigFormProps) {
  const f = useBindingConfigForm(binding);
  // The game maps to a purpose for a monitor / announcement channel; a General
  // Lobby auto-detects it, so the field is hidden there (wireframe B1).
  const showGameField = f.purpose !== "general-lobby";
  const purposeId = `binding-purpose-${binding.id}`;
  const gameFieldId = `binding-game-${binding.id}`;
  // ROK-1766: a Quick Play Announcements binding needs a game; Save waits for one.
  const qpNoGame = f.violation?.code === "BINDING_QP_REQUIRES_GAME";
  const showGameError = f.gameRequired || qpNoGame;

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
      {f.gameRequired && (
        <InertHealBanner
          onConvert={handleConvert}
          locked={saveLocked}
          isSaving={isSaving}
        />
      )}
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
          violationMessage={showGameError ? f.violation?.message : undefined}
        />
      )}
      <PurposeConfigSections f={f} />
      {saveError && (
        <p className="text-sm text-danger" role="alert">
          {saveError}
        </p>
      )}
      <FormActions
        saveDisabled={showGameError || saveLocked}
        isSaving={isSaving}
        onCancel={onCancel}
      />
    </form>
  );
}
