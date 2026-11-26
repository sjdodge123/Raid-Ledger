/**
 * Render the lineup invitee panel (ROK-1065, ROK-1440). Creator/operator
 * sees the "Invite more" button; everyone else sees the read-only roster.
 *
 * ROK-1440: rendered for public lineups too. The two visibilities mean
 * different things, so the chrome differs — on PRIVATE the roster is an
 * access gate (amber callout, the established ROK-1065 treatment); on
 * PUBLIC it is a seed list, so it gets neutral panel chrome plus an
 * explicit "anyone else can still join" line. The panel is hidden entirely
 * on a public lineup with no invitees and no ability to add any, so an
 * ordinary viewer sees no new empty box.
 *
 * ROK-2349: an archived or aborted lineup is read-only — the roster stays
 * visible but "Invite more" and the per-chip remove control are hidden,
 * the same condition that renders the NominationGrid read-only.
 */
import type { JSX } from 'react';
import type {
  LineupDetailResponseDto,
  LineupInviteeResponseDto,
} from '@raid-ledger/contract';
import { InviteeList } from './InviteeList';
import { AddInviteesButton } from './AddInviteesButton';

/** ROK-2349: archived and aborted lineups accept no further edits. */
export function isLineupReadOnly(
  status: LineupDetailResponseDto['status'],
  isAborted: boolean,
): boolean {
  return isAborted || status === 'archived';
}

export interface LineupInviteesSectionProps {
  lineupId: number;
  invitees: LineupInviteeResponseDto[];
  /** Creator / admin / operator. */
  canManage: boolean;
  /** Archived or aborted — hides every invite/remove control. */
  readOnly?: boolean;
  visibility: 'public' | 'private';
}

export function LineupInviteesSection({
  lineupId,
  invitees,
  canManage: rawCanManage,
  readOnly = false,
  visibility,
}: LineupInviteesSectionProps): JSX.Element | null {
  const canManage = rawCanManage && !readOnly;
  const isPrivate = visibility === 'private';
  if (!isPrivate && invitees.length === 0 && !canManage) return null;
  return (
    <section
      data-testid="lineup-invitees-section"
      data-visibility={visibility}
      className={`mt-4 p-4 rounded-lg border ${
        isPrivate
          ? 'border-warning/30 bg-warning/5'
          : 'border-edge bg-panel/40'
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold text-foreground">
          {isPrivate ? 'Invitees' : 'Invited members'} ({invitees.length})
        </h2>
        {canManage && (
          <AddInviteesButton lineupId={lineupId} visibility={visibility} />
        )}
      </div>
      <p className="text-xs text-muted mb-3">
        {isPrivate
          ? 'Only these members can see and join this lineup.'
          : 'Pulled in directly. Anyone else in the community can still see and join.'}
      </p>
      <InviteeList
        lineupId={lineupId}
        invitees={invitees}
        canManage={canManage}
      />
    </section>
  );
}
