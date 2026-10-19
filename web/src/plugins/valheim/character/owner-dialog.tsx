/** ROK-1836 L4 — §4.4 split: `Modal` at ≥1024px, `BottomSheet` below. */
import type { ReactNode } from 'react';
import { Modal } from '../../../components/ui/modal';
import { BottomSheet } from '../../../components/ui/bottom-sheet';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../../lib/breakpoints';

interface OwnerDialogProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    footer: ReactNode;
    children: ReactNode;
}

export function OwnerDialog(props: OwnerDialogProps) {
    const Shell = useMediaQuery(DESKTOP_MQ) ? Modal : BottomSheet;
    return <Shell {...props} />;
}
