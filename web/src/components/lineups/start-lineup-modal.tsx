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
import { useNavigate } from 'react-router-dom';
import { Modal } from '../ui/modal';
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

/** The advanced controls behind "More options" (ROK-1302). */
function StartLineupMoreOptions({ form }: { form: StartLineupForm }) {
  return (
    <MoreOptions>
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
    </MoreOptions>
  );
}

export function StartLineupModal({ isOpen, onClose }: Props) {
  const navigate = useNavigate();
  const createLineup = useCreateLineup();
  const form = useStartLineupForm();
  const { fields, setField, durations } = form;
  const { title, visibility, inviteeUserIds } = fields;

  const canSubmit =
    title.trim() !== '' &&
    (visibility === 'public' || inviteeUserIds.length > 0);

  async function handleSubmit() {
    const trimmed = title.trim();
    if (!trimmed) {
      toast.error('Title is required');
      return;
    }
    if (visibility === 'private' && inviteeUserIds.length === 0) {
      toast.error('Private lineups require at least one invitee');
      return;
    }
    try {
      const result = await createLineup.mutateAsync(
        buildCreatePayload({ ...fields, durations }),
      );
      onClose();
      navigate(`/community-lineup/${result.id}`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to create lineup',
      );
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Start Community Lineup">
      <div className="space-y-4">
        {/* ROK-1302 (operator review): top-level = Title, Preset chooser,
            Description, Visibility + audience. The Preset chooser is the visible
            match-shape control; the raw Threshold/Votes sliders + scheduling
            toggle live under "More options" for advanced tweaking. */}
        <TitleField value={title} onChange={(v) => setField('title', v)} />
        <PresetChooser value={fields.preset} onChange={form.applyPreset} />
        <DescriptionField
          value={fields.description}
          onChange={(v) => setField('description', v)}
        />
        <VisibilityToggle
          value={visibility}
          onChange={(v) => setField('visibility', v)}
        />
        {visibility === 'public' && (
          <PublicShareToggle
            enabled={fields.publicShareEnabled}
            onChange={(v) => setField('publicShareEnabled', v)}
          />
        )}
        {/* ROK-1440: shown for public lineups too — on public it seeds
            known attendees without closing the lineup to anyone else. */}
        <InviteeMultiSelect
          value={inviteeUserIds}
          onChange={(v) => setField('inviteeUserIds', v)}
          mode={visibility}
        />
        <StartLineupMoreOptions form={form} />
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-secondary bg-panel border border-edge rounded-lg hover:bg-overlay transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={createLineup.isPending || !canSubmit}
            className="px-4 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors disabled:opacity-50"
          >
            {createLineup.isPending ? 'Creating...' : 'Create Lineup'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
