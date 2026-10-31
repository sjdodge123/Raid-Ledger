/**
 * ROK-1814 — the crest editor's frame (a `Modal` at ≥1024 px, a `BottomSheet`
 * below; DS §4.4) and the bodies it shows before the editor state arrives:
 * a greyed placeholder while it loads (DS §4.6 — keep the frame, grey the
 * content) and a §4.7 `danger` banner with Retry when it fails.
 */
import type { JSX, ReactNode } from 'react';
import { BottomSheet } from '../../ui/bottom-sheet';
import { Button } from '../../ui/button';
import { Modal } from '../../ui/modal';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../../lib/breakpoints';

interface CrestPickerFrameProps { onClose: () => void; footer: ReactNode; children: ReactNode }

export function CrestPickerFrame({ onClose, footer, children }: CrestPickerFrameProps): JSX.Element {
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    const shared = { isOpen: true, onClose, title: 'Crest', footer };
    if (isDesktop) return <Modal {...shared} maxWidth="max-w-lg">{children}</Modal>;
    return <BottomSheet {...shared} maxHeight="85vh">{children}</BottomSheet>;
}

export function CrestCancelButton({ onClose }: { onClose: () => void }): JSX.Element {
    return <Button variant="secondary" onClick={onClose} data-testid="crest-picker-cancel">Cancel</Button>;
}

export function CrestPickerLoading(): JSX.Element {
    return (
        <div className="flex flex-col gap-4" aria-busy="true" data-testid="crest-picker-loading">
            <span className="sr-only">Loading the crest…</span>
            <div className="h-10 rounded-lg bg-overlay motion-safe:animate-pulse" aria-hidden="true" />
            <div className="h-28 rounded-lg bg-overlay motion-safe:animate-pulse" aria-hidden="true" />
        </div>
    );
}

export function CrestPickerLoadError({ onRetry }: { onRetry: () => void }): JSX.Element {
    return (
        <div className="flex flex-col items-start gap-3" data-testid="crest-picker-load-error">
            <p role="alert" className="w-full rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
                Couldn't load the crest. Check your connection and try again.
            </p>
            <Button variant="secondary" size="sm" onClick={onRetry}>Retry</Button>
        </div>
    );
}
