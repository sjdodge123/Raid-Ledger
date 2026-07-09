import { useState } from 'react';
import { Modal } from '../ui/modal';
import { ReasonField } from '../lineups/shared/ReasonField';
import { isRealDiscordId, CHECKBOX_CLASS, type ModerationTarget } from './moderation-shared';
import type { BanUserDto } from '@raid-ledger/contract';

interface BanUserModalProps {
    target: ModerationTarget | null;
    onClose: () => void;
    onConfirm: (body: BanUserDto) => void;
    isPending: boolean;
}

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
                <label className="flex items-start gap-2 text-sm text-foreground">
                    <input type="checkbox" checked={wipeData} onChange={(e) => setWipeData(e.target.checked)}
                        className={`mt-0.5 ${CHECKBOX_CLASS}`} />
                    <span>
                        Wipe user data
                        <span className="block text-xs text-red-400">
                            Permanently deletes their characters, signups, and preferences. This cannot be undone.
                        </span>
                    </span>
                </label>
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
                        className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 disabled:bg-red-800 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors">
                        {isPending ? 'Banning...' : 'Ban'}
                    </button>
                </div>
            </div>
        </Modal>
    );
}
