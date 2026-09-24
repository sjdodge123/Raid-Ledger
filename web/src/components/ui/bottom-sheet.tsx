import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { Z_INDEX } from '../../lib/z-index';
import { useBodyScrollLock } from '../../hooks/use-body-scroll-lock';
import type { DirtyCloseGuard } from '../../hooks/use-dirty-close-guard';
import { SHEET_VH_VAR, toVisiblePx, useVisibleViewport } from './bottom-sheet-viewport';
import { DiscardChangesConfirm } from './discard-changes-confirm';
import { OVERLAY_FOOTER_CLASS } from './overlay-footer';

interface BottomSheetProps {
    isOpen: boolean;
    onClose: () => void;
    title?: string;
    children: React.ReactNode;
    /**
     * Cap on the sheet's height (default `'60vh'`). The sheet sizes to its
     * content up to this cap. A `vh`/`dvh` value is a share of the VISIBLE
     * viewport (`visualViewport`, ROK-1640/ROK-1641), resolved to px.
     */
    maxHeight?: string;
    /** ROK-1574: open already expanded (a full-height sheet, e.g. a stepper flow). */
    initiallyExpanded?: boolean;
    /** Accessible name when the sheet draws its own header instead of a `title`. */
    ariaLabel?: string;
    /**
     * Pinned action row (ROK-1655): a shrink-0 sibling after the scrolling
     * body, so the body shrinks and scrolls while the footer stays in view.
     */
    footer?: React.ReactNode;
    /**
     * Dirty-close layer (ROK-1655): from `useDirtyCloseGuard(isDirty, onClose)`.
     * When set, Escape, the backdrop, the header × and swipe-down all call
     * `closeGuard.requestClose`, and the sheet renders "Discard your changes?".
     */
    closeGuard?: DirtyCloseGuard;
    /** What is unsaved, in the caller's words (the confirm's message). */
    discardMessage?: string;
}

const DEFAULT_MAX_HEIGHT = '60vh';
const EXPANDED_HEIGHT = '95vh';

/**
 * Move focus into the sheet on open and give it back on close (ROK-1574 review:
 * the check is the first BLOCKING flow in a sheet, and `aria-modal` alone does
 * not move a keyboard user off the page). A full focus trap is TECH-DEBT.
 */
function useSheetFocus(isOpen: boolean, sheetRef: React.RefObject<HTMLDivElement | null>) {
    useEffect(() => {
        if (!isOpen) return;
        const previous = document.activeElement as HTMLElement | null;
        const id = window.setTimeout(() => {
            const first = sheetRef.current?.querySelector<HTMLElement>(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
            );
            first?.focus();
        }, 0);
        return () => { window.clearTimeout(id); previous?.focus?.(); };
    }, [isOpen, sheetRef]);
}

function useSheetKeyboard(isOpen: boolean, onClose: () => void) {
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => { if (e.key === 'Escape' && isOpen) onClose(); };
        window.addEventListener('keydown', handleEscape);
        return () => window.removeEventListener('keydown', handleEscape);
    }, [isOpen, onClose]);
}

function useDragHandlers(
    sheetRef: React.RefObject<HTMLDivElement | null>,
    expanded: boolean, setExpanded: (v: boolean) => void, onClose: () => void,
    closeWhenExpanded = false,
) {
    const dragStartY = useRef<number>(0);
    const dragCurrentY = useRef<number>(0);

    const handleDragStart = (e: React.TouchEvent) => {
        dragStartY.current = e.touches[0].clientY;
        dragCurrentY.current = e.touches[0].clientY;
        if (sheetRef.current) sheetRef.current.style.transition = 'none';
    };

    const handleDragMove = (e: React.TouchEvent) => {
        dragCurrentY.current = e.touches[0].clientY;
        const delta = dragCurrentY.current - dragStartY.current;
        if (!sheetRef.current) return;
        const translate = delta > 0 ? delta : delta * 0.4;
        sheetRef.current.style.transform = `translateY(${translate}px)`;
    };

    const handleDragEnd = () => {
        const delta = dragCurrentY.current - dragStartY.current;
        const sheetHeight = sheetRef.current?.offsetHeight || 0;
        if (sheetRef.current) { sheetRef.current.style.transition = ''; sheetRef.current.style.transform = ''; }
        resolveDragGesture(delta, sheetHeight, expanded, setExpanded, onClose, closeWhenExpanded);
        dragStartY.current = 0;
        dragCurrentY.current = 0;
    };

    return { handleDragStart, handleDragMove, handleDragEnd };
}

function resolveDragGesture(
    delta: number, sheetHeight: number,
    expanded: boolean, setExpanded: (v: boolean) => void, onClose: () => void,
    closeWhenExpanded = false,
) {
    if (delta < -60) { setExpanded(true); return; }
    if (delta > 0) {
        // A sheet that OPENS expanded has no smaller state to collapse to — a
        // downward drag closes it directly (ROK-1574 review: two gestures).
        if (expanded && delta > 80) { if (closeWhenExpanded) onClose(); else setExpanded(false); }
        else if (!expanded && (delta > 150 || delta > sheetHeight * 0.4)) onClose();
    }
}

function SheetHeader({ title, onClose }: { title: string; onClose: () => void }) {
    return (
        <div className="flex shrink-0 items-center justify-between px-4 py-3 border-b border-edge">
            <h3 className="text-lg font-semibold">{title}</h3>
            <button
                onClick={onClose}
                className="flex items-center justify-center min-w-[44px] min-h-[44px] text-muted hover:text-foreground transition-colors"
                aria-label="Close"
            >
                <XMarkIcon className="w-5 h-5" />
            </button>
        </div>
    );
}

/**
 * The overlay layer IS the visible viewport (ROK-1640/ROK-1641): pinned to
 * `visualViewport`'s top and height in px, so the sheet's `bottom-0` and its
 * cap can never reach below the screen's visible bottom edge. `--sheet-vh`
 * (1% of that height) lets sheet content size itself the same way.
 */
function useSheetHeights(cap: string) {
    const { height, offsetTop } = useVisibleViewport();
    const layerSize: React.CSSProperties = height > 0
        ? { top: `${offsetTop}px`, bottom: 'auto', height: `${height}px`, [SHEET_VH_VAR]: `${height / 100}px` } as React.CSSProperties
        : {};
    return { activeMaxHeight: toVisiblePx(cap, height), layerSize };
}

const PANEL_CLASS = 'absolute bottom-0 inset-x-0 flex flex-col bg-surface rounded-t-2xl shadow-2xl '
    + 'pb-[env(safe-area-inset-bottom)] transition-all duration-300 ease-out';

/** Sheet state + side effects; `requestClose` is every close path (guarded or not). */
function useSheetControls(isOpen: boolean, requestClose: () => void, maxHeight: string, initiallyExpanded: boolean) {
    const sheetRef = useRef<HTMLDivElement>(null);
    const [expanded, setExpanded] = useState(initiallyExpanded);

    const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
    if (isOpen !== prevIsOpen) { setPrevIsOpen(isOpen); if (!isOpen) setExpanded(initiallyExpanded); }

    useSheetKeyboard(isOpen, requestClose);
    useBodyScrollLock(isOpen);
    const drag = useDragHandlers(sheetRef, expanded, setExpanded, requestClose, initiallyExpanded);
    useSheetFocus(isOpen, sheetRef);
    return { sheetRef, drag, ...useSheetHeights(expanded ? EXPANDED_HEIGHT : maxHeight) };
}

export function BottomSheet({ isOpen, onClose, title, children, maxHeight = DEFAULT_MAX_HEIGHT, initiallyExpanded = false, ariaLabel, footer, closeGuard, discardMessage }: BottomSheetProps) {
    const requestClose = closeGuard?.requestClose ?? onClose;
    const { sheetRef, drag, activeMaxHeight, layerSize } = useSheetControls(isOpen, requestClose, maxHeight, initiallyExpanded);

    const sheet = createPortal(
        <div className={`fixed inset-0 overflow-hidden ${isOpen ? '' : 'pointer-events-none'}`} style={{ zIndex: Z_INDEX.BOTTOM_SHEET, ...layerSize }}>
            <div className={`absolute inset-0 bg-black/50 transition-opacity duration-200 ${isOpen ? 'opacity-100' : 'opacity-0'}`} onClick={requestClose} aria-hidden="true" />
            <div
                ref={sheetRef} role={isOpen ? 'dialog' : undefined} aria-modal={isOpen ? 'true' : undefined} aria-label={isOpen ? (ariaLabel || title || 'Bottom sheet') : undefined}
                className={`${PANEL_CLASS} ${isOpen ? 'translate-y-0' : 'translate-y-full'}`}
                style={{ maxHeight: activeMaxHeight }}
            >
                <div className="flex shrink-0 justify-center pt-3 pb-2 cursor-grab" onTouchStart={drag.handleDragStart} onTouchMove={drag.handleDragMove} onTouchEnd={drag.handleDragEnd}>
                    <div className="w-10 h-1 bg-muted rounded-full" />
                </div>
                {title && <SheetHeader title={title} onClose={requestClose} />}
                {/* Content-sized; shrinks and scrolls only once the sheet hits its cap. */}
                <div className="min-h-0 overflow-y-auto px-4 py-4">{children}</div>
                {footer ? <div className={OVERLAY_FOOTER_CLASS} data-testid="bottom-sheet-footer">{footer}</div> : null}
            </div>
        </div>,
        document.body,
    );
    // The confirm is a Modal (Z_INDEX.MODAL > BOTTOM_SHEET), so it stacks above the sheet.
    const confirm = closeGuard
        && <DiscardChangesConfirm isOpen={closeGuard.confirming} onKeep={closeGuard.keep} onDiscard={closeGuard.discard} message={discardMessage} />;
    return <>{sheet}{confirm}</>;
}
