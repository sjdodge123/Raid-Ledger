/**
 * The notification bell (ROK-1797, generalised by ROK-1832) — a presentational
 * primitive: the adapter owns the data (`GameNotifyBell`, `HubNotifyBell`).
 *
 * The bell OPENS a panel — the `Switch` inside it toggles the mute — so it
 * carries `aria-haspopup="dialog"` + `aria-expanded`, not `aria-pressed`. The
 * icon still shows the state. ≥1024px the panel is an anchored popover, below
 * it a `BottomSheet` (both in the lazy `notify-bell-shell`). The open state is internal unless the adapter controls it
 * (`open` + `onOpenChange`, e.g. a deep link that opens the panel).
 */
import { lazy, Suspense, useCallback, useRef, useState, type JSX } from 'react';
import { BellIcon, BellSlashIcon } from '@heroicons/react/24/outline';
import { Button } from '../ui/button';
import { usePortalTarget } from '../ui/use-anchored-popup';
import { useMediaQuery } from '../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../lib/breakpoints';
import type { NotifyPanelState } from './notify-bell-panel';

/**
 * Lazy so the panel stays out of the host page's chunk (hub-page budget). It
 * mounts with the bell and renders nothing while closed, so the chunk is
 * fetched up front and the first click opens without a wait.
 */
const NotifyBellShell = lazy(() => import('./notify-bell-shell'));

export interface NotifyBellProps {
    subjectName: string;
    muted: boolean;
    /** The mute state has loaded; the Switch stays disabled until then. */
    isReady: boolean;
    /** A write is in flight. */
    isPending: boolean;
    /** Called with the NEW mute (true = mute). */
    onToggle: (muted: boolean) => void;
    settingsHref: string;
    /** `<prefix>-bell`, `<prefix>-switch`, `<prefix>-popover`. */
    testIdPrefix: string;
    mutedHint: string;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
}

/** Internal open state unless the adapter passes `open` + `onOpenChange`. */
function useBellOpen(open: boolean | undefined, onOpenChange: ((open: boolean) => void) | undefined) {
    const [inner, setInner] = useState(false);
    const isOpen = open ?? inner;
    const setOpen = useCallback((next: boolean) => {
        if (onOpenChange) onOpenChange(next);
        else setInner(next);
    }, [onOpenChange]);
    return { isOpen, setOpen };
}

/** Bell trigger + popover (≥1024px) or `BottomSheet` (below). */
export function NotifyBell(props: NotifyBellProps): JSX.Element {
    const { subjectName, muted, isReady, isPending, onToggle, settingsHref, testIdPrefix, mutedHint } = props;
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    const { isOpen, setOpen } = useBellOpen(props.open, props.onOpenChange);
    const close = useCallback(() => setOpen(false), [setOpen]);
    const bellRef = useRef<HTMLButtonElement | null>(null);
    const { anchorRef, setAnchorRef, container } = usePortalTarget();
    const panel: NotifyPanelState = {
        subjectName, muted, disabled: !isReady || isPending, onMutedChange: onToggle, mutedHint, settingsHref, testIdPrefix,
    };
    const Icon = muted ? BellSlashIcon : BellIcon;
    return (
        <div ref={setAnchorRef} className="inline-flex">
            <Button ref={bellRef} variant="secondary" iconOnly data-testid={`${testIdPrefix}-bell`}
                aria-label={`Notifications for ${subjectName}: ${muted ? 'muted' : 'on'}`}
                aria-haspopup="dialog" aria-expanded={isOpen} onClick={() => setOpen(!isOpen)}>
                <Icon className="w-5 h-5" aria-hidden="true" />
            </Button>
            <Suspense fallback={null}>
                <NotifyBellShell isDesktop={isDesktop} open={isOpen} onClose={close} anchorRef={anchorRef}
                    bellRef={bellRef} container={container} panel={panel} />
            </Suspense>
        </div>
    );
}
