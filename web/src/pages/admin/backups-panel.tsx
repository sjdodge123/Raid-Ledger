import type { JSX } from 'react';
import { useState } from 'react';
import type { BackupFileDto } from '@raid-ledger/contract';
import { useQueryClient } from '@tanstack/react-query';
import { useBackups } from '../../hooks/use-backups';
import { useTimezoneStore } from '../../stores/timezone-store';
import { toast } from 'sonner';
import { formatSize, formatDate, TYPE_BADGE } from './backup-panel-utils';
import { DeleteModal, RestoreModal, ResetModal } from './backup-panel-modals';

type FilterType = 'all' | 'daily' | 'migration';

function useBackupState() {
    const queryClient = useQueryClient();
    const { backups, createBackup, deleteBackup, restoreBackup, resetInstance } = useBackups();
    const [deleteTarget, setDeleteTarget] = useState<BackupFileDto | null>(null);
    const [restoreTarget, setRestoreTarget] = useState<BackupFileDto | null>(null);
    const [showResetModal, setShowResetModal] = useState(false);
    const [resetResult, setResetResult] = useState<{ password: string } | null>(null);

    return {
        queryClient, backups, createBackup, deleteBackup, restoreBackup, resetInstance,
        deleteTarget, setDeleteTarget, restoreTarget, setRestoreTarget,
        showResetModal, setShowResetModal, resetResult, setResetResult,
    };
}

function useBackupActions(state: ReturnType<typeof useBackupState>) {
    const { createBackup, deleteBackup, restoreBackup, resetInstance, queryClient, deleteTarget, setDeleteTarget, restoreTarget, setRestoreTarget, setShowResetModal, setResetResult } = state;
    const handleCreate = (): void => {
        createBackup.mutate(undefined, { onSuccess: (data) => toast.success(data.message), onError: (err) => toast.error(err.message) });
    };
    const handleDelete = (): void => {
        if (!deleteTarget) return;
        deleteBackup.mutate({ type: deleteTarget.type, filename: deleteTarget.filename }, { onSuccess: (data) => { toast.success(data.message); setDeleteTarget(null); }, onError: (err) => toast.error(err.message) });
    };
    const handleRestore = (): void => {
        if (!restoreTarget) return;
        restoreBackup.mutate({ type: restoreTarget.type, filename: restoreTarget.filename }, { onSuccess: (data) => { toast.success(data.message); setRestoreTarget(null); }, onError: (err) => toast.error(err.message) });
    };
    const handleResetConfirm = (): void => {
        resetInstance.mutate(undefined, {
            onSuccess: async (data) => { await queryClient.refetchQueries({ queryKey: ['admin'] }); setResetResult({ password: data.password }); },
            onError: (err) => toast.error(err.message),
        });
    };
    const handleResetClose = (): void => {
        if (!resetInstance.isPending) { setShowResetModal(false); setResetResult(null); }
    };
    return { handleCreate, handleDelete, handleRestore, handleResetConfirm, handleResetClose };
}

/** Admin panel: Backup management with restore, delete, and reset instance */
export function BackupsPanel() {
    const tz = useTimezoneStore((s) => s.resolved);
    const [filter, setFilter] = useState<FilterType>('all');
    const state = useBackupState();
    const h = { ...state, ...useBackupActions(state) };

    const allBackups = h.backups.data?.backups ?? [];
    const filtered = filter === 'all' ? allBackups : allBackups.filter((b) => b.type === filter);
    const dailyCount = allBackups.filter((b) => b.type === 'daily').length;
    const migrationCount = allBackups.filter((b) => b.type === 'migration').length;

    return (
        <div className="space-y-6">
            <BackupHeader onCreateBackup={h.handleCreate} isCreating={h.createBackup.isPending} />
            <FilterPills filter={filter} setFilter={setFilter} allBackups={allBackups} dailyCount={dailyCount} migrationCount={migrationCount} />
            <BackupStates isLoading={h.backups.isLoading} isError={h.backups.isError} isEmpty={allBackups.length === 0} hasData={!!h.backups.data} />
            {filtered.length > 0 && <BackupTable filtered={filtered} tz={tz} onRestore={h.setRestoreTarget} onDelete={h.setDeleteTarget} />}
            <NoFilterMatch show={allBackups.length > 0 && filtered.length === 0} />
            <DangerZone onShowResetModal={() => h.setShowResetModal(true)} />
            {h.deleteTarget && <DeleteModal backup={h.deleteTarget} onClose={() => h.setDeleteTarget(null)} onConfirm={h.handleDelete} isPending={h.deleteBackup.isPending} />}
            {h.restoreTarget && <RestoreModal backup={h.restoreTarget} onClose={() => h.setRestoreTarget(null)} onConfirm={h.handleRestore} isPending={h.restoreBackup.isPending} />}
            {h.showResetModal && <ResetModal onClose={h.handleResetClose} onConfirm={h.handleResetConfirm} isPending={h.resetInstance.isPending} result={h.resetResult} />}
        </div>
    );
}

function NoFilterMatch({ show }: { show: boolean }): JSX.Element | null {
    if (!show) return null;
    return <div className="py-12 text-center text-muted text-sm">No backups match the selected filter.</div>;
}

function BackupHeader({ onCreateBackup, isCreating }: { onCreateBackup: () => void; isCreating: boolean }): JSX.Element {
    return (
        <div className="flex items-start justify-between">
            <div>
                <h2 className="text-xl font-semibold text-foreground">Backups</h2>
                <p className="text-sm text-muted mt-1">Manage database backups. Daily backups run automatically at 2 AM with 30-day retention.</p>
            </div>
            <button onClick={onCreateBackup} disabled={isCreating}
                className="px-4 py-2 text-sm font-medium bg-accent/20 text-accent border border-accent/40 rounded-lg hover:bg-accent/30 transition-colors disabled:opacity-50 whitespace-nowrap">
                {isCreating ? 'Creating...' : 'Create Backup'}
            </button>
        </div>
    );
}

function FilterPills({ filter, setFilter, allBackups, dailyCount, migrationCount }: {
    filter: FilterType; setFilter: (f: FilterType) => void; allBackups: BackupFileDto[]; dailyCount: number; migrationCount: number;
}): JSX.Element | null {
    if (allBackups.length === 0) return null;
    const pills: { key: FilterType; label: string; count: number; badge?: string }[] = [
        { key: 'all', label: 'All', count: allBackups.length },
        { key: 'daily', label: 'Daily', count: dailyCount, badge: TYPE_BADGE.daily },
        { key: 'migration', label: 'Migration', count: migrationCount, badge: TYPE_BADGE.migration },
    ];
    return (
        <div className="flex items-center gap-2 flex-wrap">
            {pills.map((p) => (
                <button key={p.key} onClick={() => setFilter(filter === p.key && p.key !== 'all' ? 'all' : p.key)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                        filter === p.key ? (p.badge ?? 'bg-accent/20 text-accent border-accent/40') : 'bg-surface/50 text-muted border-edge hover:text-foreground'
                    }`}>
                    {p.label} ({p.count})
                </button>
            ))}
        </div>
    );
}

function BackupStates({ isLoading, isError, isEmpty, hasData }: { isLoading: boolean; isError: boolean; isEmpty: boolean; hasData: boolean }): JSX.Element | null {
    if (isLoading) return <div className="py-12 text-center text-muted text-sm">Loading backups...</div>;
    if (isError) return <div className="py-12 text-center text-red-400 text-sm">Failed to load backups. Please try again.</div>;
    if (hasData && isEmpty) return <div className="py-12 text-center text-muted text-sm">No backup files found. Backups are created automatically at 2 AM daily. You can also create one manually.</div>;
    return null;
}

function BackupTable({ filtered, tz, onRestore, onDelete }: {
    filtered: BackupFileDto[]; tz: string; onRestore: (b: BackupFileDto) => void; onDelete: (b: BackupFileDto) => void;
}): JSX.Element {
    return (
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
                        <BackupRow key={`${backup.type}/${backup.filename}`} backup={backup} tz={tz} onRestore={onRestore} onDelete={onDelete} />
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function BackupRow({ backup, tz, onRestore, onDelete }: { backup: BackupFileDto; tz: string; onRestore: (b: BackupFileDto) => void; onDelete: (b: BackupFileDto) => void }): JSX.Element {
    return (
        <tr className="hover:bg-surface/30 transition-colors">
            <td className="px-4 py-3"><span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full border ${TYPE_BADGE[backup.type]}`}>{backup.type}</span></td>
            <td className="px-4 py-3 font-mono text-xs text-foreground truncate max-w-[200px]">
                {backup.filename}
                <span className="sm:hidden block text-muted font-sans mt-0.5">{formatDate(backup.createdAt, tz)}</span>
            </td>
            <td className="px-4 py-3 text-muted hidden sm:table-cell">{formatDate(backup.createdAt, tz)}</td>
            <td className="px-4 py-3 text-muted hidden md:table-cell">{formatSize(backup.sizeBytes)}</td>
            <td className="px-4 py-3 text-right">
                <div className="flex items-center justify-end gap-2">
                    <button onClick={() => onRestore(backup)} className="px-3 py-1 text-xs font-medium text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg hover:bg-amber-500/20 transition-colors">Restore</button>
                    <button onClick={() => onDelete(backup)} className="px-3 py-1 text-xs font-medium text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg hover:bg-red-500/20 transition-colors">Delete</button>
                </div>
            </td>
        </tr>
    );
}

function DangerZone({ onShowResetModal }: { onShowResetModal: () => void }): JSX.Element {
    return (
        <div className="mt-8 border border-red-500/30 rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-red-500/5 border-b border-red-500/30">
                <h3 className="text-sm font-semibold text-red-400 uppercase tracking-wider">Danger Zone</h3>
            </div>
            <div className="p-4 flex items-center justify-between gap-4">
                <div>
                    <p className="text-sm font-medium text-foreground">Reset Instance</p>
                    <p className="text-xs text-muted mt-0.5">Wipe all data and return to factory defaults. A safety backup is created automatically.</p>
                </div>
                <button onClick={onShowResetModal} className="px-4 py-2 text-sm font-medium text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg hover:bg-red-500/20 transition-colors whitespace-nowrap">Reset Instance</button>
            </div>
        </div>
    );
}
