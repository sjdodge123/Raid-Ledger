/**
 * "Poll actions ⋯" — the leading card's organiser menu (ROK-1618).
 *
 * The lock that ends a poll used to be a full-width cyan bar floating in the
 * toolbar immediately ABOVE this card (`StickyHeroLockPollButton`, deleted).
 * It now lives here, on the card that names the time it locks, beside the new
 * Rally nudge — one home for both (AC5). The per-row "Lock this time →" in
 * `SchedulingSlotRow` is untouched (AC6).
 *
 * This is the Manage-poll menu's recipe, not a new pattern: `useMenuOpenState`
 * + `ManageMenuSurface`/`SchedulingSheetRow` + `BottomSheet`, switching at the
 * SAME `DESKTOP_MQ` (1024px) the "Manage poll ⋯" trigger 40px above it uses —
 * two menus on one page flipping at different widths would be the bug.
 * `SchedulingManageDropdown`/`SchedulingManageSheet` are not themselves
 * reusable (each hardcodes its three action children), so this is a thin
 * sibling built from the same primitives.
 *
 * Nothing renders for a viewer who cannot lock: a plain member sees no ⋯ at
 * all (AC4), and neither does anyone on a read-only poll.
 */
import { useRef, type JSX, type MouseEvent } from 'react';
import { useMenuOpenState } from '../use-menu-open-state';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { BottomSheet } from '../../ui/bottom-sheet';
import { SheetTitleRow } from '../../../pages/scheduling/SheetTitleRow';
import { SCHEDULING_ICON_TRIGGER } from './scheduling-action-button';
import { ManageMenuSurface, SchedulingSheetRow } from './scheduling-sheet-row';
import { onMenuKeyDown, useFocusFirstItem } from './scheduling-menu-keys';
import { SchedulingRallyAction } from './SchedulingRallyAction';

export interface SchedulingLeaderMenuProps {
  lineupId: number;
  matchId: number;
  /** The poll no longer accepts votes — no organiser menu at all. */
  readOnly: boolean;
  /** Viewer may end the poll (operator/creator) AND a leading slot exists. */
  canLock: boolean;
  /** Human-readable leading time, carried in the Lock item's name. */
  leadingTimeLabel: string;
  /** Poll members who have not voted yet (AC8's empty state at `0`). */
  pendingVoterCount?: number;
  /** End the poll on the leading slot. */
  onLock: () => void;
}

type MenuItemsProps = SchedulingLeaderMenuProps;

/** Lock this time · Rally — the menu's two items, in DOM order. */
function LeaderMenuItems(props: MenuItemsProps): JSX.Element {
  const { lineupId, matchId, leadingTimeLabel, pendingVoterCount, onLock } = props;
  return (
    <>
      <SchedulingSheetRow
        title={`Lock this time — ${leadingTimeLabel}`}
        testId="scheduling-leader-lock"
        onClick={onLock}
      />
      <SchedulingRallyAction
        lineupId={lineupId}
        matchId={matchId}
        pendingVoterCount={pendingVoterCount}
      />
    </>
  );
}

/**
 * The desktop 232px popover. Always MOUNTED and toggled with `hidden`, like
 * `SchedulingManageDropdown`'s: the Lock item opens a confirm modal that the
 * composite owns, and unmounting the menu mid-click would race it.
 */
function LeaderPopover(
  props: MenuItemsProps & { hidden: boolean; onSelect: () => void },
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
      data-testid="scheduling-leader-menu-popover"
      hidden={hidden}
      onClickCapture={onClickCapture}
      onKeyDown={onMenuKeyDown}
      className="absolute right-0 mt-1 w-[232px] bg-surface border border-edge rounded-lg shadow-xl z-50 py-1"
    >
      <ManageMenuSurface>
        <LeaderMenuItems {...props} />
      </ManageMenuSurface>
    </div>
  );
}

/** The phone/tablet bottom sheet — 52px rows, mounted only while open. */
function LeaderSheet(
  props: MenuItemsProps & { onClose: () => void },
): JSX.Element {
  const { onClose } = props;
  return (
    <BottomSheet isOpen onClose={onClose} ariaLabel="Poll actions">
      <div
        data-testid="scheduling-leader-menu-sheet"
        className="flex flex-col gap-1 pb-2"
      >
        <SheetTitleRow
          title="Poll actions"
          onClose={onClose}
          testId="scheduling-leader-menu-title"
        />
        <LeaderMenuItems {...props} />
      </div>
    </BottomSheet>
  );
}

/** Trigger + dropdown (≥1024px) / bottom sheet (below) — see docstring. */
export function SchedulingLeaderMenu(
  props: SchedulingLeaderMenuProps,
): JSX.Element | null {
  const isDesktop = useMediaQuery(DESKTOP_MQ);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // `outsideClickCloses = isDesktop`: `BottomSheet` portals to document.body,
  // so a document-level outside listener reads a tap on one of its rows as
  // "outside" and closes the menu before the row's handler runs (ROK-1584 P1).
  const { isOpen, open, close, containerRef } = useMenuOpenState(isDesktop, triggerRef);
  if (!props.canLock || props.readOnly) return null;
  return (
    <div className="relative flex-shrink-0" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        data-testid="scheduling-leader-menu"
        aria-label="Poll actions"
        aria-haspopup={isDesktop ? 'menu' : 'dialog'}
        aria-expanded={isOpen}
        onClick={() => (isOpen ? close() : open())}
        className={SCHEDULING_ICON_TRIGGER}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {isDesktop ? (
        <LeaderPopover
          {...props}
          hidden={!isOpen}
          onSelect={() => close({ restoreFocus: true })}
        />
      ) : (
        isOpen && <LeaderSheet {...props} onClose={() => close({ restoreFocus: true })} />
      )}
    </div>
  );
}
