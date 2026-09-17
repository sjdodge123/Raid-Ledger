/**
 * ROK-1572 L3 — "Start a scheduling poll?" confirm.
 *
 * The real primitives: `BottomSheet` below 768px, `Modal` from 768px (the
 * modal-vs-bottom-sheet rule in docs/design-system.md). At the Phone width
 * toggle the page runs in a 390px iframe, so the media query is honest.
 */
import type { JSX } from 'react';
import type { LfgMemberDto } from '@raid-ledger/contract';
import { BottomSheet } from '../../components/ui/bottom-sheet';
import { Modal } from '../../components/ui/modal';
import { AvatarWithFallback } from '../../components/shared/AvatarWithFallback';
import { useMediaQuery } from '../../hooks/use-media-query';
import { PRIMARY_BTN, SECONDARY_BTN } from './wireframe-variants';

const TITLE = 'Start a scheduling poll?';

export interface WfPollConfirmProps {
    isOpen: boolean;
    onClose: () => void;
    members: LfgMemberDto[];
}

/** Body shared by both containers. */
function ConfirmBody({ members, onClose }: Omit<WfPollConfirmProps, 'isOpen'>): JSX.Element {
    return (
        <div data-testid="wf-poll-confirm" className="space-y-4">
            <p className="text-sm text-muted">
                These {members.length} people get a Discord card and a vote on times. You land on the poll next.
            </p>
            <ul className="space-y-2">
                {members.map((m) => (
                    <li key={m.userId} className="flex items-center gap-3">
                        <AvatarWithFallback avatarUrl={m.avatarUrl} username={m.displayName ?? m.username} sizeClassName="w-8 h-8" />
                        <span className="text-sm text-foreground">{m.displayName ?? m.username}</span>
                    </li>
                ))}
            </ul>
            <div className="flex justify-end gap-2">
                <button type="button" className={SECONDARY_BTN} onClick={onClose}>Cancel</button>
                <button type="button" className={PRIMARY_BTN} onClick={onClose}>Start poll</button>
            </div>
        </div>
    );
}

/** Sheet on phones, modal on desktop. */
export function WfPollConfirm({ isOpen, onClose, members }: WfPollConfirmProps): JSX.Element {
    const isPhone = useMediaQuery('(max-width: 767px)');
    if (isPhone) {
        return (
            <BottomSheet isOpen={isOpen} onClose={onClose} title={TITLE}>
                <ConfirmBody members={members} onClose={onClose} />
            </BottomSheet>
        );
    }
    return (
        <Modal isOpen={isOpen} onClose={onClose} title={TITLE}>
            <ConfirmBody members={members} onClose={onClose} />
        </Modal>
    );
}
