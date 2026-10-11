/**
 * "Add to calendar" (ROK-1596 S3 note): the event line for someone with no
 * sent copy. A §4.11 row menu — `role="menu"` popover of ghost `Button` rows —
 * offering Google, Outlook and a one-off `.ics` download. Esc and an outside
 * click close it. Works with the calendar kill switch off (F10).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../ui/button';
import { toast } from '../../../lib/toast';
import { EVENT_CALENDAR_COPY as C } from './calendar-sync.copy';
import { downloadIcs, googleCalendarUrl, outlookCalendarUrl, type AddToCalendarEvent } from './add-to-calendar.helpers';

const MENU_ITEM_LEFT = '[&>[data-button-label]]:w-full';

function useMenuDismiss(open: boolean, close: () => void) {
    const rootRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) return;
        const onClick = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) close(); };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
        document.addEventListener('mousedown', onClick);
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
    }, [open, close]);
    return rootRef;
}

function openInNewTab(url: string): void {
    window.open(url, '_blank', 'noopener,noreferrer');
}

function useMenuItems(event: AddToCalendarEvent, close: () => void) {
    return [
        { key: 'google', label: C.menuGoogle, run: () => openInNewTab(googleCalendarUrl(event)) },
        { key: 'outlook', label: C.menuOutlook, run: () => openInNewTab(outlookCalendarUrl(event)) },
        { key: 'ics', label: C.menuIcs, run: () => { downloadIcs(event).catch(() => toast.error(C.icsFailed)); } },
    ].map((it) => ({ ...it, run: () => { close(); it.run(); } }));
}

export function AddToCalendarMenu({ event }: { event: AddToCalendarEvent }) {
    const [open, setOpen] = useState(false);
    const close = useCallback(() => setOpen(false), []);
    const rootRef = useMenuDismiss(open, close);
    const items = useMenuItems(event, close);
    return (
        <div ref={rootRef} className="relative" data-testid="add-to-calendar">
            <Button variant="ghost" size="sm" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
                {C.addToCalendar}
            </Button>
            {open && (
                <div role="menu" aria-label={C.addToCalendar}
                    className="absolute left-0 top-full mt-1 z-10 min-w-[12rem] bg-panel border border-edge rounded-lg shadow-lg p-1 flex flex-col gap-1">
                    {items.map((it) => (
                        <Button key={it.key} role="menuitem" variant="ghost" size="sm" fullWidth className={MENU_ITEM_LEFT} onClick={it.run}>
                            {it.label}
                        </Button>
                    ))}
                </div>
            )}
        </div>
    );
}
