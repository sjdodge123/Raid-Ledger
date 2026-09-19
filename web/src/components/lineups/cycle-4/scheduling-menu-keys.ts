/**
 * Keyboard behaviour shared by the scheduling page's two `role="menu"`
 * popovers (ROK-1618).
 *
 * Extracted verbatim from `SchedulingManageDropdown` when the leader card
 * gained its own "Poll actions ⋯" menu (`SchedulingLeaderMenu`): two menus on
 * one page must answer ArrowDown/ArrowUp/Home/End identically, and a
 * copy-paste of the traversal would be the place they drift apart.
 *
 * `SchedulingManageDropdown.test.tsx` is the regression guard for the move —
 * nothing here changed, only where it lives.
 */
import { useEffect, type KeyboardEvent, type RefObject } from 'react';

/** The menu's enabled items, in DOM order. */
export function menuItems(menu: HTMLElement | null): HTMLElement[] {
  return Array.from(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []);
}

/** Focus the first item each time the menu opens. */
export function useFocusFirstItem(
  menuRef: RefObject<HTMLDivElement | null>,
  open: boolean,
): void {
  useEffect(() => {
    if (open) menuItems(menuRef.current)[0]?.focus();
  }, [menuRef, open]);
}

/** ArrowDown / ArrowUp (wrapping), Home / End between the menu's items. */
export function onMenuKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
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
