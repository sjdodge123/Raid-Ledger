/**
 * CreatePollModal — game picker + member picker for standalone polls (ROK-977).
 * Entry point from "Schedule a Game" button on events page.
 *
 * ROK-1655: Escape, the backdrop and × go through `useDirtyCloseGuard`, so a
 * draft (a picked game, members, a moved threshold or voting window) asks
 * "Discard your changes?" first. Create Poll sits in the Modal's pinned footer.
 *
 * ROK-1750: "Who can see this poll?" (Community / Private — anyone with the
 * link). A private poll does not auto-navigate: the modal switches to a
 * success state with the share link + Open poll. The control is hidden for
 * reschedule polls (ruling R3, `hideVisibility`).
 */
import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { IgdbGameDto, SchedulingPollResponseDto, StandalonePollVisibility } from '@raid-ledger/contract';
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
import { CreatePollVisibility } from './create-poll-visibility';
import { CreatePollSuccess, CreatePollSuccessFooter } from './create-poll-success';

interface CreatePollModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** ROK-1750 (R3): reschedule polls can't be private — hide the control. */
  hideVisibility?: boolean;
}

/** A created private poll, shown in the success state. */
type CreatedPrivatePoll = Pick<SchedulingPollResponseDto, 'id' | 'lineupId'> & { shareToken: string };

const DEFAULT_MIN_VOTE_THRESHOLD = 3;

/** Form state for the create poll modal. */
function useCreatePollForm() {
  const [selectedGame, setSelectedGame] = useState<IgdbGameDto | null>(null);
  const [memberIds, setMemberIdsRaw] = useState<number[]>([]);
  const [minVoteThreshold, setMinVoteThreshold] = useState<number>(DEFAULT_MIN_VOTE_THRESHOLD);
  const [durationHours, setDurationHours] = useState<number>(
    DEFAULT_DURATION_HOURS,
  );
  const [visibility, setVisibility] = useState<StandalonePollVisibility>('public');

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
    setVisibility('public');
  }, []);
  const isDirty = selectedGame !== null
    || memberIds.length > 0
    || minVoteThreshold !== DEFAULT_MIN_VOTE_THRESHOLD
    || durationHours !== DEFAULT_DURATION_HOURS
    || visibility !== 'public';
  return {
    selectedGame, setSelectedGame,
    memberIds, setMemberIds,
    minVoteThreshold, setMinVoteThreshold,
    durationHours, setDurationHours,
    visibility, setVisibility,
    reset, isDirty,
  };
}

/** Create the poll. Public: close (unguarded: nothing is lost) and open it. Private: show the link. */
function useSubmitPoll(form: ReturnType<typeof useCreatePollForm>, close: () => void) {
  const navigate = useNavigate();
  const mutation = useCreateSchedulingPoll();
  const [created, setCreated] = useState<CreatedPrivatePoll | null>(null);
  const handleSubmit = async () => {
    if (!form.selectedGame) return;
    const result = await mutation.mutateAsync({
      gameId: form.selectedGame.id,
      memberUserIds: form.memberIds.length > 0 ? form.memberIds : undefined,
      minVoteThreshold: form.minVoteThreshold > 0 ? form.minVoteThreshold : undefined,
      durationHours: form.durationHours,
      ...(form.visibility === 'private' ? { visibility: 'private' as const } : {}),
    });
    if (result.visibility === 'private' && result.shareToken) {
      form.reset();
      setCreated({ id: result.id, lineupId: result.lineupId, shareToken: result.shareToken });
      return;
    }
    close();
    navigate(`/community-lineup/${result.lineupId}/schedule/${result.id}`);
  };
  const openCreated = () => {
    if (!created) return;
    close();
    setCreated(null);
    navigate(`/community-lineup/${created.lineupId}/schedule/${created.id}`);
  };
  return { handleSubmit, isPending: mutation.isPending, created, openCreated, clearCreated: () => setCreated(null) };
}

/**
 * Modal for creating a standalone scheduling poll.
 * Contains a game picker (search) and an optional member picker.
 */
export function CreatePollModal({ isOpen, onClose, hideVisibility = false }: CreatePollModalProps) {
  const form = useCreatePollForm();
  const { reset } = form;
  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);
  // Escape, backdrop and × ask first; Create Poll's own close stays unguarded.
  const guard = useDirtyCloseGuard(form.isDirty, handleClose);
  const submit = useSubmitPoll(form, handleClose);
  const { created, clearCreated } = submit;
  const closeAfterCreate = useCallback(() => { clearCreated(); handleClose(); }, [clearCreated, handleClose]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={created ? closeAfterCreate : handleClose}
      title="Schedule a Game"
      maxWidth="max-w-lg"
      {...(created ? {} : { closeGuard: guard })}
      discardMessage="Your poll hasn't been created yet."
      footer={created
        ? <CreatePollSuccessFooter onOpen={submit.openCreated} />
        : <CreatePollSubmit disabled={!form.selectedGame} isPending={submit.isPending} onSubmit={submit.handleSubmit} />}
    >
      {created
        ? <CreatePollSuccess token={created.shareToken} />
        : <CreatePollFormBody form={form} hideVisibility={hideVisibility} />}
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
function CreatePollFormBody({ form, hideVisibility }: {
  form: ReturnType<typeof useCreatePollForm>;
  hideVisibility: boolean;
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
      {!hideVisibility && (
        <CreatePollVisibility value={form.visibility} onChange={form.setVisibility} />
      )}
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
