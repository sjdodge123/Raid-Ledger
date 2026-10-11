/**
 * "Add to calendar" (ROK-1596 S3 note): the event line for someone with no
 * sent copy. A §4.11 row menu — `role="menu"` popover of ghost `Button` rows —
 * offering Google, Outlook and a one-off `.ics` download. Works with the
 * calendar kill switch off (F10).
 *
 * Keyboard: the §4.14 menu model shared with `CalendarManageMenu` /
 * `SchedulingManageDropdown` — opening focuses the first item, ArrowDown /
 * ArrowUp wrap, Home / End jump, Esc (or picking an item) returns focus to
 * the trigger; an outside click closes it.
 */
import { useRef } from 'react';
import { Button } from '../../ui/button';
import { toast } from '../../../lib/toast';
import { onMenuKeyDown, useFocusFirstItem } from '../../lineups/cycle-4/scheduling-menu-keys';
import { useMenuOpenState } from '../../lineups/use-menu-open-state';
import { EVENT_CALENDAR_COPY as C } from './calendar-sync.copy';
import { downloadIcs, googleCalendarUrl, outlookCalendarUrl, type AddToCalendarEvent } from './add-to-calendar.helpers';

const MENU_ITEM_LEFT = '[&>[data-button-label]]:w-full';

function openInNewTab(url: string): void {
    window.open(url, '_blank', 'noopener,noreferrer');
}

function menuItems(event: AddToCalendarEvent) {
    return [
        { key: 'google', label: C.menuGoogle, run: () => openInNewTab(googleCalendarUrl(event)) },
        { key: 'outlook', label: C.menuOutlook, run: () => openInNewTab(outlookCalendarUrl(event)) },
        { key: 'ics', label: C.menuIcs, run: () => { downloadIcs(event).catch(() => toast.error(C.icsFailed)); } },
    ];
}

export function AddToCalendarMenu({ event }: { event: AddToCalendarEvent }) {
    const triggerRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const { isOpen, open, close, containerRef } = useMenuOpenState(true, triggerRef);
    useFocusFirstItem(menuRef, isOpen);
    return (
        <div ref={containerRef} className="relative" data-testid="add-to-calendar">
            <Button ref={triggerRef} variant="ghost" size="sm" aria-haspopup="menu" aria-expanded={isOpen}
                onClick={() => (isOpen ? close() : open())}>
                {C.addToCalendar}
            </Button>
            {isOpen && (
                <div ref={menuRef} role="menu" aria-label={C.addToCalendar} onKeyDown={onMenuKeyDown}
                    className="absolute left-0 top-full mt-1 z-10 min-w-[12rem] bg-panel border border-edge rounded-lg shadow-lg p-1 flex flex-col gap-1">
                    {menuItems(event).map((it) => (
                        <Button key={it.key} role="menuitem" variant="ghost" size="sm" fullWidth className={MENU_ITEM_LEFT}
                            onClick={() => { close({ restoreFocus: true }); it.run(); }}>
                            {it.label}
                        </Button>
                    ))}
                </div>
            )}
        </div>
    );
}
