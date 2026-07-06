import { useState } from 'react';
import { Modal } from '../ui/modal';
import { ReasonField } from '../lineups/shared/ReasonField';
import { isRealDiscordId, CHECKBOX_CLASS, type ModerationTarget } from './moderation-shared';
import type { KickUserDto } from '@raid-ledger/contract';

interface KickUserModalProps {
    target: ModerationTarget | null;
    onClose: () => void;
    onConfirm: (body: KickUserDto) => void;
    isPending: boolean;
}

/**
 * Confirm modal for admin "kick" (soft removal, ROK-313 §6d). Kick ends the
 * user's session and blocks re-login for 5 minutes but preserves their account
 * and data. Optional reason + optional Discord guild kick.
 *
 * The parent keys this by target id so each open mounts fresh local state.
 */
export function KickUserModal({ target, onClose, onConfirm, isPending }: KickUserModalProps) {
    const [reason, setReason] = useState('');
    const [kickFromDiscord, setKickFromDiscord] = useState(false);

    const handleConfirm = () => onConfirm({ reason: reason.trim() || undefined, kickFromDiscord });

    return (
        <Modal isOpen={!!target} onClose={onClose} title={`Kick ${target?.username ?? ''}`}>
            <div className="space-y-4">
                <p className="text-secondary">
                    Kick <strong className="text-foreground">{target?.username}</strong>? This ends their current
                    session and prevents them from logging back in for 5 minutes. Their account and data are preserved.
                </p>
                <ReasonField id="kick-reason" value={reason} onChange={setReason}
                    placeholder="Optional note recorded in the moderation log" />
                {isRealDiscordId(target?.discordId) && (
                    <label className="flex items-center gap-2 text-sm text-foreground">
                        <input type="checkbox" checked={kickFromDiscord}
                            onChange={(e) => setKickFromDiscord(e.target.checked)} className={CHECKBOX_CLASS} />
                        Also kick from Discord server
                    </label>
                )}
                <div className="flex justify-end gap-3 pt-2">
                    <button onClick={onClose}
                        className="px-4 py-2 text-sm bg-overlay hover:bg-faint text-foreground rounded-lg transition-colors">Cancel</button>
                    <button onClick={handleConfirm} disabled={isPending}
                        className="px-4 py-2 text-sm bg-amber-600 hover:bg-amber-500 disabled:bg-amber-800 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors">
                        {isPending ? 'Kicking...' : 'Kick'}
                    </button>
                </div>
            </div>
        </Modal>
    );
}
