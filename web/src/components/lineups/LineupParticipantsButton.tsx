/**
 * Hero "Participants · N" button (ROK-1346).
 *
 * Always renders in the JourneyHero `action` slot across every lineup phase
 * (plus the archived/aborted fallback header). Shows the roster count + a small
 * avatar stack and opens the read-only {@link LineupParticipantsModal}.
 *
 * The roster query (`useLineupParticipants`) is enabled on the detail page so
 * the count is available up front; the modal reuses the same cached query.
 * While loading, the label degrades to "Participants" (no count) and the
 * button never blocks hero render.
 */
import { useState, type JSX } from 'react';
import type { LineupParticipantDto } from '@raid-ledger/contract';
import { useLineupParticipants } from '../../hooks/use-lineups';
import { MemberAvatarGroup } from './decided/MemberAvatarGroup';
import { LineupParticipantsModal } from './LineupParticipantsModal';

interface LineupParticipantsButtonProps {
  lineupId: number;
  /**
   * Override the participant source. Scheduling polls pass the match's invited
   * members — the lineup roster is just the creator there, so the roster query
   * renders "Participants · 1". When provided, the roster query is skipped.
   */
  participantsOverride?: LineupParticipantDto[];
}

export function LineupParticipantsButton({
  lineupId,
  participantsOverride,
}: LineupParticipantsButtonProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError, refetch } = useLineupParticipants(
    participantsOverride ? undefined : lineupId,
  );
  const participants = participantsOverride ?? data?.participants ?? [];
  const loading = participantsOverride ? false : isLoading;
  const count = participants.length;

  // Loading → no count yet; otherwise "Participants · N".
  const label = loading ? 'Participants' : `Participants · ${count}`;
  const accessibleName = loading
    ? 'Participants'
    : `Participants, ${count}`;

  return (
    <>
      <button
        type="button"
        data-testid="lineup-participants-button"
        aria-label={accessibleName}
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-2 py-0.5 text-[10px] rounded-full border border-edge text-muted hover:text-foreground hover:border-edge/80 transition-colors"
      >
        <span className="whitespace-nowrap">{label}</span>
        {count > 0 && (
          <MemberAvatarGroup members={participants} max={4} />
        )}
      </button>
      <LineupParticipantsModal
        isOpen={open}
        onClose={() => setOpen(false)}
        participants={participants}
        isLoading={loading}
        isError={participantsOverride ? false : isError}
        onRetry={() => void refetch()}
      />
    </>
  );
}
