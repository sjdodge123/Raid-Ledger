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
  const [memberIds, setMemberIds] = useState<number[]>([]);
  const reset = useCallback(() => {
    setSelectedGame(null);
    setMemberIds([]);
  }, []);
  return { selectedGame, setSelectedGame, memberIds, setMemberIds, reset };
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
