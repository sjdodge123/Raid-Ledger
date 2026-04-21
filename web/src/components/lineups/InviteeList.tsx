/**
 * Read-only invitee roster for a private lineup (ROK-1065).
 *
 * Each row shows the invitee display name and a Steam-link indicator.
 * The creator/admin/operator sees a trash icon that calls the remove-invitee
 * mutation. Remains rendered for everyone (even non-managers) so private
 * lineups feel like a real roster on the detail page.
 */
import { type JSX } from 'react';
import type { LineupInviteeResponseDto } from '@raid-ledger/contract';
import { useRemoveLineupInvitee } from '../../hooks/use-lineups';
import { toast } from '../../lib/toast';

export interface InviteeListProps {
  lineupId: number;
  invitees: LineupInviteeResponseDto[];
  /** True when the viewer can remove invitees (creator/admin/operator). */
  canManage: boolean;
}

/**
 * Render the invitee roster with optional remove buttons.
 */
export function InviteeList({
  lineupId,
  invitees,
  canManage,
}: InviteeListProps): JSX.Element {
  if (invitees.length === 0) {
    return (
      <div
        data-testid="invitee-list-empty"
        className="text-sm text-muted italic"
      >
        No invitees yet.
      </div>
    );
  }
  return (
    <ul
      data-testid="invitee-list"
      className="flex flex-wrap gap-2"
    >
      {invitees.map((inv) => (
        <InviteeRow
          key={inv.id}
          lineupId={lineupId}
          invitee={inv}
          canManage={canManage}
        />
      ))}
    </ul>
  );
}

function InviteeRow({
  lineupId,
  invitee,
  canManage,
}: {
  lineupId: number;
  invitee: LineupInviteeResponseDto;
  canManage: boolean;
}): JSX.Element {
  const remove = useRemoveLineupInvitee();
  const handleRemove = (): void => {
    remove.mutate(
      { lineupId, userId: invitee.id },
      {
        onError: (err) =>
          toast.error(
            err instanceof Error ? err.message : 'Failed to remove invitee',
          ),
      },
    );
  };
  return (
    <li
      data-testid={`invitee-row-${invitee.id}`}
      className="inline-flex items-center gap-2 px-2 py-1 rounded border border-edge bg-panel text-sm"
    >
      <span className="text-primary">{invitee.displayName}</span>
      {invitee.steamLinked && (
        <span
          title="Steam account linked"
          className="text-xs text-muted"
        >
          · Steam
        </span>
      )}
      {canManage && (
        <button
          type="button"
          aria-label={`Remove ${invitee.displayName}`}
          onClick={handleRemove}
          disabled={remove.isPending}
          className="text-muted hover:text-red-400 transition-colors disabled:opacity-50"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      )}
    </li>
  );
}
