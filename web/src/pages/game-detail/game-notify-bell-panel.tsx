/**
 * The game page's notification panel (ROK-1797): the body shared by the
 * desktop popover and the phone `BottomSheet`, plus the popover shell.
 */
import { useEffect, useId, useRef, type JSX, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Switch } from '../../components/ui/switch';
import { useAnchoredPopup } from '../../components/ui/use-anchored-popup';

export const NOTIFICATION_SETTINGS_HREF = '/profile/notifications#notif-subscribed_game';

export interface NotifyPanelState {
    gameName: string;
    muted: boolean;
    disabled: boolean;
    onMutedChange: (muted: boolean) => void;
}

/** Switch (checked = notifications on), the heart-is-separate line, and the settings link. */
export function GameNotifyPanelBody({ gameName, muted, disabled, onMutedChange }: NotifyPanelState): JSX.Element {
    const helpId = useId();
    const label = `Notify me about ${gameName}`;
    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-foreground">{label}</span>
                <Switch checked={!muted} onChange={(on) => onMutedChange(!on)} label={label}
                    disabled={disabled} testId="game-notify-switch" aria-describedby={helpId} />
            </div>
            <p id={helpId} className="text-sm text-muted">Muting keeps {gameName} on your list.</p>
            <Link to={NOTIFICATION_SETTINGS_HREF} className="text-sm font-medium text-success hover:underline">
                All notification settings →
            </Link>
        </div>
    );
}

/** Esc closes the popover and hands focus back to the bell. */
function useEscapeToClose(open: boolean, onClose: () => void, returnFocusTo: RefObject<HTMLElement | null>): void {
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent): void => {
            if (e.key !== 'Escape') return;
            onClose();
            returnFocusTo.current?.focus();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open, onClose, returnFocusTo]);
}

/** ≥1024px: a portalled `role="dialog"` popover anchored under the bell. */
export function GameNotifyPopover({ open, onClose, anchorRef, bellRef, container, panel }: {
    open: boolean; onClose: () => void;
    anchorRef: RefObject<HTMLElement | null>; bellRef: RefObject<HTMLButtonElement | null>;
    container: HTMLElement; panel: NotifyPanelState;
}): JSX.Element | null {
    const popupRef = useRef<HTMLDivElement | null>(null);
    const titleId = useId();
    const pos = useAnchoredPopup(anchorRef, popupRef, open, onClose);
    useEscapeToClose(open, onClose, bellRef);
    useEffect(() => { if (open) popupRef.current?.focus(); }, [open]);
    if (!open) return null;
    return createPortal(
        <div ref={popupRef} role="dialog" aria-labelledby={titleId} tabIndex={-1} data-testid="game-notify-popover"
            className="fixed z-50 w-80 bg-panel border border-edge rounded-lg shadow-lg p-3 focus:outline-none"
            style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? 'visible' : 'hidden' }}>
            <h2 id={titleId} className="text-sm font-semibold text-foreground mb-3">Notifications for {panel.gameName}</h2>
            <GameNotifyPanelBody {...panel} />
        </div>,
        container,
    );
}
