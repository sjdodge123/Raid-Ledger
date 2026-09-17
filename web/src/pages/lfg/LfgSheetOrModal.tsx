/**
 * ROK-1573/1572/1571 — the one overlay container every LFG group dialog uses,
 * ported from the approved wireframe (`WfSheetOrModal`).
 *
 * Per the modal-vs-bottom-sheet rule in docs/design-system.md: `BottomSheet`
 * with the shipped `SheetTitleRow` below 768px (as `SchedulingManageSheet`
 * draws it), `Modal` from 768px. Mounted only while open — a closed
 * `BottomSheet` still portals its children.
 */
import type { JSX, ReactNode } from 'react';
import type { LfgMemberDto } from '@raid-ledger/contract';
import { BottomSheet } from '../../components/ui/bottom-sheet';
import { Modal } from '../../components/ui/modal';
import { AvatarWithFallback } from '../../components/shared/AvatarWithFallback';
import { SheetTitleRow } from '../scheduling/SheetTitleRow';
import { useMediaQuery } from '../../hooks/use-media-query';
import { LFG_DIALOG_COPY, LFG_DIALOG_PRIMARY_BTN, LFG_DIALOG_SECONDARY_BTN } from './lfg-dialog-recipes';

export interface LfgSheetOrModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: ReactNode;
}

/** Sheet on phones, modal on desktop; nothing while closed. */
export function LfgSheetOrModal({ isOpen, onClose, title, children }: LfgSheetOrModalProps): JSX.Element | null {
    const isPhone = useMediaQuery('(max-width: 767px)');
    if (!isOpen) return null;
    if (isPhone) {
        return (
            <BottomSheet isOpen onClose={onClose} ariaLabel={title}>
                <div className="flex flex-col gap-2 pb-2">
                    <SheetTitleRow title={title} onClose={onClose} testId="lfg-sheet-title" />
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
export function LfgMemberRow({ member, trailing, testId }: {
    member: LfgMemberDto; trailing?: ReactNode; testId?: string;
}): JSX.Element {
    const name = member.displayName ?? member.username;
    return (
        <li data-testid={testId} className="flex items-center gap-3 rounded border border-edge bg-panel px-2 py-2">
            <AvatarWithFallback avatarUrl={member.avatarUrl} username={name} sizeClassName="w-8 h-8" />
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">{name}</span>
            {trailing}
        </li>
    );
}

/** The members a confirm names. */
export function LfgMemberList({ members, rowTestId }: { members: LfgMemberDto[]; rowTestId?: string }): JSX.Element {
    return (
        <ul className="space-y-2">
            {members.map((m) => <LfgMemberRow key={m.userId} member={m} testId={rowTestId} />)}
        </ul>
    );
}

export interface LfgConfirmActionsProps {
    primary: string;
    testIdPrefix: string;
    isPending?: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}

/** Cancel + primary, right-aligned from `lg`; `{prefix}-cancel` / `{prefix}-submit`. */
export function LfgConfirmActions({ primary, testIdPrefix, isPending = false, onCancel, onConfirm }: LfgConfirmActionsProps): JSX.Element {
    return (
        <div className="flex gap-2 pt-2 lg:justify-end">
            <button type="button" data-testid={`${testIdPrefix}-cancel`} className={LFG_DIALOG_SECONDARY_BTN} onClick={onCancel}>
                {LFG_DIALOG_COPY.cancel}
            </button>
            <button
                type="button"
                data-testid={`${testIdPrefix}-submit`}
                className={LFG_DIALOG_PRIMARY_BTN}
                disabled={isPending}
                aria-busy={isPending}
                onClick={onConfirm}
            >
                {primary}
            </button>
        </div>
    );
}
