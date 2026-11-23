/**
 * ROK-2263 — clone access tokens (`rlbx_` backup-export tokens) for Admin → Backups.
 * Same `nativeFetch` style as `use-backups.ts`. The plaintext token only ever
 * travels in the mint response; callers keep it in component state, never here.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    BACKUP_EXPORT_TOKEN_LIVE_CAP,
    type BackupExportToken,
    type BackupExportTokenListResponse,
    type MintBackupExportTokenRequest,
    type MintBackupExportTokenResponse,
} from '@raid-ledger/contract';
import { API_BASE_URL } from '../lib/config';
import { getAuthToken } from './use-auth';
import { nativeFetch } from '../lib/api/native-fetch';

export const BACKUP_EXPORT_TOKENS_KEY = ['admin', 'backup-export-tokens'] as const;
export const BACKUP_EXPORT_TOKEN_CAP_CODE = 'backup_export_token_cap';

const CODE_MESSAGES: Record<string, string> = {
    [BACKUP_EXPORT_TOKEN_CAP_CODE]: `You already have ${BACKUP_EXPORT_TOKEN_LIVE_CAP} live tokens. Revoke one before making another.`,
    backup_export_token_not_found: 'That token no longer exists.',
};

/** A failed token request; `code` is the server's error code when it sent one. */
export class BackupExportTokenRequestError extends Error {
    readonly code: string | null;
    constructor(message: string, code: string | null) {
        super(message);
        this.code = code;
    }
}

async function requestError(response: Response, fallback: string): Promise<BackupExportTokenRequestError> {
    let code: string | null = null;
    try {
        const body: unknown = await response.json();
        if (body && typeof body === 'object' && 'code' in body && typeof body.code === 'string') code = body.code;
    } catch {
        // Unparseable body: the generic message is still right.
    }
    return new BackupExportTokenRequestError((code ? CODE_MESSAGES[code] : undefined) ?? fallback, code);
}

async function send(path: string, method: string, fallback: string, body?: unknown): Promise<Response> {
    const response = await nativeFetch(`${API_BASE_URL}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAuthToken() || ''}` },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw await requestError(response, fallback);
    return response;
}

export type BackupExportTokenStatus = 'live' | 'expired' | 'revoked';

/** Revoked wins over expired; a null expiry never expires. */
export function backupExportTokenStatus(token: BackupExportToken, now: number = Date.now()): BackupExportTokenStatus {
    if (token.revokedAt) return 'revoked';
    if (token.expiresAt && Date.parse(token.expiresAt) <= now) return 'expired';
    return 'live';
}

export function useBackupExportTokens() {
    return useQuery<BackupExportTokenListResponse>({
        queryKey: BACKUP_EXPORT_TOKENS_KEY,
        queryFn: async () => (await send('/admin/backup-export-tokens', 'GET', 'Failed to load clone access tokens')).json(),
        enabled: !!getAuthToken(),
        staleTime: 15_000,
    });
}

export function useMintBackupExportToken() {
    const queryClient = useQueryClient();
    return useMutation<MintBackupExportTokenResponse, BackupExportTokenRequestError, MintBackupExportTokenRequest>({
        mutationFn: async (body) => (await send('/admin/backup-export-tokens', 'POST', 'Failed to create the token', body)).json(),
        // The response carries the plaintext token: drop the mutation from the cache as soon as
        // its observer (the mint modal) unmounts, so the secret lives only in component state.
        gcTime: 0,
        onSettled: () => queryClient.invalidateQueries({ queryKey: BACKUP_EXPORT_TOKENS_KEY }),
    });
}

export function useRevokeBackupExportToken() {
    const queryClient = useQueryClient();
    return useMutation<void, BackupExportTokenRequestError, number>({
        mutationFn: async (id) => {
            await send(`/admin/backup-export-tokens/${id}`, 'DELETE', 'Failed to revoke the token');
        },
        onSettled: () => queryClient.invalidateQueries({ queryKey: BACKUP_EXPORT_TOKENS_KEY }),
    });
}
