import { useState } from 'react';
import { toast } from '../../lib/toast';
import { Modal } from '../ui/modal';
import { unlinkDiscord } from '../../lib/api-client';

interface DiscordDetailsModalProps {
    isOpen: boolean;
    onClose: () => void;
    username: string;
    discordId: string;
    avatar: string | null;
    onRefresh?: () => void;
}

/**
 * Modal showing Discord link details with unlink option (ROK-195 AC-8).
 * Two-click confirmation on unlink to prevent accidents.
 */
export function DiscordDetailsModal({
    isOpen,
    onClose,
    username,
    discordId,
    avatar,
    onRefresh,
}: DiscordDetailsModalProps) {
    const [confirmStep, setConfirmStep] = useState<'idle' | 'confirming'>('idle');
    const [unlinking, setUnlinking] = useState(false);

    const avatarUrl = avatar
        ? `https://cdn.discordapp.com/avatars/${discordId}/${avatar}.png?size=128`
        : null;

    const handleUnlink = async () => {
        if (confirmStep === 'idle') {
            setConfirmStep('confirming');
            return;
        }

        setUnlinking(true);
        try {
            await unlinkDiscord();
            toast.success('Discord account unlinked');
            onClose();
            onRefresh?.();
        } catch (err) {
            toast.error(
                err instanceof Error ? err.message : 'Failed to unlink Discord',
            );
        } finally {
            setUnlinking(false);
            setConfirmStep('idle');
        }
    };

    const handleClose = () => {
        setConfirmStep('idle');
        onClose();
    };

    return (
        <Modal isOpen={isOpen} onClose={handleClose} title="Discord Auth Module">
            <div className="space-y-5">
                {/* Discord profile info */}
                <div className="flex items-center gap-4">
                    {avatarUrl ? (
                        <img
                            src={avatarUrl}
                            alt={username}
                            className="w-14 h-14 rounded-full border-2 border-emerald-500/50"
                        />
                    ) : (
                        <div className="w-14 h-14 rounded-full bg-indigo-600 flex items-center justify-center border-2 border-emerald-500/50">
                            <span className="text-foreground text-lg font-bold">
                                {username[0]?.toUpperCase()}
                            </span>
                        </div>
                    )}
                    <div>
                        <p className="text-foreground font-semibold text-lg">{username}</p>
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                            Linked
                        </span>
                    </div>
                </div>

                {/* Warning */}
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                    <p className="text-amber-300 text-sm leading-relaxed">
                        If you unlink and log out without a local password, logging in
                        via Discord will re-link your account automatically.
                    </p>
                </div>

                {/* Unlink action */}
                <div className="pt-1">
                    <button
                        onClick={handleUnlink}
                        disabled={unlinking}
                        className={`w-full py-2.5 rounded-lg font-medium text-sm transition-colors ${
                            confirmStep === 'confirming'
                                ? 'bg-red-600 hover:bg-red-500 text-foreground'
                                : 'bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30'
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                        {unlinking
                            ? 'Unlinking...'
                            : confirmStep === 'confirming'
                              ? 'Are you sure? Click to confirm'
                              : 'Unlink Discord'}
                    </button>
                    {confirmStep === 'confirming' && (
                        <button
                            onClick={() => setConfirmStep('idle')}
                            className="w-full mt-2 py-2 text-sm text-muted hover:text-secondary transition-colors"
                        >
                            Cancel
                        </button>
                    )}
                </div>
            </div>
        </Modal>
    );
}
