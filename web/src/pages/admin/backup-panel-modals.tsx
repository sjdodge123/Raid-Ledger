import { useState } from 'react';
import type { BackupFileDto } from '@raid-ledger/contract';
import { formatSize } from './backup-panel-utils';

export function DeleteModal({ backup, onClose, onConfirm, isPending }: {
    backup: BackupFileDto; onClose: () => void; onConfirm: () => void; isPending: boolean;
}) {
    return (
        <ModalOverlay maxWidth="max-w-md">
            <h3 className="text-lg font-semibold text-foreground">Delete Backup</h3>
            <p className="text-sm text-muted mt-2">
                Are you sure you want to delete <span className="font-mono text-foreground">{backup.filename}</span>? This cannot be undone.
            </p>
            <ModalActions onClose={onClose} onConfirm={onConfirm} isPending={isPending} confirmLabel="Delete" pendingLabel="Deleting..." />
        </ModalOverlay>
    );
}

function ModalOverlay({ maxWidth, children }: { maxWidth: string; children: React.ReactNode }) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className={`bg-surface border border-edge rounded-xl p-6 w-full ${maxWidth} shadow-2xl`}>{children}</div>
        </div>
    );
}

function ModalActions({ onClose, onConfirm, isPending, confirmLabel, pendingLabel, disabled }: {
    onClose: () => void; onConfirm: () => void; isPending: boolean; confirmLabel: string; pendingLabel: string; disabled?: boolean;
}) {
    return (
        <div className="flex justify-end gap-3 mt-6">
            <button onClick={onClose} disabled={isPending} className="px-4 py-2 text-sm text-muted hover:text-foreground border border-edge rounded-lg transition-colors disabled:opacity-50">Cancel</button>
            <button onClick={onConfirm} disabled={(disabled ?? false) || isPending}
                className="px-4 py-2 text-sm bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                {isPending ? pendingLabel : confirmLabel}
            </button>
        </div>
    );
}

export function RestoreModal({ backup, onClose, onConfirm, isPending }: {
    backup: BackupFileDto; onClose: () => void; onConfirm: () => void; isPending: boolean;
}) {
    const [confirmText, setConfirmText] = useState('');

    return (
        <ModalOverlay maxWidth="max-w-lg">
            <h3 className="text-lg font-semibold text-foreground">Restore from Backup</h3>
            <DestructiveWarning title="Warning: This is a destructive operation"
                message="This will drop and recreate all database tables from the selected backup. A pre-restore safety snapshot will be created automatically." />
            <div className="mt-4 text-sm text-muted">
                <p>Restoring from: <span className="font-mono text-foreground">{backup.filename}</span></p>
                <p>Type: <span className="text-foreground capitalize">{backup.type}</span> &middot; Size: <span className="text-foreground">{formatSize(backup.sizeBytes)}</span></p>
            </div>
            <ConfirmTextInput value={confirmText} onChange={setConfirmText} keyword="RESTORE" />
            <ModalActions onClose={onClose} onConfirm={onConfirm} isPending={isPending} disabled={confirmText !== 'RESTORE'}
                confirmLabel="Restore Database" pendingLabel="Restoring..." />
        </ModalOverlay>
    );
}

export function ResetModal({ onClose, onConfirm, isPending, result }: {
    onClose: () => void; onConfirm: () => void; isPending: boolean; result: { password: string } | null;
}) {
    const [confirmText, setConfirmText] = useState('');
    const [copied, setCopied] = useState(false);

    if (result) {
        return <ResetResultView result={result} copied={copied} onCopy={() => {
            navigator.clipboard.writeText(result.password);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }} />;
    }

    return (
        <ModalOverlay maxWidth="max-w-lg">
            <h3 className="text-lg font-semibold text-red-400">Reset Instance</h3>
            <DestructiveWarning title="This will permanently delete ALL data"
                message="All users, events, characters, settings, and integrations will be wiped. A safety backup will be created automatically before the reset." />
            <ConfirmTextInput value={confirmText} onChange={setConfirmText} keyword="RESET" disabled={isPending} />
            <ModalActions onClose={onClose} onConfirm={onConfirm} isPending={isPending} disabled={confirmText !== 'RESET'}
                confirmLabel="Reset Instance" pendingLabel="Resetting..." />
        </ModalOverlay>
    );
}

function DestructiveWarning({ title, message }: { title: string; message: string }) {
    return (
        <div className="mt-4 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
            <p className="text-sm text-red-400 font-medium">{title}</p>
            <p className="text-sm text-red-400/80 mt-1">{message}</p>
        </div>
    );
}

function ConfirmTextInput({ value, onChange, keyword, disabled }: {
    value: string; onChange: (v: string) => void; keyword: string; disabled?: boolean;
}) {
    return (
        <div className="mt-4">
            <label className="block text-sm text-muted mb-1">Type <span className="font-mono text-foreground">{keyword}</span> to confirm</label>
            <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={keyword} autoFocus disabled={disabled}
                className="w-full px-3 py-2 text-sm bg-background border border-edge rounded-lg text-foreground placeholder-muted focus:ring-1 focus:ring-accent/50 focus:border-accent/50" />
        </div>
    );
}

function ResetResultView({ result, copied, onCopy }: { result: { password: string }; copied: boolean; onCopy: () => void }) {
    const handleGoToLogin = () => {
        localStorage.removeItem('raid_ledger_token');
        localStorage.removeItem('raid_ledger_original_token');
        window.location.href = '/login';
    };

    return (
        <ModalOverlay maxWidth="max-w-lg">
            <h3 className="text-lg font-semibold text-foreground">Instance Reset Complete</h3>
            <p className="text-sm text-muted mt-2">The instance has been reset to factory defaults. Use these credentials to log in:</p>
            <div className="mt-4 p-4 bg-background border border-edge rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                    <span className="text-sm text-muted">Email</span>
                    <span className="font-mono text-sm text-foreground">admin@local</span>
                </div>
                <div className="flex items-center justify-between">
                    <span className="text-sm text-muted">Password</span>
                    <div className="flex items-center gap-2">
                        <span className="font-mono text-sm text-foreground">{result.password}</span>
                        <button onClick={onCopy} className="text-xs text-accent hover:text-accent/80">{copied ? 'Copied!' : 'Copy'}</button>
                    </div>
                </div>
            </div>
            <div className="flex justify-end mt-6">
                <button onClick={handleGoToLogin} className="px-4 py-2 text-sm font-medium bg-accent/20 text-accent border border-accent/40 rounded-lg hover:bg-accent/30 transition-colors">Go to Login</button>
            </div>
        </ModalOverlay>
    );
}
