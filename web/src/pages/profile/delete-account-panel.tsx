import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth, isImpersonating } from '../../hooks/use-auth';
import { deleteMyAccount } from '../../lib/api-client';
import { Modal } from '../../components/ui/modal';
import { toast } from '../../lib/toast';

/**
 * ROK-405: Danger Zone — Delete Account panel.
 * User must type their display name to confirm deletion.
 */
export function DeleteAccountPanel() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const [showModal, setShowModal] = useState(false);
    const [confirmName, setConfirmName] = useState('');

    const expectedName = user?.displayName || user?.username || '';

    const deleteMutation = useMutation({
        mutationFn: () => deleteMyAccount(confirmName),
        onSuccess: () => {
            logout();
            toast.success('Your account has been deleted');
            navigate('/login', { replace: true });
        },
        onError: (err) => {
            toast.error(
                err instanceof Error ? err.message : 'Failed to delete account',
            );
        },
    });

    const isConfirmValid = confirmName === expectedName;

    if (!user || isImpersonating()) return null;

    return (
        <div className="space-y-6">
            <div className="bg-red-500/5 border border-red-500/30 rounded-xl p-6">
                <h2 className="text-xl font-semibold text-red-400 mb-1">
                    Danger Zone
                </h2>
                <p className="text-sm text-muted mb-6">
                    Irreversible actions that permanently affect your account.
                </p>

                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <h3 className="text-sm font-semibold text-foreground">
                                Delete My Account
                            </h3>
                            <p className="text-sm text-muted mt-1">
                                Permanently delete your account, characters, event signups,
                                and all associated data. This cannot be undone.
                            </p>
                        </div>
                        <button
                            onClick={() => setShowModal(true)}
                            className="flex-shrink-0 px-4 py-2 bg-red-600 hover:bg-red-500 text-white font-medium text-sm rounded-lg transition-colors"
                        >
                            Delete My Account
                        </button>
                    </div>
                </div>
            </div>

            <Modal
                isOpen={showModal}
                onClose={() => {
                    setShowModal(false);
                    setConfirmName('');
                }}
                title="Delete Account"
            >
                <div className="space-y-4">
                    <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                        <p className="text-sm text-red-400 font-medium mb-1">
                            This action is permanent and cannot be undone.
                        </p>
                        <p className="text-sm text-red-400/80">
                            This will permanently delete your account, characters,
                            event signups, and all associated data.
                        </p>
                    </div>

                    <div>
                        <label
                            htmlFor="confirm-name"
                            className="block text-sm text-secondary mb-1.5"
                        >
                            Type{' '}
                            <strong className="text-foreground">
                                {expectedName}
                            </strong>{' '}
                            to confirm
                        </label>
                        <input
                            id="confirm-name"
                            type="text"
                            value={confirmName}
                            onChange={(e) => setConfirmName(e.target.value)}
                            placeholder={expectedName}
                            className="w-full px-3 py-2 bg-surface/50 border border-edge rounded-lg text-sm text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent transition-all"
                            autoComplete="off"
                        />
                    </div>

                    <div className="flex justify-end gap-3 pt-2">
                        <button
                            onClick={() => {
                                setShowModal(false);
                                setConfirmName('');
                            }}
                            className="px-4 py-2 text-sm bg-overlay hover:bg-faint text-foreground rounded-lg transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={() => deleteMutation.mutate()}
                            disabled={!isConfirmValid || deleteMutation.isPending}
                            className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 disabled:bg-red-800 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
                        >
                            {deleteMutation.isPending
                                ? 'Deleting...'
                                : 'Delete My Account'}
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
}
