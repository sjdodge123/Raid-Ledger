/**
 * ROK-1958 D-4 / D-5 / D-11 — design-system §4.4 split for the campaign
 * dialogs: `Modal` at ≥1024px, `BottomSheet` below. Same footer in both.
 */
import type { JSX, ReactNode } from 'react';
import { Modal } from '../../../components/ui/modal';
import { BottomSheet } from '../../../components/ui/bottom-sheet';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import type { DirtyCloseGuard } from '../../../hooks/use-dirty-close-guard';

export interface Bg3OverlayProps {
    readonly isOpen: boolean;
    readonly title: string;
    readonly onClose: () => void;
    readonly footer: ReactNode;
    readonly children: ReactNode;
    readonly closeGuard?: DirtyCloseGuard;
    readonly discardMessage?: string;
}

export function Bg3Overlay({ isOpen, title, onClose, footer, children, closeGuard, discardMessage }: Bg3OverlayProps): JSX.Element {
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    const guard = {
        ...(closeGuard ? { closeGuard } : {}),
        ...(discardMessage !== undefined ? { discardMessage } : {}),
    };
    if (isDesktop) {
        return <Modal isOpen={isOpen} onClose={onClose} title={title} footer={footer} {...guard}>{children}</Modal>;
    }
    return (
        <BottomSheet isOpen={isOpen} onClose={onClose} title={title} footer={footer} maxHeight="85vh" {...guard}>
            {children}
        </BottomSheet>
    );
}
