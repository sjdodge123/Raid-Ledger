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
 *
 * Keyboard (menu pattern): opening focuses the first item; ArrowDown / ArrowUp
 * move (wrapping), Home / End jump; Esc closes back to the trigger.
 */
import { useEffect, useRef, type JSX, type KeyboardEvent, type MouseEvent, type RefObject } from 'react';
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
  const menuRef = useRef<HTMLDivElement>(null);
  useFocusFirstItem(menuRef, !hidden);
  const onClickCapture = (e: MouseEvent<HTMLDivElement>): void => {
    const item = e.target instanceof Element ? e.target.closest('[role="menuitem"]') : null;
    if (item && e.currentTarget.contains(item)) onSelect();
  };
  return (
    <div
      ref={menuRef}
      role="menu"
      data-testid="scheduling-manage-menu"
      hidden={hidden}
      onClickCapture={onClickCapture}
      onKeyDown={onMenuKeyDown}
      className="absolute right-0 mt-1 w-[232px] bg-surface border border-edge rounded-lg shadow-xl z-50 py-1"
    >
      <ManageMenuSurface>
        <ManageMenuItems {...props} />
      </ManageMenuSurface>
    </div>
  );
}

/** The menu's enabled items, in DOM order. */
function menuItems(menu: HTMLElement | null): HTMLElement[] {
  return Array.from(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []);
}

/** Focus the first item each time the menu opens. */
function useFocusFirstItem(menuRef: RefObject<HTMLDivElement | null>, open: boolean): void {
  useEffect(() => {
    if (open) menuItems(menuRef.current)[0]?.focus();
  }, [menuRef, open]);
}

/** ArrowDown / ArrowUp (wrapping), Home / End between the menu's items. */
function onMenuKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
  const items = menuItems(e.currentTarget);
  if (items.length === 0) return;
  const at = items.indexOf(document.activeElement as HTMLElement);
  const last = items.length - 1;
  const next: Record<string, number> = {
    ArrowDown: at < 0 || at === last ? 0 : at + 1,
    ArrowUp: at <= 0 ? last : at - 1,
    Home: 0,
    End: last,
  };
  if (!(e.key in next)) return;
  e.preventDefault();
  items[next[e.key]].focus();
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
