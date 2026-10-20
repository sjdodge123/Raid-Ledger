/**
 * ROK-1870 §3.1 (verify lane 2) — confirm before handing over leadership: the
 * leader loses control in one step, so it gets the same `Modal` (≥1024px) /
 * `BottomSheet` (below) confirm as Ban (§4.4).
 */
import type { JSX } from 'react';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { BottomSheet } from '../../ui/bottom-sheet';
import { Button } from '../../ui/button';
import { Modal } from '../../ui/modal';

interface LeaderDialogProps {
    name: string;
    onConfirm: () => void;
    onClose: () => void;
}

/** "Make <name> the leader?" — Cancel or hand over. */
export function CommunityLeaderDialog({ name, onConfirm, onClose }: LeaderDialogProps): JSX.Element {
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    const title = `Make ${name} the leader?`;
    const footer = (
        <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" data-testid="community-leader-confirm" onClick={onConfirm}>Make leader</Button>
        </div>
    );
    const body = (
        <p className="text-sm text-secondary" data-testid="community-leader-dialog">
            They run the hub from now on and you become an officer. Only they can hand leadership back.
        </p>
    );
    if (isDesktop) return <Modal isOpen onClose={onClose} title={title} footer={footer}>{body}</Modal>;
    return <BottomSheet isOpen onClose={onClose} title={title} footer={footer}>{body}</BottomSheet>;
}
