/**
 * CreatePollModal — game picker + member picker for standalone polls (ROK-977).
 * Entry point from "Schedule a Game" button on events page.
 *
 * ROK-1655: Escape, the backdrop and × go through `useDirtyCloseGuard`, so a
 * draft (a picked game, members, a moved threshold or voting window) asks
 * "Discard your changes?" first. Create Poll sits in the Modal's pinned footer.
 */
import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { IgdbGameDto } from '@raid-ledger/contract';
import { useQuery } from '@tanstack/react-query';
import { Modal } from '../ui/modal';
import { useDirtyCloseGuard } from '../../hooks/use-dirty-close-guard';
import { Button } from '../ui/button';
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

const DEFAULT_MIN_VOTE_THRESHOLD = 3;

/** Form state for the create poll modal. */
function useCreatePollForm() {
  const [selectedGame, setSelectedGame] = useState<IgdbGameDto | null>(null);
  const [memberIds, setMemberIdsRaw] = useState<number[]>([]);
  const [minVoteThreshold, setMinVoteThreshold] = useState<number>(DEFAULT_MIN_VOTE_THRESHOLD);
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
    setMinVoteThreshold(DEFAULT_MIN_VOTE_THRESHOLD);
    setDurationHours(DEFAULT_DURATION_HOURS);
  }, []);
  const isDirty = selectedGame !== null
    || memberIds.length > 0
    || minVoteThreshold !== DEFAULT_MIN_VOTE_THRESHOLD
    || durationHours !== DEFAULT_DURATION_HOURS;
  return {
    selectedGame, setSelectedGame,
    memberIds, setMemberIds,
    minVoteThreshold, setMinVoteThreshold,
    durationHours, setDurationHours,
    reset, isDirty,
  };
}

/** Create the poll, close (unguarded: nothing is lost) and open it. */
function useSubmitPoll(form: ReturnType<typeof useCreatePollForm>, close: () => void) {
  const navigate = useNavigate();
  const mutation = useCreateSchedulingPoll();
  const handleSubmit = async () => {
    if (!form.selectedGame) return;
    const result = await mutation.mutateAsync({
      gameId: form.selectedGame.id,
      memberUserIds: form.memberIds.length > 0 ? form.memberIds : undefined,
      minVoteThreshold: form.minVoteThreshold > 0 ? form.minVoteThreshold : undefined,
      durationHours: form.durationHours,
    });
    close();
    navigate(`/community-lineup/${result.lineupId}/schedule/${result.id}`);
  };
  return { handleSubmit, isPending: mutation.isPending };
}

/**
 * Modal for creating a standalone scheduling poll.
 * Contains a game picker (search) and an optional member picker.
 */
export function CreatePollModal({ isOpen, onClose }: CreatePollModalProps) {
  const form = useCreatePollForm();
  const { reset } = form;
  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);
  // Escape, backdrop and × ask first; Create Poll's own close stays unguarded.
  const guard = useDirtyCloseGuard(form.isDirty, handleClose);
  const { handleSubmit, isPending } = useSubmitPoll(form, handleClose);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Schedule a Game"
      maxWidth="max-w-lg"
      closeGuard={guard}
      discardMessage="Your poll hasn't been created yet."
      footer={
        <CreatePollSubmit
          disabled={!form.selectedGame}
          isPending={isPending}
          onSubmit={handleSubmit}
        />
      }
    >
      <CreatePollFormBody form={form} />
    </Modal>
  );
}

/** Minimum Votes' max: the picked members, else everyone on the first page. */
function useThresholdSliderMax(pickedCount: number): number {
  const { data: players } = useQuery({
    queryKey: ['players', 'member-picker', ''],
    queryFn: () => getPlayers({ page: 1 }),
    select: (d) => d.data ?? [],
  });
  const totalMembers = players?.length ?? 20;
  return Math.max(1, pickedCount > 0 ? pickedCount : totalMembers);
}

/** Form body extracted to stay within function line limits. */
function CreatePollFormBody({ form }: {
  form: ReturnType<typeof useCreatePollForm>;
}) {
  const sliderMax = useThresholdSliderMax(form.memberIds.length);
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
    </div>
  );
}

/**
 * The primary action, rendered in the Modal's pinned footer (ROK-1655). `loading` (ruling 7) swaps the label for a spinner and
 * an sr-only "Creating…", sets aria-busy + aria-disabled, and swallows clicks.
 */
function CreatePollSubmit({ disabled, isPending, onSubmit }: {
  disabled: boolean;
  isPending: boolean;
  onSubmit: () => void;
}) {
  return (
    <Button
      variant="primary"
      size="lg"
      fullWidth
      onClick={onSubmit}
      disabled={disabled}
      loading={isPending}
      loadingLabel="Creating…"
    >
      Create Poll
    </Button>
  );
}
