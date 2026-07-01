import type { JSX } from 'react';
import type { LineupDetailResponseDto } from '@raid-ledger/contract';
import { useTogglePublicShare } from '../../hooks/use-lineups';
import { useAuth, isOperatorOrAdmin } from '../../hooks/use-auth';
import { toast } from '../../lib/toast';
import { copyWithToast } from '../../lib/clipboard';
import { PublicShareToggle } from './PublicShareToggle';

/**
 * ROK-1067: public-share row beneath the detail header.
 *
 * - Private lineup: renders nothing (link wouldn't resolve).
 * - Operator: full toggle + copy-link.
 * - Member, share enabled: copy-link only (no toggle — they can share what
 *   the operator already opened up).
 * - Member, share disabled: nothing (no valid link to share).
 */
export function PublicShareRow({
  lineup,
}: {
  lineup: LineupDetailResponseDto;
}): JSX.Element | null {
  const { user } = useAuth();
  const toggle = useTogglePublicShare();
  if (!user) return null;
  if (lineup.visibility === 'private') return null;
  const isOperator = isOperatorOrAdmin(user);
  if (!isOperator && !lineup.publicShareEnabled) return null;
  if (!isOperator) {
    return (
      <div className="ml-8 mt-2">
        <PublicShareCopyOnly slug={lineup.publicSlug} />
      </div>
    );
  }
  return (
    <div className="ml-8 mt-2">
      <PublicShareToggle
        enabled={lineup.publicShareEnabled}
        onChange={(next) =>
          toggle.mutate(
            { lineupId: lineup.id, enabled: next },
            {
              onSuccess: () =>
                toast.success(
                  next ? 'Public link enabled' : 'Public link disabled',
                ),
              onError: (err) =>
                toast.error(
                  err instanceof Error ? err.message : 'Toggle failed',
                ),
            },
          )
        }
        slug={lineup.publicSlug}
        disabled={toggle.isPending}
      />
    </div>
  );
}

/** Copy-link only — for members on a public-share-enabled lineup. */
function PublicShareCopyOnly({ slug }: { slug: string }): JSX.Element {
  return (
    <div
      data-testid="public-share-copy-row"
      className="flex items-center justify-between gap-3 p-3 rounded border border-edge/40 bg-overlay/30"
    >
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted">
          Public link enabled — share with anyone.
        </p>
      </div>
      <button
        type="button"
        onClick={() => {
          const url = `${window.location.origin}/p/lineup/${slug}`;
          void copyWithToast(url, {
            success: 'Public link copied',
            error: 'Failed to copy link',
          });
        }}
        data-testid="public-share-copy"
        className="px-2.5 py-1.5 text-xs rounded border border-edge/50 hover:bg-overlay/50"
        aria-label="Copy public link"
      >
        Copy link
      </button>
    </div>
  );
}
