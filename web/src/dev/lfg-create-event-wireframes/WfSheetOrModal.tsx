/**
 * ROK-1573/1572/1571 — the one overlay container every wireframe dialog uses.
 *
 * The real primitives, per the modal-vs-bottom-sheet rule in
 * docs/design-system.md: `BottomSheet` with the shipped `SheetTitleRow` below
 * 768px (exactly as `SchedulingManageSheet` draws it), `Modal` from 768px. At
 * the Phone width toggle the page runs in a 390px iframe, so the query is
 * honest. Mounted only while open — a closed `BottomSheet` still portals its
 * children.
 */
import type { JSX, ReactNode } from 'react';
import { BottomSheet } from '../../components/ui/bottom-sheet';
import { Modal } from '../../components/ui/modal';
import { AvatarWithFallback } from '../../components/shared/AvatarWithFallback';
import { SheetTitleRow } from '../../pages/scheduling/SheetTitleRow';
import { useMediaQuery } from '../../hooks/use-media-query';
import type { LfgMemberDto } from '@raid-ledger/contract';

export interface WfSheetOrModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: ReactNode;
}

/** Sheet on phones, modal on desktop; nothing while closed. */
export function WfSheetOrModal({ isOpen, onClose, title, children }: WfSheetOrModalProps): JSX.Element | null {
    const isPhone = useMediaQuery('(max-width: 767px)');
    if (!isOpen) return null;
    if (isPhone) {
        return (
            <BottomSheet isOpen onClose={onClose} ariaLabel={title}>
                <div className="flex flex-col gap-2 pb-2">
                    <SheetTitleRow title={title} onClose={onClose} testId="wf-sheet-title" />
                    {children}
                </div>
            </BottomSheet>
        );
    }
    return (
        <Modal isOpen onClose={onClose} title={title}>
            {children}
        </Modal>
    );
}

/** One member row — the `LineupParticipantsModal` row idiom, LFG member shape. */
export function WfMemberRow({ member, trailing }: { member: LfgMemberDto; trailing?: ReactNode }): JSX.Element {
    const name = member.displayName ?? member.username;
    return (
        <li className="flex items-center gap-3 rounded border border-edge bg-panel px-2 py-2">
            <AvatarWithFallback avatarUrl={member.avatarUrl} username={name} sizeClassName="w-8 h-8" />
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">{name}</span>
            {trailing}
        </li>
    );
}
