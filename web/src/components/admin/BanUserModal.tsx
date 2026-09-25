import { useState } from 'react';
import { Modal } from '../ui/modal';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { ReasonField } from '../lineups/shared/ReasonField';
import { useDirtyCloseGuard } from '../../hooks/use-dirty-close-guard';
import { isRealDiscordId, type ModerationTarget } from './moderation-shared';
import type { BanUserDto } from '@raid-ledger/contract';

interface BanUserModalProps {
    target: ModerationTarget | null;
    onClose: () => void;
    onConfirm: (body: BanUserDto) => void;
    isPending: boolean;
}

/** The wipe option's irreversibility warning, danger-toned (ruling 9: was text-red-400). */
const WIPE_WARNING = (
    <span className="text-danger">
        Permanently deletes their characters, signups, and preferences. This cannot be undone.
    </span>
);

/** Cancel (guarded — ruling 4) and the destructive Ban, in the Modal's pinned footer. */
function BanFooter({ onCancel, onConfirm, isPending }: { onCancel: () => void; onConfirm: () => void; isPending: boolean }) {
    return (
        <>
            <Button variant="secondary" onClick={onCancel}>Cancel</Button>
            <Button variant="destructive" onClick={onConfirm} loading={isPending} loadingLabel="Banning...">
                Ban
            </Button>
        </>
    );
}

/**
 * Confirm modal for admin "ban" (permanent lockout, ROK-313 §6d). Ban blocks all
 * future logins, drops the user from the Players list, and cancels upcoming
 * signups. Optional data wipe permanently deletes their content. Optional
 * Discord guild kick. The parent keys this by target id for fresh local state.
 *
 * ROK-1655: once a reason is typed, Escape, the backdrop, × and Cancel ask
 * "Discard your changes?" first. A completed ban closes through the parent
 * nulling `target` (an unguarded `isOpen` flip), so it never asks.
 */
export function BanUserModal({ target, onClose, onConfirm, isPending }: BanUserModalProps) {
    const [reason, setReason] = useState('');
    const [wipeData, setWipeData] = useState(false);
    const [kickFromDiscord, setKickFromDiscord] = useState(false);
    const guard = useDirtyCloseGuard(reason.trim() !== '', onClose);

    const handleConfirm = () => onConfirm({ reason: reason.trim() || undefined, wipeData, kickFromDiscord });

    return (
        <Modal isOpen={!!target} onClose={onClose} title={`Ban ${target?.username ?? ''}`} closeGuard={guard}
            discardMessage="The reason you typed hasn't been recorded yet."
            footer={<BanFooter onCancel={guard.requestClose} onConfirm={handleConfirm} isPending={isPending} />}>
            <div className="space-y-4">
                <p className="text-secondary">
                    Ban <strong className="text-foreground">{target?.username}</strong>? They will be permanently
                    blocked from logging in, removed from the Players list, and cancelled from upcoming events.
                </p>
                <ReasonField id="ban-reason" value={reason} onChange={setReason}
                    placeholder="Optional note recorded in the moderation log" />
                <Checkbox label="Wipe user data" description={WIPE_WARNING} checked={wipeData}
                    onChange={(e) => setWipeData(e.target.checked)} />
                {isRealDiscordId(target?.discordId) && (
                    <Checkbox label="Also kick from Discord server" checked={kickFromDiscord}
                        onChange={(e) => setKickFromDiscord(e.target.checked)} />
                )}
            </div>
        </Modal>
    );
}
