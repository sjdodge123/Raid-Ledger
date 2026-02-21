import { useState } from 'react';
import type { BackupFileDto } from '@raid-ledger/contract';
import { useQueryClient } from '@tanstack/react-query';
import { useBackups } from '../../hooks/use-backups';
import { useTimezoneStore } from '../../stores/timezone-store';
import { toast } from 'sonner';

type FilterType = 'all' | 'daily' | 'migration';

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(iso: string, tz: string): string {
    return new Date(iso).toLocaleString('en-US', {
        timeZone: tz,
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    });
}

const TYPE_BADGE: Record<string, string> = {
    daily: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    migration: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
};

/* ─── Delete Confirmation Modal ─── */
function DeleteModal({
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

/* ─── Restore Confirmation Modal ─── */
function RestoreModal({
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

/* ─── Reset Instance Modal ─── */
function ResetModal({
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
                                <button
                                    onClick={() => {
                                        navigator.clipboard.writeText(result.password);
                                        setCopied(true);
                                        setTimeout(() => setCopied(false), 2000);
                                    }}
                                    className="text-xs text-accent hover:text-accent/80"
                                >
                                    {copied ? 'Copied!' : 'Copy'}
                                </button>
                            </div>
                        </div>
                    </div>
                    <div className="flex justify-end mt-6">
                        <button
                            onClick={() => {
                                localStorage.removeItem('auth_token');
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

/* ─── Main Panel ─── */
export function BackupsPanel() {
    const queryClient = useQueryClient();
    const { backups, createBackup, deleteBackup, restoreBackup, resetInstance } = useBackups();
    const tz = useTimezoneStore((s) => s.resolved);
    const [filter, setFilter] = useState<FilterType>('all');
    const [deleteTarget, setDeleteTarget] = useState<BackupFileDto | null>(null);
    const [restoreTarget, setRestoreTarget] = useState<BackupFileDto | null>(null);
    const [showResetModal, setShowResetModal] = useState(false);
    const [resetResult, setResetResult] = useState<{ password: string } | null>(null);

    const allBackups = backups.data?.backups ?? [];
    const filtered = filter === 'all'
        ? allBackups
        : allBackups.filter((b) => b.type === filter);

    const dailyCount = allBackups.filter((b) => b.type === 'daily').length;
    const migrationCount = allBackups.filter((b) => b.type === 'migration').length;

    const handleCreate = () => {
        createBackup.mutate(undefined, {
            onSuccess: (data) => toast.success(data.message),
            onError: (err) => toast.error(err.message),
        });
    };

    const handleDelete = () => {
        if (!deleteTarget) return;
        deleteBackup.mutate(
            { type: deleteTarget.type, filename: deleteTarget.filename },
            {
                onSuccess: (data) => {
                    toast.success(data.message);
                    setDeleteTarget(null);
                },
                onError: (err) => toast.error(err.message),
            },
        );
    };

    const handleRestore = () => {
        if (!restoreTarget) return;
        restoreBackup.mutate(
            { type: restoreTarget.type, filename: restoreTarget.filename },
            {
                onSuccess: (data) => {
                    toast.success(data.message);
                    setRestoreTarget(null);
                },
                onError: (err) => toast.error(err.message),
            },
        );
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-start justify-between">
                <div>
                    <h2 className="text-xl font-semibold text-foreground">Backups</h2>
                    <p className="text-sm text-muted mt-1">
                        Manage database backups. Daily backups run automatically at 2 AM with 30-day retention.
                    </p>
                </div>
                <button
                    onClick={handleCreate}
                    disabled={createBackup.isPending}
                    className="px-4 py-2 text-sm font-medium bg-accent/20 text-accent border border-accent/40 rounded-lg hover:bg-accent/30 transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                    {createBackup.isPending ? 'Creating...' : 'Create Backup'}
                </button>
            </div>

            {/* Filter pills */}
            {allBackups.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                    <button
                        onClick={() => setFilter('all')}
                        className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${filter === 'all'
                            ? 'bg-accent/20 text-accent border-accent/40'
                            : 'bg-surface/50 text-muted border-edge hover:text-foreground'
                            }`}
                    >
                        All ({allBackups.length})
                    </button>
                    <button
                        onClick={() => setFilter(filter === 'daily' ? 'all' : 'daily')}
                        className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${filter === 'daily'
                            ? TYPE_BADGE.daily
                            : 'bg-surface/50 text-muted border-edge hover:text-foreground'
                            }`}
                    >
                        Daily ({dailyCount})
                    </button>
                    <button
                        onClick={() => setFilter(filter === 'migration' ? 'all' : 'migration')}
                        className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${filter === 'migration'
                            ? TYPE_BADGE.migration
                            : 'bg-surface/50 text-muted border-edge hover:text-foreground'
                            }`}
                    >
                        Migration ({migrationCount})
                    </button>
                </div>
            )}

            {/* Loading */}
            {backups.isLoading && (
                <div className="py-12 text-center text-muted text-sm">Loading backups...</div>
            )}

            {/* Error */}
            {backups.isError && (
                <div className="py-12 text-center text-red-400 text-sm">
                    Failed to load backups. Please try again.
                </div>
            )}

            {/* Empty */}
            {backups.data && allBackups.length === 0 && (
                <div className="py-12 text-center text-muted text-sm">
                    No backup files found. Backups are created automatically at 2 AM daily.
                    You can also create one manually.
                </div>
            )}

            {/* Table */}
            {filtered.length > 0 && (
                <div className="border border-edge rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-edge bg-surface/50">
                                <th className="text-left px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider">Type</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider">Filename</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider hidden sm:table-cell">Date</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider hidden md:table-cell">Size</th>
                                <th className="text-right px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-edge">
                            {filtered.map((backup) => (
                                <tr key={`${backup.type}/${backup.filename}`} className="hover:bg-surface/30 transition-colors">
                                    <td className="px-4 py-3">
                                        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full border ${TYPE_BADGE[backup.type]}`}>
                                            {backup.type}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 font-mono text-xs text-foreground truncate max-w-[200px]">
                                        {backup.filename}
                                        <span className="sm:hidden block text-muted font-sans mt-0.5">{formatDate(backup.createdAt, tz)}</span>
                                    </td>
                                    <td className="px-4 py-3 text-muted hidden sm:table-cell">{formatDate(backup.createdAt, tz)}</td>
                                    <td className="px-4 py-3 text-muted hidden md:table-cell">{formatSize(backup.sizeBytes)}</td>
                                    <td className="px-4 py-3 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <button
                                                onClick={() => setRestoreTarget(backup)}
                                                className="px-3 py-1 text-xs font-medium text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg hover:bg-amber-500/20 transition-colors"
                                            >
                                                Restore
                                            </button>
                                            <button
                                                onClick={() => setDeleteTarget(backup)}
                                                className="px-3 py-1 text-xs font-medium text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg hover:bg-red-500/20 transition-colors"
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Empty filter state */}
            {allBackups.length > 0 && filtered.length === 0 && (
                <div className="py-12 text-center text-muted text-sm">
                    No backups match the selected filter.
                </div>
            )}

            {/* Danger Zone */}
            <div className="mt-8 border border-red-500/30 rounded-xl overflow-hidden">
                <div className="px-4 py-3 bg-red-500/5 border-b border-red-500/30">
                    <h3 className="text-sm font-semibold text-red-400 uppercase tracking-wider">Danger Zone</h3>
                </div>
                <div className="p-4 flex items-center justify-between gap-4">
                    <div>
                        <p className="text-sm font-medium text-foreground">Reset Instance</p>
                        <p className="text-xs text-muted mt-0.5">
                            Wipe all data and return to factory defaults. A safety backup is created automatically.
                        </p>
                    </div>
                    <button
                        onClick={() => setShowResetModal(true)}
                        className="px-4 py-2 text-sm font-medium text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg hover:bg-red-500/20 transition-colors whitespace-nowrap"
                    >
                        Reset Instance
                    </button>
                </div>
            </div>

            {/* Modals */}
            {deleteTarget && (
                <DeleteModal
                    backup={deleteTarget}
                    onClose={() => setDeleteTarget(null)}
                    onConfirm={handleDelete}
                    isPending={deleteBackup.isPending}
                />
            )}
            {restoreTarget && (
                <RestoreModal
                    backup={restoreTarget}
                    onClose={() => setRestoreTarget(null)}
                    onConfirm={handleRestore}
                    isPending={restoreBackup.isPending}
                />
            )}
            {showResetModal && (
                <ResetModal
                    onClose={() => {
                        if (!resetInstance.isPending) {
                            setShowResetModal(false);
                            setResetResult(null);
                        }
                    }}
                    onConfirm={() => {
                        // Cancel all background queries so 401s during DB rebuild
                        // don't trigger auth redirect before we get the new password
                        queryClient.cancelQueries();
                        queryClient.setDefaultOptions({
                            queries: { enabled: false },
                        });
                        resetInstance.mutate(undefined, {
                            onSuccess: (data) => setResetResult({ password: data.password }),
                            onError: (err) => {
                                // Re-enable queries on failure
                                queryClient.setDefaultOptions({
                                    queries: { enabled: undefined },
                                });
                                toast.error(err.message);
                            },
                        });
                    }}
                    isPending={resetInstance.isPending}
                    result={resetResult}
                />
            )}
        </div>
    );
}
