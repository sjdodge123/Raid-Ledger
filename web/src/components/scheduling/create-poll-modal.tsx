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
  const [minVoteThreshold, setMinVoteThreshold] = useState<number>(3);

  // Sync threshold to member count on change (ROK-1015)
  const setMemberIds = useCallback((ids: number[]) => {
    setMemberIdsRaw(ids);
    if (ids.length > 0) setMinVoteThreshold(ids.length);
  }, []);

  const reset = useCallback(() => {
    setSelectedGame(null);
    setMemberIdsRaw([]);
    setMinVoteThreshold(3);
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

/** Minimum votes threshold input (ROK-1015). Slider when members selected, number input otherwise. */
function MinVoteThresholdInput({ value, memberCount, onChange }: {
  value: number; memberCount: number; onChange: (v: number) => void;
}) {
  const hasMembers = memberCount > 0;
  return (
    <div data-testid="min-vote-threshold-slider">
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-secondary">
          Minimum Votes
        </label>
        <span className="text-sm text-muted tabular-nums">
          {hasMembers ? `${value} of ${memberCount}` : value}
        </span>
      </div>
      {hasMembers ? (
        <input
          type="range"
          min={1}
          max={memberCount}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full h-2 bg-surface/50 rounded-lg appearance-none cursor-pointer accent-emerald-500"
        />
      ) : (
        <input
          type="number"
          min={1}
          value={value}
          onChange={(e) => onChange(Math.max(1, Number(e.target.value) || 1))}
          className="w-full px-3 py-2 bg-panel border border-edge rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
      )}
      <p className="text-xs text-muted/60 mt-1">
        Notify me when this many members have voted
      </p>
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
      <MinVoteThresholdInput
        value={form.minVoteThreshold}
        memberCount={form.memberIds.length}
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
