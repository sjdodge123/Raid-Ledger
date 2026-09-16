/**
 * Open/close state for an anchored `role="menu"` popover (ROK-1323, extracted
 * from `LineupOperatorMenu` in ROK-1585 so the desktop "Manage poll ⋯" dropdown
 * shares it).
 *
 * While open (and `outsideClickCloses`), a document mousedown outside the
 * container or an Escape closes the menu. Two refinements over the original:
 *
 * - **Focus return.** Pass the trigger's ref and `close({ restoreFocus: true })`
 *   puts focus back on it. Escape always restores; an outside mousedown
 *   restores only when it did not land on something focusable (a click on
 *   another button keeps that button's focus).
 * - **Dialogs are not "outside".** Modals opened by a menu item portal to
 *   `document.body`, so a mousedown inside one would otherwise read as an
 *   outside click (the same class of bug as the ROK-1584 Codex P1 below).
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/** Options for {@link MenuOpenState.close}. */
export interface CloseMenuOptions {
  /** Move focus back to the trigger (keyboard / item-select paths). */
  restoreFocus?: boolean;
}

export interface MenuOpenState {
  isOpen: boolean;
  open: () => void;
  close: (opts?: CloseMenuOptions) => void;
  containerRef: RefObject<HTMLDivElement | null>;
}

const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex]';

/** Whether a mousedown target should be ignored (inside the menu or a dialog). */
function isInsideMenuOrDialog(target: EventTarget | null, container: HTMLElement | null): boolean {
  if (!(target instanceof Element)) return false;
  if (container?.contains(target)) return true;
  return target.closest('[role="dialog"]') != null;
}

/**
 * @param outsideClickCloses false for the phone/tablet sheet: `BottomSheet`
 *   portals to `document.body`, so a document-level "outside" listener would
 *   read a tap on one of its rows as outside the trigger and close the menu
 *   before the row's handler ran (Codex P1, ROK-1584). The sheet brings its
 *   own scrim + Escape handling.
 * @param triggerRef the element focus returns to on close.
 */
export function useMenuOpenState(
  outsideClickCloses: boolean,
  triggerRef?: RefObject<HTMLElement | null>,
): MenuOpenState {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const close = useCallback(
    (opts?: CloseMenuOptions) => {
      setIsOpen(false);
      if (opts?.restoreFocus === true) triggerRef?.current?.focus();
    },
    [triggerRef],
  );
  useEffect(() => {
    if (!isOpen || !outsideClickCloses) return;
    const onMouseDown = (e: MouseEvent): void => {
      if (isInsideMenuOrDialog(e.target, containerRef.current)) return;
      const focusable = e.target instanceof Element && e.target.closest(FOCUSABLE) != null;
      close({ restoreFocus: !focusable });
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close({ restoreFocus: true });
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [isOpen, close, outsideClickCloses]);
  const open = useCallback(() => setIsOpen(true), []);
  return { isOpen, open, close, containerRef };
}
