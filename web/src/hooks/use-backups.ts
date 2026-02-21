import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { BackupFileDto, BackupListResponseDto } from '@raid-ledger/contract';
import { API_BASE_URL } from '../lib/config';
import { getAuthToken } from './use-auth';

export function useBackups() {
    const queryClient = useQueryClient();

    const getHeaders = () => ({
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getAuthToken() || ''}`,
    });

    const backups = useQuery<BackupListResponseDto>({
        queryKey: ['admin', 'backups'],
        queryFn: async () => {
            const response = await fetch(`${API_BASE_URL}/admin/backups`, {
                headers: getHeaders(),
            });
            if (!response.ok) throw new Error('Failed to fetch backups');
            return response.json();
        },
        enabled: !!getAuthToken(),
        staleTime: 15_000,
    });

    const createBackup = useMutation<
        { success: boolean; message: string; backup: BackupFileDto },
        Error
    >({
        mutationFn: async () => {
            const response = await fetch(`${API_BASE_URL}/admin/backups`, {
                method: 'POST',
                headers: getHeaders(),
            });
            if (!response.ok) throw new Error('Failed to create backup');
            return response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'backups'] });
        },
    });

    const deleteBackup = useMutation<
        { success: boolean; message: string },
        Error,
        { type: string; filename: string }
    >({
        mutationFn: async ({ type, filename }) => {
            const response = await fetch(
                `${API_BASE_URL}/admin/backups/${type}/${encodeURIComponent(filename)}`,
                { method: 'DELETE', headers: getHeaders() },
            );
            if (!response.ok) throw new Error('Failed to delete backup');
            return response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'backups'] });
        },
    });

    const restoreBackup = useMutation<
        { success: boolean; message: string },
        Error,
        { type: string; filename: string }
    >({
        mutationFn: async ({ type, filename }) => {
            const response = await fetch(
                `${API_BASE_URL}/admin/backups/${type}/${encodeURIComponent(filename)}/restore`,
                { method: 'POST', headers: getHeaders() },
            );
            if (!response.ok) throw new Error('Failed to restore backup');
            return response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'backups'] });
        },
    });

    return { backups, createBackup, deleteBackup, restoreBackup };
}
