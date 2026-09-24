import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth, isImpersonating } from '../../hooks/use-auth';
import { deleteMyAccount } from '../../lib/api-client';
import { Modal } from '../../components/ui/modal';
import { Button } from '../../components/ui/button';
import { Field } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { toast } from '../../lib/toast';

/**
 * ROK-405: Danger Zone — Delete Account panel.
 * User must type their display name to confirm deletion.
 */
function useDeleteAccount(confirmName: string) {
    const { logout } = useAuth();
    const navigate = useNavigate();
    return useMutation({
        mutationFn: () => deleteMyAccount(confirmName),
        onSuccess: () => { logout(); toast.success('Your account has been deleted'); navigate('/login', { replace: true }); },
        onError: (err) => { toast.error(err instanceof Error ? err.message : 'Failed to delete account'); },
    });
}

function DangerZoneCard({ onDelete }: { onDelete: () => void }) {
    return (
        <div className="bg-danger/10 border border-danger/20 rounded-lg p-4">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h3 className="text-sm font-semibold text-foreground">Delete My Account</h3>
                    <p className="text-sm text-muted mt-1">Permanently delete your account, characters, event signups, and all associated data. This cannot be undone.</p>
                </div>
                <Button variant="destructive" onClick={onDelete} className="flex-shrink-0">Delete My Account</Button>
            </div>
        </div>
    );
}

function DeleteConfirmModalBody({ expectedName, confirmName, setConfirmName, onCancel, onConfirm, isPending, isValid }: {
    expectedName: string; confirmName: string; setConfirmName: (v: string) => void; onCancel: () => void; onConfirm: () => void; isPending: boolean; isValid: boolean;
}) {
    return (
        <div className="space-y-4">
            <div className="bg-danger/10 border border-danger/30 rounded-lg p-3">
                <p className="text-sm text-danger font-medium mb-1">This action is permanent and cannot be undone.</p>
                <p className="text-sm text-danger/80">This will permanently delete your account, characters, event signups, and all associated data.</p>
            </div>
            <Field id="confirm-name" label={`Type ${expectedName} to confirm`}>
                <Input type="text" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={expectedName} autoComplete="off" />
            </Field>
            <div className="flex justify-end gap-3 pt-2">
                <Button variant="secondary" onClick={onCancel}>Cancel</Button>
                <Button variant="destructive" onClick={onConfirm} disabled={!isValid} loading={isPending} loadingLabel="Deleting…">
                    Delete My Account
                </Button>
            </div>
        </div>
    );
}

export function DeleteAccountPanel() {
    const { user } = useAuth();
    const [showModal, setShowModal] = useState(false);
    const [confirmName, setConfirmName] = useState('');
    const expectedName = user?.displayName || user?.username || '';
    const deleteMutation = useDeleteAccount(confirmName);
    const closeModal = () => { setShowModal(false); setConfirmName(''); };

    if (!user || isImpersonating()) return null;

    return (
        <div className="space-y-6">
            <div className="bg-danger/5 border border-danger/30 rounded-xl p-6">
                <h2 className="text-xl font-semibold text-danger mb-1">Danger Zone</h2>
                <p className="text-sm text-muted mb-6">Irreversible actions that permanently affect your account.</p>
                <DangerZoneCard onDelete={() => setShowModal(true)} />
            </div>
            <Modal isOpen={showModal} onClose={closeModal} title="Delete Account">
                <DeleteConfirmModalBody expectedName={expectedName} confirmName={confirmName} setConfirmName={setConfirmName}
                    onCancel={closeModal} onConfirm={() => deleteMutation.mutate()} isPending={deleteMutation.isPending} isValid={confirmName === expectedName} />
            </Modal>
        </div>
    );
}
