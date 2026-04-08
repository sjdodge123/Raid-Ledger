/**
 * CreatePollModal — game picker + member picker for standalone polls (ROK-977).
 * Entry point from "Schedule a Game" button on events page.
 */
import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { IgdbGameDto } from '@raid-ledger/contract';
import { Modal } from '../ui/modal';
import { useCreateSchedulingPoll } from '../../hooks/use-standalone-poll';
import { MemberPicker } from './member-picker-modal';
import { PollGameSearch } from './poll-game-search';

interface CreatePollModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Form state for the create poll modal. */
function useCreatePollForm() {
  const [selectedGame, setSelectedGame] = useState<IgdbGameDto | null>(null);
  const [memberIds, setMemberIdsRaw] = useState<number[]>([]);
  const [minVoteThreshold, setMinVoteThreshold] = useState<number>(0);

  // Sync threshold to member count on change (ROK-1015)
  const setMemberIds = useCallback((ids: number[]) => {
    setMemberIdsRaw(ids);
    setMinVoteThreshold(ids.length);
  }, []);

  const reset = useCallback(() => {
    setSelectedGame(null);
    setMemberIdsRaw([]);
    setMinVoteThreshold(0);
  }, []);
  return {
    selectedGame, setSelectedGame,
    memberIds, setMemberIds,
    minVoteThreshold, setMinVoteThreshold,
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

/** Minimum votes slider shown when members are selected (ROK-1015). */
function MinVoteThresholdSlider({ value, max, onChange }: {
  value: number; max: number; onChange: (v: number) => void;
}) {
  return (
    <div data-testid="min-vote-threshold-slider">
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-secondary">
          Minimum Votes
        </label>
        <span className="text-sm text-muted tabular-nums">
          {value} of {max}
        </span>
      </div>
      <input
        type="range"
        min={1}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-2 bg-surface/50 rounded-lg appearance-none cursor-pointer accent-emerald-500"
      />
      <div className="flex justify-between text-xs text-muted/60 mt-1">
        <span>1 vote</span>
        <span>{max} votes</span>
      </div>
    </div>
  );
}

/** Form body extracted to stay within function line limits. */
function CreatePollFormBody({ form, isPending, onSubmit }: {
  form: ReturnType<typeof useCreatePollForm>;
  isPending: boolean;
  onSubmit: () => void;
}) {
  return (
    <div className="space-y-4">
      <PollGameSearch
        value={form.selectedGame}
        onChange={form.setSelectedGame}
      />
      <MemberPicker
        selectedIds={form.memberIds}
        onChange={form.setMemberIds}
      />
      {form.memberIds.length > 0 && (
        <MinVoteThresholdSlider
          value={form.minVoteThreshold}
          max={form.memberIds.length}
          onChange={form.setMinVoteThreshold}
        />
      )}
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
