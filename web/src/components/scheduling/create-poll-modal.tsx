/**
 * CreatePollModal — game picker + member picker for standalone polls (ROK-977).
 * Entry point from "Schedule a Game" button on events page.
 */
import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { IgdbGameDto } from '@raid-ledger/contract';
import { useQuery } from '@tanstack/react-query';
import { Modal } from '../ui/modal';
import { useCreateSchedulingPoll } from '../../hooks/use-standalone-poll';
import { MemberPicker } from './member-picker-modal';
import { PollGameSearch } from './poll-game-search';
import { DurationPicker } from './duration-picker';
import { DEFAULT_DURATION_HOURS } from './duration-options';
import { MinVoteThresholdSlider } from './min-vote-threshold-slider';
import { getPlayers } from '../../lib/api-client';

interface CreatePollModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Form state for the create poll modal. */
function useCreatePollForm() {
  const [selectedGame, setSelectedGame] = useState<IgdbGameDto | null>(null);
  const [memberIds, setMemberIdsRaw] = useState<number[]>([]);
  const [minVoteThreshold, setMinVoteThreshold] = useState<number>(3);
  const [durationHours, setDurationHours] = useState<number>(
    DEFAULT_DURATION_HOURS,
  );

  // Sync threshold to member count on change (ROK-1015)
  const setMemberIds = useCallback((ids: number[]) => {
    setMemberIdsRaw(ids);
    if (ids.length > 0) setMinVoteThreshold(ids.length);
  }, []);

  const reset = useCallback(() => {
    setSelectedGame(null);
    setMemberIdsRaw([]);
    setMinVoteThreshold(3);
    setDurationHours(DEFAULT_DURATION_HOURS);
  }, []);
  return {
    selectedGame, setSelectedGame,
    memberIds, setMemberIds,
    minVoteThreshold, setMinVoteThreshold,
    durationHours, setDurationHours,
    reset,
  };
}

/**
 * Modal for creating a standalone scheduling poll.
 * Contains a game picker (search) and an optional member picker.
 */
export function CreatePollModal({ isOpen, onClose }: CreatePollModalProps) {
  const navigate = useNavigate();
  const form = useCreatePollForm();
  const mutation = useCreateSchedulingPoll();

  const handleClose = () => {
    form.reset();
    onClose();
  };

  const handleSubmit = async () => {
    if (!form.selectedGame) return;
    const result = await mutation.mutateAsync({
      gameId: form.selectedGame.id,
      memberUserIds: form.memberIds.length > 0 ? form.memberIds : undefined,
      minVoteThreshold: form.minVoteThreshold > 0 ? form.minVoteThreshold : undefined,
      durationHours: form.durationHours,
    });
    handleClose();
    navigate(`/community-lineup/${result.lineupId}/schedule/${result.id}`);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Schedule a Game"
      maxWidth="max-w-lg"
    >
      <CreatePollFormBody
        form={form}
        isPending={mutation.isPending}
        onSubmit={handleSubmit}
      />
    </Modal>
  );
}

/** Form body extracted to stay within function line limits. */
function CreatePollFormBody({ form, isPending, onSubmit }: {
  form: ReturnType<typeof useCreatePollForm>;
  isPending: boolean;
  onSubmit: () => void;
}) {
  const { data: players } = useQuery({
    queryKey: ['players', 'member-picker', ''],
    queryFn: () => getPlayers({ page: 1 }),
    select: (d) => d.data ?? [],
  });
  const totalMembers = players?.length ?? 20;
  const sliderMax = Math.max(1, form.memberIds.length > 0 ? form.memberIds.length : totalMembers);
  return (
    <div className="space-y-3">
      <PollGameSearch
        value={form.selectedGame}
        onChange={form.setSelectedGame}
      />
      <MemberPicker
        selectedIds={form.memberIds}
        onChange={form.setMemberIds}
      />
      <DurationPicker
        value={form.durationHours}
        onChange={form.setDurationHours}
      />
      <MinVoteThresholdSlider
        value={form.minVoteThreshold}
        max={sliderMax}
        onChange={form.setMinVoteThreshold}
      />
      <button
        type="button"
        onClick={onSubmit}
        disabled={!form.selectedGame || isPending}
        className="w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-foreground font-semibold rounded-lg transition-colors"
      >
        {isPending ? 'Creating...' : 'Create Poll'}
      </button>
    </div>
  );
}
