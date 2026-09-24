/**
 * ModalFrame — the shared dialog shell behind `Modal` (ROK-1655 split).
 * Import `Modal` from './modal' in feature code; only `DiscardChangesConfirm`
 * renders the frame directly.
 */
import { useEffect, useCallback, useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from '../../hooks/use-focus-trap';
import { useBodyScrollLock } from '../../hooks/use-body-scroll-lock';
import { OVERLAY_FOOTER_CLASS } from './overlay-footer';

export interface ModalFrameProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: ReactNode;
    /** Override the default max-width (default: 'max-w-md') */
    maxWidth?: string;
    /**
     * Replace the body skin (default: 'p-4 overflow-y-auto'). The structural
     * 'flex-1 min-h-0' always applies so the body fills the space between the
     * header and the footer inside the 90dvh column.
     */
    bodyClassName?: string;
    /** Actions pinned below the scrolling body; never scrolls away (ROK-1655). */
    footer?: ReactNode;
    /** Element to focus on open instead of the first focusable (the close button) */
    initialFocusRef?: React.RefObject<HTMLElement | null>;
}

function useModalEscape(isOpen: boolean, onClose: () => void) {
    const handleKeyDown = useCallback(
        (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); },
        [onClose],
    );

    useEffect(() => {
        if (!isOpen) return;
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, handleKeyDown]);
    // Ref-counted: a Modal stacked over an open sheet must not unlock the page on close (ROK-1640).
    useBodyScrollLock(isOpen);
}

const BODY_STRUCTURE = 'flex-1 min-h-0';
const DEFAULT_BODY_SKIN = 'p-4 overflow-y-auto';

function ModalFooter({ children }: { children: ReactNode }) {
    return (
        <div data-testid="modal-footer" className={OVERLAY_FOOTER_CLASS}>
            {children}
        </div>
    );
}

function ModalHeader({ titleId, title, onClose }: { titleId: string; title: string; onClose: () => void }) {
    return (
        <div className="shrink-0 flex items-center justify-between p-4 border-b border-edge">
            <h2 id={titleId} className="text-lg font-semibold text-foreground">{title}</h2>
            <button
                onClick={onClose}
                className="flex items-center justify-center min-w-[44px] min-h-[44px] text-muted hover:text-foreground transition-colors rounded-lg hover:bg-panel"
                aria-label="Close modal"
            >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>
        </div>
    );
}

/**
 * The unguarded dialog: portal, backdrop, focus trap, Escape, body scroll
 * lock, header, scrolling body and pinned footer. Every close path calls
 * `onClose` directly. Consumers use `Modal` (./modal), which adds the
 * ROK-1655 dirty-close guard on top; `DiscardChangesConfirm` uses this frame
 * directly so the confirm is never itself guarded (and no import cycle forms).
 * ROK-342: focus trap + ARIA dialog semantics.
 */
export function ModalFrame({
    isOpen, onClose, title, children, maxWidth = 'max-w-md', bodyClassName, initialFocusRef, footer,
}: ModalFrameProps) {
    const titleId = useId();
    const trapRef = useFocusTrap<HTMLDivElement>(isOpen, initialFocusRef);

    useModalEscape(isOpen, onClose);

    if (!isOpen) return null;
    // `footer={cond && <Buttons />}` passes false when off — render no empty bar.
    const hasFooter = footer != null && typeof footer !== 'boolean';

    return createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
            <div
                ref={trapRef}
                className={`relative flex flex-col bg-surface border border-edge rounded-xl shadow-2xl ${maxWidth} w-full mx-4 max-h-[90dvh] overflow-hidden`}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                style={{ animation: 'modal-spring 350ms var(--spring-bounce) forwards' }}
            >
                <ModalHeader titleId={titleId} title={title} onClose={onClose} />
                <div className={`${BODY_STRUCTURE} ${bodyClassName ?? DEFAULT_BODY_SKIN}`}>{children}</div>
                {hasFooter && <ModalFooter>{footer}</ModalFooter>}
            </div>
        </div>,
        document.body,
    );
}
