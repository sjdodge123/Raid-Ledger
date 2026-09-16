/**
 * "Manage poll ⋯" — the phone home of the scheduling poll's creator/operator
 * actions (ROK-1584, approved design §1).
 *
 * Below the phone breakpoint the hero's header cluster no longer carries a row
 * of three buttons (ROK-1582's fix for a row that hung past the card edge was
 * itself only a stop-gap): the hero's `manage` slot gets ONE full-width 44px
 * row, and the three actions become 52px rows of a bottom sheet. From the
 * breakpoint up nothing changes — `SchedulingToolbar` keeps passing the inline
 * buttons into `headerAction` (the desktop dropdown round is ROK-1585).
 *
 * The mutations are NOT duplicated here: each action component renders itself
 * as a sheet row via `variant="row"`, so its hook, gate, in-flight copy and
 * modal are exactly the ones the desktop button uses.
 */
import { useState, type JSX } from 'react';
import type { MatchDetailResponseDto } from '@raid-ledger/contract';
import { BottomSheet } from '../../ui/bottom-sheet';
import { SheetTitleRow } from '../../../pages/scheduling/SheetTitleRow';
import { useAuth, isOperatorOrAdmin } from '../../../hooks/use-auth';
import { canBypassThreshold } from '../../../pages/scheduling/threshold';
import { SCHEDULING_MANAGE_BUTTON } from './scheduling-action-button';
import { SchedulingAddMembersAction } from './SchedulingAddMembersAction';
import { SchedulingRemindAction } from './SchedulingRemindAction';
import { SchedulingCancelAction } from './SchedulingCancelAction';

export interface SchedulingManageProps {
  lineupId: number;
  matchId: number;
  match: MatchDetailResponseDto;
  readOnly: boolean;
  /** Distinct voters so far (poll.uniqueVoterCount) — drives "N haven't voted". */
  uniqueVoterCount?: number;
}

/**
 * Poll members who have not voted yet, or `undefined` when the counts aren't
 * both known (the row then draws no subline rather than a wrong one).
 */
export function pendingVoterCount(
  match: MatchDetailResponseDto,
  uniqueVoterCount: number | undefined,
): number | undefined {
  const members = match.members?.length;
  if (members == null || uniqueVoterCount == null) return undefined;
  return Math.max(0, members - uniqueVoterCount);
}

/** The sheet itself — mounted only while open (a closed `BottomSheet` still
 *  renders its children into the portal). */
export function SchedulingManageSheet(
  props: SchedulingManageProps & { onClose: () => void },
): JSX.Element {
  const { lineupId, matchId, match, readOnly, uniqueVoterCount, onClose } = props;
  return (
    <BottomSheet isOpen onClose={onClose} ariaLabel="Manage poll">
      <div
        data-testid="scheduling-manage-sheet"
        className="flex flex-col gap-1 pb-2"
      >
        <SheetTitleRow
          title="Manage poll"
          onClose={onClose}
          testId="scheduling-manage-title"
        />
        <SchedulingAddMembersAction
          variant="row"
          lineupId={lineupId}
          matchId={matchId}
          match={match}
          readOnly={readOnly}
        />
        <SchedulingRemindAction
          variant="row"
          lineupId={lineupId}
          matchId={matchId}
          match={match}
          readOnly={readOnly}
          pendingVoterCount={pendingVoterCount(match, uniqueVoterCount)}
        />
        <SchedulingCancelAction
          variant="row"
          lineupId={lineupId}
          matchId={matchId}
          readOnly={readOnly}
        />
      </div>
    </BottomSheet>
  );
}

/**
 * The hero's `manage` slot: a full-width "Manage poll ⋯" row for the poll's
 * creator, operators and admins. Everyone else (and every read-only poll) gets
 * nothing — the same gates the three actions apply individually.
 */
export function SchedulingManageButton(
  props: SchedulingManageProps,
): JSX.Element | null {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const canManage =
    isOperatorOrAdmin(user) || canBypassThreshold(user, props.match);
  if (!canManage || props.readOnly) return null;
  return (
    <>
      <button
        type="button"
        data-testid="scheduling-manage"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={SCHEDULING_MANAGE_BUTTON}
      >
        <span>Manage poll</span>
        <span aria-hidden="true">⋯</span>
      </button>
      {open && (
        <SchedulingManageSheet {...props} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
