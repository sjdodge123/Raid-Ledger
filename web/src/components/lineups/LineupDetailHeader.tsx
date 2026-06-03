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

  return (
    <div className="flex w-full items-center justify-between gap-2">
      <div className="flex items-center gap-2 min-w-0">
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
            className="px-2 py-0.5 text-xs font-semibold rounded bg-amber-600/20 text-amber-400 border border-amber-500/40"
          >
            Private
          </span>
        )}
        {showFallbackTitle && (
          <span className="min-w-0 flex-1" data-testid="lineup-fallback-title">
            <LineupHeroMeta lineup={lineup} />
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
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
