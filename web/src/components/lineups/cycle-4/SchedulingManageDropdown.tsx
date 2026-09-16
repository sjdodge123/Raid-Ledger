/**
 * "Manage poll ⋯" — the DESKTOP home of the scheduling poll's creator/operator
 * actions (ROK-1585, approved hero sheet v8 §5). From the 1024px breakpoint up
 * the hero's control cluster carries ONE 36px trigger opening a 232px
 * `role="menu"` popover (recipe: `LineupOperatorMenuDropdown`). Below it the
 * phone sheet (`SchedulingManageSheet`, ROK-1584) is unchanged.
 *
 * The popover is always MOUNTED and toggled with `hidden`: each action
 * component owns its modal/confirm state, so unmounting the menu on close
 * would kill the modal the item just opened. The rows render at menu density
 * via {@link ManageMenuSurface}.
 */
import { useRef, type JSX, type MouseEvent } from 'react';
import { useMenuOpenState } from '../use-menu-open-state';
import { SCHEDULING_ACTION_BUTTON } from './scheduling-action-button';
import { pendingVoterCount, useCanManagePoll } from './scheduling-manage.helpers';
import { ManageMenuSurface } from './scheduling-sheet-row';
import { SchedulingAddMembersAction } from './SchedulingAddMembersAction';
import { SchedulingRemindAction } from './SchedulingRemindAction';
import { SchedulingCancelAction } from './SchedulingCancelAction';
import type { SchedulingManageProps } from './SchedulingManageSheet';

/** Trigger + always-mounted popover; nothing for members / read-only polls. */
export function SchedulingManageDropdown(props: SchedulingManageProps): JSX.Element | null {
  const canManage = useCanManagePoll(props.match, props.readOnly);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { isOpen, open, close, containerRef } = useMenuOpenState(true, triggerRef);
  if (!canManage) return null;
  return (
    <div className="relative flex-shrink-0" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        data-testid="scheduling-manage"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => (isOpen ? close() : open())}
        className={SCHEDULING_ACTION_BUTTON}
      >
        <span>Manage poll</span>
        <span aria-hidden="true">⋯</span>
      </button>
      <ManagePopover {...props} hidden={!isOpen} onSelect={() => close({ restoreFocus: true })} />
    </div>
  );
}

/**
 * The 232px menu. An item click closes it from the capture phase; the item's
 * own handler still runs on the same event. Clicks that bubble up the React
 * tree from a portalled modal are NOT inside the popover's DOM and are ignored.
 */
function ManagePopover(
  props: SchedulingManageProps & { hidden: boolean; onSelect: () => void },
): JSX.Element {
  const { hidden, onSelect } = props;
  const onClickCapture = (e: MouseEvent<HTMLDivElement>): void => {
    const item = e.target instanceof Element ? e.target.closest('[role="menuitem"]') : null;
    if (item && e.currentTarget.contains(item)) onSelect();
  };
  return (
    <div
      role="menu"
      data-testid="scheduling-manage-menu"
      hidden={hidden}
      onClickCapture={onClickCapture}
      className="absolute right-0 mt-1 w-[232px] bg-surface border border-edge rounded-lg shadow-xl z-50 py-1"
    >
      <ManageMenuSurface>
        <ManageMenuItems {...props} />
      </ManageMenuSurface>
    </div>
  );
}

/** Add Participants · Remind Voters · separator · Cancel Poll. */
function ManageMenuItems(props: SchedulingManageProps): JSX.Element {
  const { lineupId, matchId, match, readOnly, uniqueVoterCount } = props;
  const ids = { lineupId, matchId, readOnly };
  return (
    <>
      <SchedulingAddMembersAction variant="row" {...ids} match={match} />
      <SchedulingRemindAction
        variant="row"
        {...ids}
        match={match}
        pendingVoterCount={pendingVoterCount(match, uniqueVoterCount)}
      />
      <div role="separator" className="my-1 border-t border-edge-subtle" />
      <SchedulingCancelAction variant="row" {...ids} />
    </>
  );
}
