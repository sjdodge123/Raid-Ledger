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
import { useCreateLineup } from '../../hooks/use-lineups';
import { toast } from '../../lib/toast';
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
import { LINEUP_PRESETS, type PresetKey } from './start-lineup-config';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

function defaultTitle(): string {
  const now = new Date();
  const month = now.toLocaleString('en-US', { month: 'long' });
  return `Lineup — ${month} ${now.getFullYear()}`;
}

const DEFAULT_BUILDING_HOURS = 48;
const DEFAULT_VOTING_HOURS = 24;

function useDurationState() {
  const [building, setBuilding] = useState<number | ''>('');
  const [voting, setVoting] = useState<number | ''>('');
  const [matchThreshold, setMatchThreshold] = useState<number>(35);
  const [votesPerPlayer, setVotesPerPlayer] = useState<number>(3);
  const [tiebreakerMode, setTiebreakerMode] =
    useState<'bracket' | 'veto' | null>('bracket');
  const buildingVal = building === '' ? DEFAULT_BUILDING_HOURS : building;
  const votingVal = voting === '' ? DEFAULT_VOTING_HOURS : voting;

  return {
    building: buildingVal,
    voting: votingVal,
    matchThreshold,
    votesPerPlayer,
    tiebreakerMode,
    setBuilding,
    setVoting,
    setMatchThreshold,
    setVotesPerPlayer,
    setTiebreakerMode,
  };
}

/** Build the create-lineup mutation payload from the modal's form state. */
function buildCreatePayload(state: {
  title: string;
  description: string;
  durations: ReturnType<typeof useDurationState>;
  channelOverrideId: string;
  visibility: 'public' | 'private';
  inviteeUserIds: number[];
  publicShareEnabled: boolean;
  includeSchedulingPhase: boolean;
}) {
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
    // ROK-1064: empty string → omit (use community default).
    ...(state.channelOverrideId
      ? { channelOverrideId: state.channelOverrideId }
      : {}),
    // ROK-1065: only send when non-default.
    ...(state.visibility === 'private'
      ? { visibility: state.visibility, inviteeUserIds: state.inviteeUserIds }
      : {}),
    // ROK-1067: send the toggle so a public lineup can opt out at create.
    ...(state.visibility === 'public'
      ? { publicShareEnabled: state.publicShareEnabled }
      : { publicShareEnabled: false }),
  };
}

export function StartLineupModal({ isOpen, onClose }: Props) {
  const navigate = useNavigate();
  const createLineup = useCreateLineup();
  const durations = useDurationState();
  const [title, setTitle] = useState<string>(defaultTitle);
  const [description, setDescription] = useState<string>('');
  const [channelOverrideId, setChannelOverrideId] = useState<string>('');
  // ROK-1065: visibility + invitees.
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [inviteeUserIds, setInviteeUserIds] = useState<number[]>([]);
  // ROK-1067: public-share toggle (default ON; forced false for private).
  const [publicShareEnabled, setPublicShareEnabled] = useState<boolean>(true);
  // ROK-1302: preset selection + scheduling-phase opt-in (default ON).
  const [preset, setPreset] = useState<PresetKey>('custom');
  const [includeSchedulingPhase, setIncludeSchedulingPhase] =
    useState<boolean>(true);

  function applyPreset(key: PresetKey): void {
    setPreset(key);
    if (key === 'custom') return;
    const p = LINEUP_PRESETS[key];
    durations.setMatchThreshold(p.matchThreshold);
    durations.setVotesPerPlayer(p.votesPerPlayer);
    durations.setBuilding(p.buildingDurationHours);
    durations.setVoting(p.votingDurationHours);
  }

  // Any manual match-shape / duration edit drops the preset back to Custom.
  function onThreshold(v: number): void {
    durations.setMatchThreshold(v);
    setPreset('custom');
  }
  function onVotes(v: number): void {
    durations.setVotesPerPlayer(v);
    setPreset('custom');
  }
  function onBuilding(v: number | ''): void {
    durations.setBuilding(v);
    setPreset('custom');
  }
  function onVoting(v: number | ''): void {
    durations.setVoting(v);
    setPreset('custom');
  }

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
        buildCreatePayload({
          title,
          description,
          durations,
          channelOverrideId,
          visibility,
          inviteeUserIds,
          publicShareEnabled,
          includeSchedulingPhase,
        }),
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
        <TitleField value={title} onChange={setTitle} />
        <PresetChooser value={preset} onChange={applyPreset} />
        <div className="border-t border-edge/30 pt-4">
          <ThresholdSlider
            value={durations.matchThreshold}
            onChange={onThreshold}
          />
        </div>
        <VotesPerPlayerSlider
          value={durations.votesPerPlayer}
          onChange={onVotes}
        />
        <PlayerCapsNote />
        <SchedulingPhaseToggle
          enabled={includeSchedulingPhase}
          onChange={setIncludeSchedulingPhase}
        />
        {/* ROK-1302: visibility + invitees stay top-level (operator request) —
            they decide WHO participates, same class as the scheduling toggle. */}
        <VisibilityToggle value={visibility} onChange={setVisibility} />
        {visibility === 'public' && (
          <PublicShareToggle
            enabled={publicShareEnabled}
            onChange={setPublicShareEnabled}
          />
        )}
        {visibility === 'private' && (
          <InviteeMultiSelect
            value={inviteeUserIds}
            onChange={setInviteeUserIds}
          />
        )}
        <MoreOptions>
          <DescriptionField value={description} onChange={setDescription} />
          <LineupChannelOverrideSelect
            value={channelOverrideId}
            onChange={setChannelOverrideId}
          />
          <p className="text-sm text-muted">
            Configure the duration for each phase. The lineup automatically
            advances through phases when time expires.
          </p>
          <DurationSlider
            label="Building Phase"
            name="buildingDurationHours"
            testId="building-duration"
            value={durations.building}
            onChange={onBuilding}
          />
          <DurationSlider
            label="Voting Phase"
            name="votingDurationHours"
            testId="voting-duration"
            value={durations.voting}
            onChange={onVoting}
          />
          <TiebreakerPicker
            value={durations.tiebreakerMode}
            onChange={durations.setTiebreakerMode}
          />
        </MoreOptions>
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
