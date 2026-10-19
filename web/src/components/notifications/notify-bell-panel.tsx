/**
 * The notification bell's panel (ROK-1797, generalised by ROK-1832): the body
 * shared by the desktop popover and the phone `BottomSheet`, plus the popover
 * shell. Subject-agnostic — the game and group bells pass their own copy.
 */
import { useEffect, useId, useRef, type JSX, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Switch } from '../ui/switch';
import { useAnchoredPopup, type PopupAlign } from '../ui/use-anchored-popup';

export interface NotifyPanelState {
    /** What the bell is for — "Valheim", "Iron Vanguard". */
    subjectName: string;
    muted: boolean;
    disabled: boolean;
    onMutedChange: (muted: boolean) => void;
    /** The one-line explanation under the Switch. */
    mutedHint: string;
    /** "All notification settings →" target (a `#notif-<type>` anchor). */
    settingsHref: string;
    /** `<prefix>-switch` / `<prefix>-popover`. */
    testIdPrefix: string;
}

/** Switch (checked = notifications on), the subject's hint line, and the settings link. */
export function NotifyPanelBody({ subjectName, muted, disabled, onMutedChange, mutedHint, settingsHref, testIdPrefix }: NotifyPanelState): JSX.Element {
    const helpId = useId();
    const label = `Notify me about ${subjectName}`;
    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-foreground">{label}</span>
                <Switch checked={!muted} onChange={(on) => onMutedChange(!on)} label={label}
                    disabled={disabled} testId={`${testIdPrefix}-switch`} aria-describedby={helpId} />
            </div>
            <p id={helpId} className="text-sm text-muted">{mutedHint}</p>
            <Link to={settingsHref} className="text-sm font-medium text-success hover:underline">
                All notification settings →
            </Link>
        </div>
    );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** True when this Tab press would carry focus out of the popup (past either end). */
function tabLeavesPopup(e: KeyboardEvent, popup: HTMLElement): boolean {
    const items = Array.from(popup.querySelectorAll<HTMLElement>(FOCUSABLE));
    const active = document.activeElement;
    if (e.shiftKey) return active === popup || active === items[0];
    return items.length === 0 || active === items[items.length - 1];
}

/**
 * Esc, and a Tab past either end, close the popover and hand focus back to
 * the bell: the popover is portalled to the end of `<body>`, so a Tab past
 * its last link would otherwise leave it open with focus off the page.
 * Focus moving to anything outside the popup and the bell (a screen reader
 * jump) closes it too, matching `Combobox`'s close-on-blur.
 */
function usePopoverFocusExit(open: boolean, onClose: () => void, popupRef: RefObject<HTMLElement | null>,
    returnFocusTo: RefObject<HTMLElement | null>): void {
    useEffect(() => {
        const popup = popupRef.current;
        if (!open || !popup) return;
        const exit = (): void => { onClose(); returnFocusTo.current?.focus(); };
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') exit();
            else if (e.key === 'Tab' && tabLeavesPopup(e, popup)) { e.preventDefault(); exit(); }
        };
        const onFocusOut = (e: FocusEvent): void => {
            const next = e.relatedTarget;
            if (!(next instanceof Node) || popup.contains(next) || returnFocusTo.current?.contains(next)) return;
            onClose();
        };
        document.addEventListener('keydown', onKey);
        popup.addEventListener('focusout', onFocusOut);
        return () => { document.removeEventListener('keydown', onKey); popup.removeEventListener('focusout', onFocusOut); };
    }, [open, onClose, popupRef, returnFocusTo]);
}

/** Which popover edge lines up with the bell's matching edge. */
export type PopoverAlign = PopupAlign;

/**
 * ≥1024px: a portalled `role="dialog"` popover anchored under the bell. `end`
 * pins its right edge to the bell's right edge (the hook measures the panel),
 * so a bell at the right of its row keeps the panel inside the viewport.
 */
export function NotifyPopover({ open, onClose, anchorRef, bellRef, container, panel, align }: {
    open: boolean; onClose: () => void;
    anchorRef: RefObject<HTMLElement | null>; bellRef: RefObject<HTMLButtonElement | null>;
    container: HTMLElement; panel: NotifyPanelState; align: PopoverAlign;
}): JSX.Element | null {
    const popupRef = useRef<HTMLDivElement | null>(null);
    const titleId = useId();
    const pos = useAnchoredPopup(anchorRef, popupRef, open, onClose, align);
    usePopoverFocusExit(open, onClose, popupRef, bellRef);
    useEffect(() => { if (open) popupRef.current?.focus(); }, [open]);
    if (!open) return null;
    return createPortal(
        <div ref={popupRef} role="dialog" aria-labelledby={titleId} tabIndex={-1} data-testid={`${panel.testIdPrefix}-popover`}
            className="fixed z-50 w-80 bg-panel border border-edge rounded-lg shadow-lg p-3 focus:outline-none"
            style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? 'visible' : 'hidden' }}>
            <h2 id={titleId} className="text-sm font-semibold text-foreground mb-3">Notifications for {panel.subjectName}</h2>
            <NotifyPanelBody {...panel} />
        </div>,
        container,
    );
}
