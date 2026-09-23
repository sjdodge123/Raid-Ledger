/**
 * "⋯" — the organiser menu carried by EVERY time card (ROK-1635 AC3).
 *
 * ROK-1618 put Lock + Rally in a menu on the leading card only, while the
 * ladder's rows kept a separate inline cyan `Lock this time →` button and no
 * Rally at all: two control sets for the same job. This component is that
 * menu, generalised — the leading card and every row render the SAME items
 * against their OWN slot, and differ only in `testIdPrefix` (so ROK-1618's
 * `scheduling-leader-*` selectors survive untouched) and in the card styling
 * around them.
 *
 * This is the Manage-poll menu's recipe, not a new pattern: `useMenuOpenState`
 * + `ManageMenuSurface`/`SchedulingSheetRow` + `BottomSheet`, switching at the
 * SAME `DESKTOP_MQ` (1024px) every other menu on the page uses — N menus on
 * one page flipping at different widths would be the bug. Token-only classes:
 * the cyan/white inline lock button this story deletes took its hardcoded
 * palette with it, and nothing here adds one back.
 *
 * Nothing renders for a viewer who cannot manage the poll: a plain member sees
 * no ⋯ at all (OQ-2 — no menu, not an empty one), and neither does anyone on a
 * read-only poll. A menu with zero items never renders either, which is what
 * hides it on a row whose time has already passed (Lock and Rally are both
 * refused there by the server).
 *
 * The Rally cooldown is per POLL (6h, §3.4), so it is NOT owned here — one
 * {@link RallyCooldown} is hoisted into the composite and handed to every
 * menu, and one rally therefore leaves every row reading "Rallied ✓".
 */
import { useRef, type JSX, type MouseEvent } from 'react';
import type { ScheduleSlotWithVotesDto } from '@raid-ledger/contract';
import { useMenuOpenState } from '../use-menu-open-state';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { BottomSheet } from '../../ui/bottom-sheet';
import { SheetTitleRow } from '../../../pages/scheduling/SheetTitleRow';
import { SCHEDULING_ICON_TRIGGER } from './scheduling-action-button';
import { ManageMenuSurface, SchedulingSheetRow } from './scheduling-sheet-row';
import { onMenuKeyDown, useFocusFirstItem } from './scheduling-menu-keys';
import { SchedulingRallyAction } from './SchedulingRallyAction';
import type { RallyCooldown } from './use-rally-cooldown';

/**
 * Which family of testids this instance draws. The leading card keeps
 * ROK-1618's `scheduling-leader-*` ids verbatim; rows get `scheduling-slot-*`
 * and are scoped by the row's own `data-slot-id`.
 */
export type SchedulingTimeMenuTestIds = 'scheduling-leader' | 'scheduling-slot';

export interface SchedulingTimeMenuProps {
  lineupId: number;
  matchId: number;
  /** The time this menu acts on — its id is what Rally and Lock carry. */
  slot: ScheduleSlotWithVotesDto;
  /** Human-readable label for {@link slot}, used in every accessible name. */
  timeLabel: string;
  /** Organiser gate (operator/creator). False → no ⋯ at all. */
  canManage: boolean;
  /** This slot may be locked: not past, and allowed by the expired-poll rule. */
  canLock: boolean;
  /** This slot may be rallied (false once its time has passed). */
  canRally?: boolean;
  /** The poll no longer accepts votes — no organiser menu at all. */
  readOnly: boolean;
  /** Poll members with no stance on THIS slot (AC8's empty state at `0`). */
  pendingVoterCount?: number;
  /** The ONE per-poll rally cooldown, hoisted into the composite (§3.4). */
  cooldown: RallyCooldown;
  testIdPrefix: SchedulingTimeMenuTestIds;
  /** End the poll on {@link slot}. */
  onLock: () => void;
}

/** Lock this time · Rally — the menu's items, in DOM order. */
function TimeMenuItems(props: SchedulingTimeMenuProps): JSX.Element {
  const { lineupId, matchId, slot, timeLabel, canLock, onLock } = props;
  const { cooldown, pendingVoterCount, testIdPrefix } = props;
  return (
    <>
      {canLock && (
        <SchedulingSheetRow
          /* The 232px popover truncates the time out of a one-line title, so
             it goes on the second line; the accessible name keeps the full
             label the unit + smoke specs query by. */
          title="Lock this time"
          subline={timeLabel}
          showSubline
          ariaLabel={`Lock this time — ${timeLabel}`}
          testId={`${testIdPrefix}-lock`}
          onClick={onLock}
        />
      )}
      {props.canRally !== false && (
        <SchedulingRallyAction
          lineupId={lineupId}
          matchId={matchId}
          slotId={slot.id}
          pendingVoterCount={pendingVoterCount}
          cooldownHours={cooldown.hours}
          testId={`${testIdPrefix}-rally`}
          onArm={cooldown.arm}
        />
      )}
    </>
  );
}

/**
 * The desktop 232px popover. Always MOUNTED and toggled with `hidden`, like
 * `SchedulingManageDropdown`'s: the Lock item opens a confirm modal that the
 * composite owns, and unmounting the menu mid-click would race it.
 */
function TimePopover(
  props: SchedulingTimeMenuProps & { hidden: boolean; onSelect: () => void },
): JSX.Element {
  const { hidden, onSelect } = props;
  const menuRef = useRef<HTMLDivElement>(null);
  useFocusFirstItem(menuRef, !hidden);
  const onClickCapture = (e: MouseEvent<HTMLDivElement>): void => {
    const item = e.target instanceof Element ? e.target.closest('[role="menuitem"]') : null;
    // `data-keep-open` rows (Rally) act in place and draw their own
    // in-flight/success/cooldown states — closing would hide all of them.
    if (!item || !e.currentTarget.contains(item)) return;
    if (item.hasAttribute('data-keep-open')) return;
    onSelect();
  };
  return (
    <div
      ref={menuRef}
      role="menu"
      data-testid={`${props.testIdPrefix}-menu-popover`}
      hidden={hidden}
      onClickCapture={onClickCapture}
      onKeyDown={onMenuKeyDown}
      className="absolute right-0 mt-1 w-[232px] bg-surface border border-edge rounded-lg shadow-xl z-50 py-1"
    >
      <ManageMenuSurface>
        <TimeMenuItems {...props} />
      </ManageMenuSurface>
    </div>
  );
}

/** The phone/tablet bottom sheet — 52px rows, mounted only while open. */
function TimeSheet(
  props: SchedulingTimeMenuProps & { label: string; onClose: () => void },
): JSX.Element {
  const { label, onClose, testIdPrefix } = props;
  return (
    <BottomSheet isOpen onClose={onClose} ariaLabel={label}>
      <div
        data-testid={`${testIdPrefix}-menu-sheet`}
        className="flex flex-col gap-1 pb-2"
      >
        <SheetTitleRow
          title={label}
          onClose={onClose}
          testId={`${testIdPrefix}-menu-title`}
        />
        <TimeMenuItems {...props} />
      </div>
    </BottomSheet>
  );
}

/**
 * The trigger's accessible name. The leading card keeps ROK-1618's "Poll
 * actions" verbatim (its specs and the smoke suite query by it); a row names
 * its own time, because N identically-labelled triggers on one page are
 * unusable with a screen reader.
 */
function triggerLabel(props: SchedulingTimeMenuProps): string {
  return props.testIdPrefix === 'scheduling-leader'
    ? 'Poll actions'
    : `Time actions — ${props.timeLabel}`;
}

/** Trigger + dropdown (≥1024px) / bottom sheet (below) — see docstring. */
export function SchedulingTimeMenu(
  props: SchedulingTimeMenuProps,
): JSX.Element | null {
  const isDesktop = useMediaQuery(DESKTOP_MQ);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // `outsideClickCloses = isDesktop`: `BottomSheet` portals to document.body,
  // so a document-level outside listener reads a tap on one of its rows as
  // "outside" and closes the menu before the row's handler runs (ROK-1584 P1).
  const { isOpen, open, close, containerRef } = useMenuOpenState(isDesktop, triggerRef);
  const hasItems = props.canLock || props.canRally !== false;
  if (!props.canManage || props.readOnly || !hasItems) return null;
  const label = triggerLabel(props);
  return (
    <div className="relative flex-shrink-0" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        data-testid={`${props.testIdPrefix}-menu`}
        aria-label={label}
        aria-haspopup={isDesktop ? 'menu' : 'dialog'}
        aria-expanded={isOpen}
        onClick={() => (isOpen ? close() : open())}
        className={SCHEDULING_ICON_TRIGGER}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {isDesktop ? (
        <TimePopover
          {...props}
          hidden={!isOpen}
          onSelect={() => close({ restoreFocus: true })}
        />
      ) : (
        isOpen && (
          <TimeSheet
            {...props}
            label={label}
            onClose={() => close({ restoreFocus: true })}
          />
        )
      )}
    </div>
  );
}
