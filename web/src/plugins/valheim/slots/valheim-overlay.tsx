/** Modal at ≥1024px, BottomSheet below (§4.4, `DESKTOP_MQ`) — the AddonImportDialog idiom (ROK-1833). */
import type { JSX, ReactNode } from 'react';
import { Modal } from '../../../components/ui/modal';
import { BottomSheet } from '../../../components/ui/bottom-sheet';
import type { DiscardCopy } from '../../../components/ui/discard-changes-confirm';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import type { DirtyCloseGuard } from '../../../hooks/use-dirty-close-guard';

export interface ValheimOverlayProps {
    title: string;
    onClose: () => void;
    footer: ReactNode;
    children: ReactNode;
    closeGuard?: DirtyCloseGuard;
    discardMessage?: string;
    discardCopy?: DiscardCopy;
}

/** One open overlay; the caller mounts it only while it should be open. */
export function ValheimOverlay({ discardCopy, ...props }: ValheimOverlayProps): JSX.Element {
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    if (isDesktop) return <Modal isOpen {...props} discardCopy={discardCopy} maxWidth="max-w-lg" />;
    return <BottomSheet isOpen {...props} />;
}
