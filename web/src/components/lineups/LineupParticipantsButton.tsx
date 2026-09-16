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

/**
 * ROK-1582: on a phone this chip is a real control in the hero badge row, so
 * it gets a 44px target and `text-sm` on the same secondary surface as the
 * scheduling hero actions (`border-edge-strong` on `bg-surface`). From `sm`
 * up it collapses back to the shipped compact 10px pill — one recipe with
 * responsive sizing, not two components. Tokens only, both colour families.
 */
const PARTICIPANTS_BUTTON_CLS =
  'inline-flex items-center gap-2 rounded-full border transition-colors ' +
  'min-h-[44px] px-3 py-2 text-sm border-edge-strong bg-surface text-foreground ' +
  'sm:min-h-0 sm:px-2 sm:py-0.5 sm:text-[10px] sm:border-edge sm:bg-transparent ' +
  'sm:text-muted hover:text-foreground hover:border-edge/80';

interface LineupParticipantsButtonProps {
  lineupId: number;
  /**
   * Scheduling-poll match id (ROK-1557). When given, the roster query asks the
   * server for the POLL's roster — creator + match members + schedule voters,
   * with `voted` meaning "voted on this poll" — instead of the lineup's
   * nomination-phase roster.
   */
  matchId?: number;
}

export function LineupParticipantsButton({
  lineupId,
  matchId,
}: LineupParticipantsButtonProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError, refetch } = useLineupParticipants(
    lineupId,
    matchId,
  );
  const participants = data?.participants ?? [];
  const loading = isLoading;
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
        onClick={() => {
          // ROK-1557: the roster is the answer to "who still has to vote?" —
          // opening the modal is the moment it has to be current, and the
          // 15s staleTime alone would serve the page-load snapshot.
          setOpen(true);
          void refetch();
        }}
        className={PARTICIPANTS_BUTTON_CLS}
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
        isError={isError}
        onRetry={() => void refetch()}
      />
    </>
  );
}
