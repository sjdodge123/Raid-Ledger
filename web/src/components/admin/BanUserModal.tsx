import { useState } from 'react';
import { Modal } from '../ui/modal';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { ReasonField } from '../lineups/shared/ReasonField';
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

/**
 * Confirm modal for admin "ban" (permanent lockout, ROK-313 §6d). Ban blocks all
 * future logins, drops the user from the Players list, and cancels upcoming
 * signups. Optional data wipe permanently deletes their content. Optional
 * Discord guild kick. The parent keys this by target id for fresh local state.
 */
export function BanUserModal({ target, onClose, onConfirm, isPending }: BanUserModalProps) {
    const [reason, setReason] = useState('');
    const [wipeData, setWipeData] = useState(false);
    const [kickFromDiscord, setKickFromDiscord] = useState(false);

    const handleConfirm = () => onConfirm({ reason: reason.trim() || undefined, wipeData, kickFromDiscord });

    return (
        <Modal isOpen={!!target} onClose={onClose} title={`Ban ${target?.username ?? ''}`}>
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
                <div className="flex justify-end gap-3 pt-2">
                    <Button variant="secondary" onClick={onClose}>Cancel</Button>
                    <Button variant="destructive" onClick={handleConfirm} loading={isPending} loadingLabel="Banning...">
                        Ban
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
