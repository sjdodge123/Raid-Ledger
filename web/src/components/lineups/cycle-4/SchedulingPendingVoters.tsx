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

/** The avatar-group shape of a poll member. */
function toAvatarMember(m: SchedulingPollMember) {
  return {
    userId: m.userId,
    displayName: m.displayName,
    avatar: m.avatar,
    discordId: m.discordId,
    customAvatarUrl: m.customAvatarUrl,
  };
}

/** Outstanding-voter panel — see file-level docstring. */
export function SchedulingPendingVoters(
  props: SchedulingPendingVotersProps,
): JSX.Element | null {
  const pending = pendingVoters(props.members);
  if (pending.length === 0) return null;
  // With ≤3 outstanding the copy names everyone, so the avatar strip is
  // decorative: hide it from assistive tech, or a screen reader announces each
  // name (or a bare initial, "S") before the count and then again after it.
  const namesInCopy = pending.length <= 3;
  return (
    <div
      data-testid="scheduling-pending-voters"
      className="flex items-center gap-2 rounded-lg border border-edge bg-panel/40 px-3 py-2"
    >
      <div aria-hidden={namesInCopy ? true : undefined}>
        <MemberAvatarGroup members={pending.map(toAvatarMember)} max={5} />
      </div>
      <span
        data-testid="scheduling-pending-voters-summary"
        className="text-xs text-secondary"
      >
        <span className="font-medium text-foreground">{pending.length}</span>{' '}
        still to vote
        {namesInCopy && (
          <> · {pending.map((m) => m.displayName).join(', ')}</>
        )}
      </span>
    </div>
  );
}
