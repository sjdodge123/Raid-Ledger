/**
 * Start Lineup modal (ROK-946 / 1063 / 1064).
 *
 * ROK-1302 (S4): collapsed from 10 visible controls to 5 — Title + Preset
 * chooser + Match Threshold + Votes per Player + Include-scheduling toggle.
 * The other 6 (description, visibility, share link, channel, phase durations,
 * tiebreaker) live behind a "More options" expander. The preset chooser writes
 * canonical match-shape + phase-duration values; the scheduling toggle controls
 * whether the lineup advances into a scheduling poll after Decided.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '../ui/modal';
import { Button } from '../ui/button';
import { useDirtyCloseGuard } from '../../hooks/use-dirty-close-guard';
import { useCreateLineup } from '../../hooks/use-lineups';
import { toast } from '../../lib/toast';
import { NominationTargetControl } from './start-lineup-nomination-target';
import { LineupChannelOverrideSelect } from './lineup-channel-override-select';
import { VisibilityToggle } from './VisibilityToggle';
import { InviteeMultiSelect } from './InviteeMultiSelect';
import { PublicShareToggle } from './PublicShareToggle';
import {
  DurationSlider,
  VotesPerPlayerSlider,
  ThresholdSlider,
  TitleField,
  DescriptionField,
  TiebreakerPicker,
} from './start-lineup-sliders';
import {
  PresetChooser,
  SchedulingPhaseToggle,
  PlayerCapsNote,
  MoreOptions,
} from './start-lineup-presets';
import {
  useStartLineupForm,
  type DurationState,
  type StartLineupFields,
  type StartLineupForm,
} from './use-start-lineup-dirty';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

/** Build the create-lineup mutation payload from the modal's form state. */
function buildCreatePayload(
  state: StartLineupFields & { durations: DurationState },
) {
  const { durations } = state;
  return {
    title: state.title.trim(),
    description: state.description.trim() === '' ? null : state.description,
    buildingDurationHours: durations.building,
    votingDurationHours: durations.voting,
    matchThreshold: durations.matchThreshold,
    votesPerPlayer: durations.votesPerPlayer,
    defaultTiebreakerMode: durations.tiebreakerMode,
    // ROK-1302: always sent so the toggle's state is explicit server-side.
    includeSchedulingPhase: state.includeSchedulingPhase,
    // ROK-1444: null is meaningful (deadline-only), so send it explicitly.
    nominationTargetPct: durations.nominationTargetPct,
    // ROK-1064: empty string → omit (use community default).
    ...(state.channelOverrideId
      ? { channelOverrideId: state.channelOverrideId }
      : {}),
    // ROK-1065: visibility only sent when non-default ('private').
    ...(state.visibility === 'private' ? { visibility: state.visibility } : {}),
    // ROK-1440: invitees are sent for BOTH visibilities. On a public lineup
    // they are seeded participants, not an access gate — the contract already
    // permits `inviteeUserIds` regardless of visibility, and the create
    // service adds them without checking it. Omitted when empty so a public
    // lineup with no explicit invites sends exactly what it does today.
    ...(state.inviteeUserIds.length > 0
      ? { inviteeUserIds: state.inviteeUserIds }
      : {}),
    // ROK-1067: send the toggle so a public lineup can opt out at create.
    ...(state.visibility === 'public'
      ? { publicShareEnabled: state.publicShareEnabled }
      : { publicShareEnabled: false }),
  };
}

/** Match shape, nomination target, scheduling and channel (ROK-1302). */
function MatchShapeOptions({ form }: { form: StartLineupForm }) {
  return (
    <>
      <div className="border-t border-edge/30 pt-4">
        <ThresholdSlider
          value={form.durations.matchThreshold}
          onChange={form.onThreshold}
        />
      </div>
      <VotesPerPlayerSlider
        value={form.durations.votesPerPlayer}
        onChange={form.onVotes}
      />
      <PlayerCapsNote />
      <NominationTargetControl
        value={form.durations.nominationTargetPct}
        onChange={form.durations.setNominationTargetPct}
      />
      <SchedulingPhaseToggle
        enabled={form.fields.includeSchedulingPhase}
        onChange={(v) => form.setField('includeSchedulingPhase', v)}
      />
      <LineupChannelOverrideSelect
        value={form.fields.channelOverrideId}
        onChange={(v) => form.setField('channelOverrideId', v)}
      />
    </>
  );
}

/** Phase durations + tiebreaker (ROK-1302). */
function PhaseOptions({ form }: { form: StartLineupForm }) {
  return (
    <>
      <p className="text-sm text-muted">
        Configure the duration for each phase. The lineup automatically
        advances through phases when time expires.
      </p>
      <DurationSlider
        label="Building Phase"
        name="buildingDurationHours"
        testId="building-duration"
        value={form.durations.building}
        onChange={form.onBuilding}
      />
      <DurationSlider
        label="Voting Phase"
        name="votingDurationHours"
        testId="voting-duration"
        value={form.durations.voting}
        onChange={form.onVoting}
      />
      <TiebreakerPicker
        value={form.durations.tiebreakerMode}
        onChange={form.durations.setTiebreakerMode}
      />
    </>
  );
}

/** The advanced controls behind "More options" (ROK-1302). */
function StartLineupMoreOptions({ form }: { form: StartLineupForm }) {
  return (
    <MoreOptions>
      <MatchShapeOptions form={form} />
      <PhaseOptions form={form} />
    </MoreOptions>
  );
}

/** Visibility, public share and invitees — the lineup's audience. */
function AudienceFields({ form }: { form: StartLineupForm }) {
  const { fields, setField } = form;
  return (
    <>
      <VisibilityToggle
        value={fields.visibility}
        onChange={(v) => setField('visibility', v)}
      />
      {fields.visibility === 'public' && (
        <PublicShareToggle
          enabled={fields.publicShareEnabled}
          onChange={(v) => setField('publicShareEnabled', v)}
        />
      )}
      {/* ROK-1440: shown for public lineups too — it seeds known attendees
          without closing the lineup to anyone else. */}
      <InviteeMultiSelect
        value={fields.inviteeUserIds}
        onChange={(v) => setField('inviteeUserIds', v)}
        mode={fields.visibility}
      />
    </>
  );
}

/**
 * ROK-1302 (operator review): top-level = Title, Preset chooser, Description,
 * Visibility + audience; the raw sliders + scheduling toggle sit under "More
 * options".
 */
function StartLineupFieldsBody({ form }: { form: StartLineupForm }) {
  const { fields, setField } = form;
  return (
    <div className="space-y-4">
      <TitleField value={fields.title} onChange={(v) => setField('title', v)} />
      <PresetChooser value={fields.preset} onChange={form.applyPreset} />
      <DescriptionField
        value={fields.description}
        onChange={(v) => setField('description', v)}
      />
      <AudienceFields form={form} />
      <StartLineupMoreOptions form={form} />
    </div>
  );
}

/** Create the lineup, then close (raw `onClose` — no confirm) and navigate. */
function useStartLineupSubmit(form: StartLineupForm, onClose: () => void) {
  const navigate = useNavigate();
  const createLineup = useCreateLineup();
  const { title, visibility, inviteeUserIds } = form.fields;
  const canSubmit =
    title.trim() !== '' && (visibility === 'public' || inviteeUserIds.length > 0);

  async function submit() {
    if (!title.trim()) return void toast.error('Title is required');
    if (visibility === 'private' && inviteeUserIds.length === 0) {
      return void toast.error('Private lineups require at least one invitee');
    }
    try {
      const result = await createLineup.mutateAsync(
        buildCreatePayload({ ...form.fields, durations: form.durations }),
      );
      onClose();
      navigate(`/community-lineup/${result.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create lineup');
    }
  }
  return { submit, canSubmit, isPending: createLineup.isPending };
}

interface ActionsProps {
  onCancel: () => void;
  onCreate: () => void;
  canSubmit: boolean;
  isPending: boolean;
}

/** The pinned footer (ROK-1655): Cancel goes through the guard (ruling 4). */
function StartLineupActions({ onCancel, onCreate, canSubmit, isPending }: ActionsProps) {
  return (
    <>
      <Button variant="secondary" onClick={onCancel}>
        Cancel
      </Button>
      <Button onClick={onCreate} disabled={!canSubmit} loading={isPending}>
        Create Lineup
      </Button>
    </>
  );
}

function StartLineupDialog({ isOpen, onClose }: Props) {
  const form = useStartLineupForm();
  const { submit, canSubmit, isPending } = useStartLineupSubmit(form, onClose);
  const closeGuard = useDirtyCloseGuard(form.isDirty, onClose);
  const footer = (
    <StartLineupActions
      onCancel={closeGuard.requestClose}
      onCreate={() => void submit()}
      canSubmit={canSubmit}
      isPending={isPending}
    />
  );
  return (
    <Modal isOpen={isOpen} onClose={onClose} closeGuard={closeGuard}
      title="Start Community Lineup" footer={footer}>
      <StartLineupFieldsBody form={form} />
    </Modal>
  );
}

/**
 * Counts the opens. LineupBanner keeps this modal mounted with `isOpen` false,
 * so the dialog is keyed on the count: every open (after a Discard, a create
 * or a clean close) starts from fresh defaults and a clean dirty snapshot.
 */
function useOpenCount(isOpen: boolean): number {
  const [seen, setSeen] = useState({ isOpen, count: 0 });
  if (seen.isOpen !== isOpen) {
    setSeen({ isOpen, count: isOpen ? seen.count + 1 : seen.count });
  }
  return seen.count;
}

export function StartLineupModal({ isOpen, onClose }: Props) {
  const openCount = useOpenCount(isOpen);
  return <StartLineupDialog key={openCount} isOpen={isOpen} onClose={onClose} />;
}
