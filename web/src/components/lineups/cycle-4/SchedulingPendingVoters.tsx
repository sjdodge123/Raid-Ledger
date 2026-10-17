/**
 * "Who hasn't voted yet" panel for the scheduling poll (ROK-1545 AC5).
 *
 * The poll's stall is almost always a handful of members who never opened it,
 * and until now the surface only showed who DID vote (audit F-05). This names
 * the outstanding members so an organiser can chase them (SchedulingRemindAction
 * does the chasing). Renders nothing once everyone has answered.
 */
import type { JSX } from 'react';
import { MemberAvatarGroup } from '../decided/MemberAvatarGroup';
import {
  pendingVoters,
  type SchedulingPollMember,
} from './scheduling-catch-up';

export interface SchedulingPendingVotersProps {
  members: readonly SchedulingPollMember[];
}

/** Outstanding-voter panel — see file-level docstring. */
export function SchedulingPendingVoters(
  props: SchedulingPendingVotersProps,
): JSX.Element | null {
  const pending = pendingVoters(props.members);
  if (pending.length === 0) return null;
  return (
    <div
      data-testid="scheduling-pending-voters"
      className="flex items-center gap-2 rounded-lg border border-edge bg-panel/40 px-3 py-2"
    >
      <MemberAvatarGroup
        members={pending.map((m) => ({
          userId: m.userId,
          displayName: m.displayName,
          avatar: m.avatar,
          discordId: m.discordId,
          customAvatarUrl: m.customAvatarUrl,
        }))}
        max={5}
      />
      <span className="text-xs text-secondary">
        <span className="font-medium text-foreground">{pending.length}</span>{' '}
        still to vote
        {pending.length <= 3 && (
          <> · {pending.map((m) => m.displayName).join(', ')}</>
        )}
      </span>
    </div>
  );
}
