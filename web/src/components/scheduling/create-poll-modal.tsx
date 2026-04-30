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
import { getPlayers } from '../../lib/api-client';

interface CreatePollModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Duration options for the standalone poll picker (ROK-1192). */
const DURATION_OPTIONS = [
  { hours: 24, label: '24 hours' },
  { hours: 48, label: '48 hours' },
  { hours: 72, label: '72 hours' },
  { hours: 168, label: '7 days' },
] as const;

const DEFAULT_DURATION_HOURS = 72;

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

/** Duration picker — voting window for the poll (ROK-1192). */
function DurationPicker({ value, onChange }: {
  value: number; onChange: (v: number) => void;
}) {
  return (
    <div
      data-testid="poll-duration-picker"
      className="flex items-center justify-between gap-3"
    >
      <label className="text-sm font-medium text-secondary shrink-0">
        Voting window
      </label>
      <div className="flex gap-1">
        {DURATION_OPTIONS.map((opt) => (
          <label
            key={opt.hours}
            className={`px-2.5 py-1 rounded-md cursor-pointer text-xs border transition-colors ${
              value === opt.hours
                ? 'bg-emerald-600 border-emerald-500 text-foreground'
                : 'bg-surface/50 border-surface text-muted hover:border-emerald-500/50'
            }`}
          >
            <input
              type="radio"
              name="poll-duration"
              value={opt.hours}
              checked={value === opt.hours}
              onChange={() => onChange(opt.hours)}
              className="sr-only"
            />
            {opt.label}
          </label>
        ))}
      </div>
    </div>
  );
}

/** Minimum votes slider — always visible (ROK-1015). */
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
  const { data: players } = useQuery({
    queryKey: ['players', 'member-picker', ''],
    queryFn: () => getPlayers({ page: 1 }),
    select: (d) => d.data ?? [],
  });
  const totalMembers = players?.length ?? 20;
  const sliderMax = Math.max(1, form.memberIds.length > 0 ? form.memberIds.length : totalMembers);
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
