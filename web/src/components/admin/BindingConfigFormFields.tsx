import type { ReactNode } from "react";
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
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Field } from "../ui/field";
import { Input } from "../ui/input";
import { Select } from "../ui/select";

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

const PURPOSE_HINT =
  "Voice + a game = Activity Monitor · Voice, no game = General Lobby · " +
  "Text = Announcements. The form won't let you save an invalid combination.";

/** A whole-number field from 1 to `max`, on the shared Field + Input. */
function NumberField(props: {
  id: string;
  label: string;
  hint?: ReactNode;
  max: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <Field id={props.id} label={props.label} hint={props.hint}>
      <Input
        type="number"
        min={1}
        max={props.max}
        step={1}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </Field>
  );
}

interface MinPlayersProps {
  purpose: BindingPurpose;
  minPlayers: number;
  onMinPlayersChange: (v: number) => void;
}

/**
 * The minimum-players field. Purpose-aware because the threshold counts
 * different things per purpose (ROK-1445): a General Lobby counts a detected
 * game group, an Activity Monitor counts the channel. Both help lines are the
 * Field hint, so the input is described by them.
 */
function MinPlayersField(p: MinPlayersProps) {
  const hint = (
    <>
      {MIN_PLAYERS_HELP[p.purpose]}{" "}
      {p.purpose === "general-lobby" && (
        <span className="block mt-1">{MIN_PLAYERS_CONSEQUENCE}</span>
      )}
    </>
  );
  return (
    <NumberField
      id="minPlayers"
      label={minPlayersLabel(p.purpose)}
      hint={hint}
      max={50}
      value={p.minPlayers}
      onChange={p.onMinPlayersChange}
    />
  );
}

/**
 * The auto-close toggle. ROK-1448 changed only the WORDS: closing has always
 * been per event group (`ad-hoc-event.service::handleVoiceLeave` resolves the
 * leaving member's event and waits for THAT group's member set to empty), and
 * the old "when voice empties" label described a channel-wide behaviour that
 * does not exist. The control itself is unchanged.
 */
function AutoCloseField(p: {
  autoClose: boolean;
  onAutoCloseChange: (v: boolean) => void;
}) {
  return (
    <Checkbox
      id="autoClose"
      label={autoCloseLabel()}
      description={AUTO_CLOSE_HELP}
      checked={p.autoClose}
      onChange={(e) => p.onAutoCloseChange(e.target.checked)}
    />
  );
}

export function GeneralLobbySection(p: {
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
      <Checkbox
        id="allowJustChatting"
        label='Allow "Just Chatting" events (no game required)'
        checked={p.allowJustChatting}
        onChange={(e) => p.onChange(e.target.checked)}
      />
    </div>
  );
}

interface VoiceMonitorFieldsProps extends MinPlayersProps {
  autoClose: boolean;
  onAutoCloseChange: (v: boolean) => void;
  gracePeriod: number;
  onGracePeriodChange: (v: number) => void;
}

/**
 * The voice-tuning settings for a monitor or lobby binding.
 *
 * @param p.purpose - Drives the threshold copy (ROK-1448 / ROK-1462 AC4).
 */
export function VoiceMonitorFields(p: VoiceMonitorFieldsProps) {
  return (
    <>
      <MinPlayersField
        purpose={p.purpose}
        minPlayers={p.minPlayers}
        onMinPlayersChange={p.onMinPlayersChange}
      />
      <AutoCloseField
        autoClose={p.autoClose}
        onAutoCloseChange={p.onAutoCloseChange}
      />
      <NumberField
        id="gracePeriod"
        label="Grace Period (minutes before closing)"
        max={60}
        value={p.gracePeriod}
        onChange={p.onGracePeriodChange}
      />
    </>
  );
}

export function PurposeSelect(p: {
  id: string;
  channelType: ChannelType;
  value: BindingPurpose;
  onChange: (v: BindingPurpose) => void;
}) {
  return (
    <Field id={p.id} label="Purpose" hint={PURPOSE_HINT}>
      <Select
        value={p.value}
        onChange={(e) => p.onChange(e.target.value as BindingPurpose)}
      >
        {PURPOSE_OPTIONS[p.channelType].map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function InertHealBanner({ onConvert }: { onConvert: () => void }) {
  return (
    <div className="border border-danger/40 bg-danger/10 rounded-lg p-2 text-xs">
      <div className="text-danger font-medium">
        ⚠ This voice monitor has no game — Quick Play can never fire on it.
      </div>
      <div className="flex items-center justify-between gap-2 mt-1">
        <span className="text-danger">
          Pick a game below, or convert to a General Lobby (any game,
          auto-detected).
        </span>
        <Button size="sm" onClick={onConvert} className="whitespace-nowrap">
          Convert to General Lobby
        </Button>
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

/**
 * Save + Cancel. `saveDisabled` is VALIDATION only (native disabled — the
 * inert triple cannot be saved); a pending save is Button `loading`, which
 * keeps focus and swallows the submit (ROK-1652 ruling 7).
 */
export function FormActions(p: {
  saveDisabled: boolean;
  isSaving: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="flex gap-2 pt-2">
      <Button
        type="submit"
        loading={p.isSaving}
        loadingLabel="Saving..."
        disabled={p.saveDisabled}
      >
        Save
      </Button>
      <Button variant="secondary" onClick={p.onCancel}>
        Cancel
      </Button>
    </div>
  );
}
