/**
 * LineupDetailHeader (ROK-1323) — reduced to a compact top bar after the
 * legacy chrome strip. The title / status badge / 4-phase breadcrumb / phase
 * circle / "Started by…" meta / Edit + Abort buttons / PublicShareRow all
 * moved: title + meta now live in the per-phase composite's JourneyHero
 * (see LineupHeroMeta), and operator/share affordances live in the
 * LineupOperatorMenu `⋮` dropdown.
 *
 * What remains here: back navigation, the private-state badge, the operator
 * `⋮` menu (operator-or-creator), and the member-visible Copy-link affordance
 * when the lineup is public-share-enabled (preservation-risk #2).
 */
import type { JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LineupDetailResponseDto } from '@raid-ledger/contract';
import { useAuth, isOperatorOrAdmin } from '../../hooks/use-auth';
import { LineupOperatorMenu } from './LineupOperatorMenu';
import { LineupShareCopy } from './LineupShareCopy';
import { LineupHeroMeta } from './LineupHeroMeta';
import { LineupParticipantsButton } from './LineupParticipantsButton';
import { LineupStatusBadge } from './LineupStatusBadge';

interface Props {
  lineup: LineupDetailResponseDto;
  /** ROK-1207: when true the lineup is aborted — advance/revert are disabled. */
  isAborted?: boolean;
  onTiebreakerIntercept?: () => void;
}

export function LineupDetailHeader({
  lineup,
  isAborted = false,
  onTiebreakerIntercept,
}: Props): JSX.Element {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isOperator = isOperatorOrAdmin(user);
  // Members (and non-operator creators) get a standalone Copy-link icon when
  // sharing is open; operators reach the same copy inside the `⋮` menu.
  const showMemberCopy =
    !isOperator && lineup.visibility !== 'private' && lineup.publicShareEnabled;
  // ROK-1323 (Codex review): the title+creator now live in the per-phase
  // composite's JourneyHero. But several states render NO composite hero —
  // aborted → AbortedReadOnlySnapshot, archived/other → NominationGrid, and
  // voting with zero entries → LineupEmptyState. Render a fallback title/meta
  // inline whenever the composite hero is absent so the lineup stays
  // identifiable. (Mirrors LineupDetailBody's branch logic.)
  const hasCompositeHero =
    !isAborted &&
    (lineup.status === 'building' ||
      (lineup.status === 'voting' && lineup.entries.length > 0) ||
      lineup.status === 'decided');
  const showFallbackTitle = !hasCompositeHero;

  // ROK-2349: on a phone the fallback title takes its own row and the
  // right-hand cluster (Participants / copy / ⋮) wraps beneath it, so a badge
  // never squeezes the title down to one letter. sm+ keeps a single row.
  const leftLayout = showFallbackTitle ? 'flex-1 basis-full sm:basis-0' : '';

  return (
    <div className="flex w-full flex-wrap items-center justify-between gap-2" data-testid="lineup-detail-header">
      <div className={`flex items-center gap-2 min-w-0 ${leftLayout}`} data-testid="lineup-header-lead">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="text-muted hover:text-foreground transition flex-shrink-0"
          aria-label="Go back"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        {lineup.visibility === 'private' && (
          <span
            data-testid="lineup-private-badge"
            title="Invite-only lineup"
            className="flex-shrink-0 px-2 py-0.5 text-xs font-semibold rounded bg-warning/10 text-warning border border-warning/40"
          >
            Private
          </span>
        )}
        {/* ROK-2349: an archived lineup says so (an aborted one has its own banner). */}
        {!isAborted && lineup.status === 'archived' && (
          <span data-testid="lineup-archived-badge" className="flex-shrink-0">
            <LineupStatusBadge status="archived" />
          </span>
        )}
        {showFallbackTitle && (
          <span className="min-w-0 flex-1" data-testid="lineup-fallback-title">
            <LineupHeroMeta lineup={lineup} />
          </span>
        )}
      </div>
      <div className="ml-auto flex items-center gap-2 flex-shrink-0" data-testid="lineup-header-actions">
        {/* ROK-1346: phases that render a composite JourneyHero host the
            Participants button in the hero `action` slot; the fallback states
            (archived / aborted / empty-voting) have no hero, so surface it
            here so the roster button is present across every lineup state. */}
        {showFallbackTitle && (
          <LineupParticipantsButton lineupId={lineup.id} />
        )}
        {showMemberCopy && <LineupShareCopy slug={lineup.publicSlug} variant="icon" />}
        <LineupOperatorMenu
          lineup={lineup}
          isAborted={isAborted}
          onTiebreakerIntercept={onTiebreakerIntercept}
        />
      </div>
    </div>
  );
}
