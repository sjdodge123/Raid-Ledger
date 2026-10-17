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

/** The shipped compact pill — every lineup hero and the archived header. */
const COMPACT_CLS =
  'inline-flex items-center gap-2 px-2 py-0.5 text-[10px] rounded-full border border-edge text-muted hover:text-foreground hover:border-edge/80 transition-colors';

/**
 * ROK-1585 (§5 desktop chip): from `lg` up a hero chip is a 36px, `text-xs`
 * control on the secondary surface (`border-edge-strong` on `bg-surface`).
 * Shared by `hero` and `touch` so every lineup stage reads the same on desktop.
 */
const DESKTOP_CHIP_CLS =
  'lg:min-h-[36px] lg:px-3 lg:py-0 lg:text-xs lg:border-edge-strong lg:bg-surface lg:text-foreground';

/**
 * ROK-1582: in the SCHEDULING hero this chip is a real control, so below `lg`
 * it gets a 44px target and `text-sm` on the same secondary surface as the
 * scheduling hero actions. From `lg` up it is the 36px desktop chip (ROK-1585).
 * Opt-in via `size="touch"`. Tokens only, both colour families.
 */
const TOUCH_CLS =
  'inline-flex items-center gap-2 rounded-full border transition-colors ' +
  'min-h-[44px] px-3 py-2 text-sm border-edge-strong bg-surface text-foreground ' +
  `hover:text-foreground lg:hover:border-edge-strong/80 ${DESKTOP_CHIP_CLS}`;

/**
 * ROK-1585 (Q2): the nominating / voting / decided heroes — the shipped
 * compact pill below `lg`, the 36px desktop chip from `lg` up.
 */
const HERO_CLS = `${COMPACT_CLS} ${DESKTOP_CHIP_CLS} lg:hover:border-edge-strong/80`;

const SIZE_CLS = { compact: COMPACT_CLS, touch: TOUCH_CLS, hero: HERO_CLS } as const;

interface LineupParticipantsButtonProps {
  lineupId: number;
  /**
   * Scheduling-poll match id (ROK-1557). When given, the roster query asks the
   * server for the POLL's roster — creator + match members + schedule voters,
   * with `voted` meaning "voted on this poll" — instead of the lineup's
   * nomination-phase roster.
   */
  matchId?: number;
  /**
   * `touch` = 44px phone target + 36px desktop chip (scheduling hero, ROK-1582);
   * `hero` = compact pill below `lg` + 36px desktop chip (other lineup heroes,
   * ROK-1585); default `compact` = the shipped pill (archived header).
   */
  size?: keyof typeof SIZE_CLS;
}

export function LineupParticipantsButton({
  lineupId,
  matchId,
  size = 'compact',
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
        className={SIZE_CLS[size]}
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
