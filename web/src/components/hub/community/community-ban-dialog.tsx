/**
 * ROK-1870 §3.1 — confirm a ban with an optional reason: `Modal` from 1024px,
 * `BottomSheet` below it (§4.4).
 */
import { useState, type JSX } from 'react';
import { HUB_BAN_REASON_MAX } from '@raid-ledger/contract';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { BottomSheet } from '../../ui/bottom-sheet';
import { Button } from '../../ui/button';
import { Modal } from '../../ui/modal';
import { Textarea } from '../../ui/textarea';

interface BanDialogProps {
    name: string;
    onConfirm: (reason: string) => void;
    onClose: () => void;
}

export function CommunityBanDialog({ name, onConfirm, onClose }: BanDialogProps): JSX.Element {
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    const [reason, setReason] = useState('');
    const title = `Ban ${name}?`;
    const footer = (
        <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="destructive" data-testid="community-ban-confirm" onClick={() => onConfirm(reason.trim())}>Ban</Button>
        </div>
    );
    const body = (
        <div className="flex flex-col gap-2" data-testid="community-ban-dialog">
            <p className="text-sm text-secondary">They leave the hub now and can&apos;t join again until unbanned.</p>
            <Textarea aria-label="Reason (optional)" placeholder="Reason (optional)" value={reason} maxLength={HUB_BAN_REASON_MAX}
                showCount onChange={(e) => setReason(e.target.value)} />
        </div>
    );
    if (isDesktop) return <Modal isOpen onClose={onClose} title={title} footer={footer}>{body}</Modal>;
    return <BottomSheet isOpen onClose={onClose} title={title} footer={footer}>{body}</BottomSheet>;
}
