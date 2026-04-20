/**
 * Start Lineup modal with configurable duration fields (ROK-946),
 * per-lineup title + description (ROK-1063),
 * and optional per-lineup Discord channel override (ROK-1064).
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '../ui/modal';
import { useCreateLineup } from '../../hooks/use-lineups';
import { useLineupSettings } from '../../hooks/admin/use-lineup-settings';
import { toast } from '../../lib/toast';
import { LineupChannelOverrideSelect } from './lineup-channel-override-select';
import { VisibilityToggle } from './VisibilityToggle';
import { InviteeMultiSelect } from './InviteeMultiSelect';
import {
  DurationSlider,
  VotesPerPlayerSlider,
  ThresholdSlider,
  TitleField,
  DescriptionField,
  TiebreakerPicker,
} from './start-lineup-sliders';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

function defaultTitle(): string {
  const now = new Date();
  const month = now.toLocaleString('en-US', { month: 'long' });
  return `Lineup — ${month} ${now.getFullYear()}`;
}

function useDurationState() {
  const { lineupDefaults } = useLineupSettings();
  const defaults = lineupDefaults.data;
  const [building, setBuilding] = useState<number | ''>('');
  const [voting, setVoting] = useState<number | ''>('');
  const [matchThreshold, setMatchThreshold] = useState<number>(35);
  const [votesPerPlayer, setVotesPerPlayer] = useState<number>(3);
  const [tiebreakerMode, setTiebreakerMode] =
    useState<'bracket' | 'veto' | null>('bracket');
  const buildingVal =
    building === '' ? (defaults?.buildingDurationHours ?? 48) : building;
  const votingVal =
    voting === '' ? (defaults?.votingDurationHours ?? 24) : voting;

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
    isLoading: lineupDefaults.isLoading,
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
      const result = await createLineup.mutateAsync({
        title: trimmed,
        description: description.trim() === '' ? null : description,
        buildingDurationHours: durations.building,
        votingDurationHours: durations.voting,
        matchThreshold: durations.matchThreshold,
        votesPerPlayer: durations.votesPerPlayer,
        defaultTiebreakerMode: durations.tiebreakerMode,
        // ROK-1064: empty string → omit the field (use community default).
        ...(channelOverrideId ? { channelOverrideId } : {}),
        // ROK-1065: only send when non-default.
        ...(visibility === 'private'
          ? { visibility, inviteeUserIds }
          : {}),
      });
      onClose();
      navigate(`/community-lineup/${result.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create lineup');
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Start Community Lineup">
      <div className="space-y-4">
        <TitleField value={title} onChange={setTitle} />
        <DescriptionField value={description} onChange={setDescription} />
        <VisibilityToggle value={visibility} onChange={setVisibility} />
        {visibility === 'private' && (
          <InviteeMultiSelect
            value={inviteeUserIds}
            onChange={setInviteeUserIds}
          />
        )}
        <LineupChannelOverrideSelect
          value={channelOverrideId}
          onChange={setChannelOverrideId}
        />
        <p className="text-sm text-muted">
          Configure the duration for each phase. The lineup will automatically
          advance through phases when time expires.
        </p>
        <DurationSlider
          label="Building Phase"
          name="buildingDurationHours"
          testId="building-duration"
          value={durations.building}
          onChange={durations.setBuilding}
        />
        <DurationSlider
          label="Voting Phase"
          name="votingDurationHours"
          testId="voting-duration"
          value={durations.voting}
          onChange={durations.setVoting}
        />
        <div className="border-t border-edge/30 pt-4">
          <ThresholdSlider
            value={durations.matchThreshold}
            onChange={durations.setMatchThreshold}
          />
        </div>
        <VotesPerPlayerSlider
          value={durations.votesPerPlayer}
          onChange={durations.setVotesPerPlayer}
        />
        <TiebreakerPicker
          value={durations.tiebreakerMode}
          onChange={durations.setTiebreakerMode}
        />
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
