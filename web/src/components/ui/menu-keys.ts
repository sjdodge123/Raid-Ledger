/**
 * Keyboard behaviour shared by every `role="menu"` popover (design-system
 * §4.14): ArrowDown/ArrowUp wrap, Home/End jump, the first item takes focus
 * on open.
 *
 * Born as `lineups/cycle-4/scheduling-menu-keys.ts` (ROK-1618, extracted from
 * `SchedulingManageDropdown` so the scheduling page's two menus could not
 * drift); moved to `ui/` in ROK-1875 once the header Hubs menu, the calendar
 * menus and the community member menu shared it — a layout → lineups import
 * would be a cross-feature dependency. Nothing in the logic changed.
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
  const index = next[e.key];
  if (index === undefined) return;
  e.preventDefault();
  items[index]?.focus();
}
