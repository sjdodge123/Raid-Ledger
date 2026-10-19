/**
 * The bell's panel shells (ROK-1832): the anchored popover ≥1024px, the
 * `BottomSheet` below. Lazy-loaded by `NotifyBell` so the panel body, the
 * popover focus handling and the sheet stay out of the host page's chunk;
 * the trigger itself is eager.
 */
import type { JSX, RefObject } from 'react';
import { BottomSheet } from '../ui/bottom-sheet';
import { NotifyPanelBody, NotifyPopover, type NotifyPanelState, type PopoverAlign } from './notify-bell-panel';

export interface NotifyBellShellProps {
    isDesktop: boolean;
    open: boolean;
    onClose: () => void;
    anchorRef: RefObject<HTMLElement | null>;
    bellRef: RefObject<HTMLButtonElement | null>;
    container: HTMLElement;
    panel: NotifyPanelState;
    align: PopoverAlign;
}

/** Popover or BottomSheet around the shared panel body; renders nothing while closed. */
export default function NotifyBellShell({ isDesktop, open, onClose, anchorRef, bellRef, container, panel, align }: NotifyBellShellProps): JSX.Element | null {
    if (isDesktop) {
        return <NotifyPopover open={open} onClose={onClose} anchorRef={anchorRef} bellRef={bellRef} container={container} panel={panel} align={align} />;
    }
    return (
        <BottomSheet isOpen={open} onClose={onClose} title={`Notifications for ${panel.subjectName}`}>
            <NotifyPanelBody {...panel} />
        </BottomSheet>
    );
}
