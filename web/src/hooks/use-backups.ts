import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { BackupFileDto, BackupListResponseDto } from '@raid-ledger/contract';
import { API_BASE_URL } from '../lib/config';
import { getAuthToken } from './use-auth';

function backupHeaders(): Record<string, string> {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${getAuthToken() || ''}` };
}

async function backupFetch<T>(path: string, method = 'GET', errorMsg = 'Request failed'): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${path}`, { method, headers: backupHeaders() });
    if (!response.ok) throw new Error(errorMsg);
    return response.json();
}

function useBackupQuery() {
    return useQuery<BackupListResponseDto>({
        queryKey: ['admin', 'backups'],
        queryFn: () => backupFetch('/admin/backups', 'GET', 'Failed to fetch backups'),
        enabled: !!getAuthToken(),
        staleTime: 15_000,
    });
}

function useBackupMutations() {
    const queryClient = useQueryClient();
    const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin', 'backups'] });

    const createBackup = useMutation({
        mutationFn: () => backupFetch<{ success: boolean; message: string; backup: BackupFileDto }>('/admin/backups', 'POST', 'Failed to create backup'),
        onSuccess: invalidate,
    });

    const deleteBackup = useMutation({
        mutationFn: ({ type, filename }: { type: string; filename: string }) =>
            backupFetch<{ success: boolean; message: string }>(`/admin/backups/${type}/${encodeURIComponent(filename)}`, 'DELETE', 'Failed to delete backup'),
        onSuccess: invalidate,
    });

    const restoreBackup = useMutation({
        mutationFn: ({ type, filename }: { type: string; filename: string }) =>
            backupFetch<{ success: boolean; message: string }>(`/admin/backups/${type}/${encodeURIComponent(filename)}/restore`, 'POST', 'Failed to restore backup'),
        onSuccess: invalidate,
    });

    const resetInstance = useMutation({
        mutationFn: () => backupFetch<{ success: boolean; message: string; password: string }>('/admin/backups/reset-instance', 'POST', 'Failed to reset instance'),
    });

    return { createBackup, deleteBackup, restoreBackup, resetInstance };
}

export function useBackups() {
    const backups = useBackupQuery();
    return { backups, ...useBackupMutations() };
}
