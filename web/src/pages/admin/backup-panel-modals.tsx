import { useState } from 'react';
import type { BackupFileDto } from '@raid-ledger/contract';
import { formatSize } from './backup-panel-utils';

export function DeleteModal({
    backup,
    onClose,
    onConfirm,
    isPending,
}: {
    backup: BackupFileDto;
    onClose: () => void;
    onConfirm: () => void;
    isPending: boolean;
}) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-surface border border-edge rounded-xl p-6 w-full max-w-md shadow-2xl">
                <h3 className="text-lg font-semibold text-foreground">Delete Backup</h3>
                <p className="text-sm text-muted mt-2">
                    Are you sure you want to delete <span className="font-mono text-foreground">{backup.filename}</span>?
                    This cannot be undone.
                </p>
                <div className="flex justify-end gap-3 mt-6">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm text-muted hover:text-foreground border border-edge rounded-lg transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={isPending}
                        className="px-4 py-2 text-sm bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/30 transition-colors disabled:opacity-50"
                    >
                        {isPending ? 'Deleting...' : 'Delete'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// eslint-disable-next-line max-lines-per-function
export function RestoreModal({
    backup,
    onClose,
    onConfirm,
    isPending,
}: {
    backup: BackupFileDto;
    onClose: () => void;
    onConfirm: () => void;
    isPending: boolean;
}) {
    const [confirmText, setConfirmText] = useState('');
    const isConfirmed = confirmText === 'RESTORE';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-surface border border-edge rounded-xl p-6 w-full max-w-lg shadow-2xl">
                <h3 className="text-lg font-semibold text-foreground">Restore from Backup</h3>
                <div className="mt-4 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
                    <p className="text-sm text-red-400 font-medium">Warning: This is a destructive operation</p>
                    <p className="text-sm text-red-400/80 mt-1">
                        This will drop and recreate all database tables from the selected backup.
                        A pre-restore safety snapshot will be created automatically.
                    </p>
                </div>
                <div className="mt-4 text-sm text-muted">
                    <p>Restoring from: <span className="font-mono text-foreground">{backup.filename}</span></p>
                    <p>Type: <span className="text-foreground capitalize">{backup.type}</span> &middot; Size: <span className="text-foreground">{formatSize(backup.sizeBytes)}</span></p>
                </div>
                <div className="mt-4">
                    <label className="block text-sm text-muted mb-1">
                        Type <span className="font-mono text-foreground">RESTORE</span> to confirm
                    </label>
                    <input
                        type="text"
                        value={confirmText}
                        onChange={(e) => setConfirmText(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-background border border-edge rounded-lg text-foreground placeholder-muted focus:ring-1 focus:ring-accent/50 focus:border-accent/50"
                        placeholder="RESTORE"
                        autoFocus
                    />
                </div>
                <div className="flex justify-end gap-3 mt-6">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm text-muted hover:text-foreground border border-edge rounded-lg transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={!isConfirmed || isPending}
                        className="px-4 py-2 text-sm bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isPending ? 'Restoring...' : 'Restore Database'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// eslint-disable-next-line max-lines-per-function
export function ResetModal({
    onClose,
    onConfirm,
    isPending,
    result,
}: {
    onClose: () => void;
    onConfirm: () => void;
    isPending: boolean;
    result: { password: string } | null;
}) {
    const [confirmText, setConfirmText] = useState('');
    const isConfirmed = confirmText === 'RESET';
    const [copied, setCopied] = useState(false);

    if (result) {
        return (
            <ResetResultView
                result={result}
                copied={copied}
                onCopy={() => {
                    navigator.clipboard.writeText(result.password);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                }}
            />
        );
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-surface border border-edge rounded-xl p-6 w-full max-w-lg shadow-2xl">
                <h3 className="text-lg font-semibold text-red-400">Reset Instance</h3>
                <div className="mt-4 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
                    <p className="text-sm text-red-400 font-medium">This will permanently delete ALL data</p>
                    <p className="text-sm text-red-400/80 mt-1">
                        All users, events, characters, settings, and integrations will be wiped.
                        A safety backup will be created automatically before the reset.
                    </p>
                </div>
                <div className="mt-4">
                    <label className="block text-sm text-muted mb-1">
                        Type <span className="font-mono text-foreground">RESET</span> to confirm
                    </label>
                    <input
                        type="text"
                        value={confirmText}
                        onChange={(e) => setConfirmText(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-background border border-edge rounded-lg text-foreground placeholder-muted focus:ring-1 focus:ring-accent/50 focus:border-accent/50"
                        placeholder="RESET"
                        autoFocus
                        disabled={isPending}
                    />
                </div>
                <div className="flex justify-end gap-3 mt-6">
                    <button
                        onClick={onClose}
                        disabled={isPending}
                        className="px-4 py-2 text-sm text-muted hover:text-foreground border border-edge rounded-lg transition-colors disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={!isConfirmed || isPending}
                        className="px-4 py-2 text-sm bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isPending ? 'Resetting...' : 'Reset Instance'}
                    </button>
                </div>
            </div>
        </div>
    );
}

function ResetResultView({ result, copied, onCopy }: { result: { password: string }; copied: boolean; onCopy: () => void }) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-surface border border-edge rounded-xl p-6 w-full max-w-lg shadow-2xl">
                <h3 className="text-lg font-semibold text-foreground">Instance Reset Complete</h3>
                <p className="text-sm text-muted mt-2">
                    The instance has been reset to factory defaults. Use these credentials to log in:
                </p>
                <div className="mt-4 p-4 bg-background border border-edge rounded-lg space-y-2">
                    <div className="flex items-center justify-between">
                        <span className="text-sm text-muted">Email</span>
                        <span className="font-mono text-sm text-foreground">admin@local</span>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-sm text-muted">Password</span>
                        <div className="flex items-center gap-2">
                            <span className="font-mono text-sm text-foreground">{result.password}</span>
                            <button onClick={onCopy} className="text-xs text-accent hover:text-accent/80">
                                {copied ? 'Copied!' : 'Copy'}
                            </button>
                        </div>
                    </div>
                </div>
                <div className="flex justify-end mt-6">
                    <button
                        onClick={() => {
                            localStorage.removeItem('raid_ledger_token');
                            localStorage.removeItem('raid_ledger_original_token');
                            window.location.href = '/login';
                        }}
                        className="px-4 py-2 text-sm font-medium bg-accent/20 text-accent border border-accent/40 rounded-lg hover:bg-accent/30 transition-colors"
                    >
                        Go to Login
                    </button>
                </div>
            </div>
        </div>
    );
}
