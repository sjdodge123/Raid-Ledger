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
import { useLineupParticipants } from '../../hooks/use-lineups';
import { MemberAvatarGroup } from './decided/MemberAvatarGroup';
import { LineupParticipantsModal } from './LineupParticipantsModal';

interface LineupParticipantsButtonProps {
  lineupId: number;
}

export function LineupParticipantsButton({
  lineupId,
}: LineupParticipantsButtonProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError, refetch } = useLineupParticipants(lineupId);
  const participants = data?.participants ?? [];
  const count = participants.length;

  // Loading → no count yet; otherwise "Participants · N".
  const label = isLoading ? 'Participants' : `Participants · ${count}`;
  const accessibleName = isLoading
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
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
      />
    </>
  );
}
