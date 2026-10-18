/**
 * Valheim Link admin tokens (ROK-1833): one list query for the whole Pelican
 * table, plus issue / rotate / revoke mutations. The raw token only ever lives
 * in the caller's component state: the mutations keep no cache entry
 * (`gcTime: 0`), the list cache stores only the token-free status, and nothing
 * here logs a response.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import {
    ValheimLinkTokenIssuedSchema,
    ValheimLinkTokenListResponseSchema,
    ValheimLinkTokenStatusSchema,
    type ValheimLinkTokenIssued,
    type ValheimLinkTokenStatus,
} from '@raid-ledger/contract';
import { getAuthToken } from '../../../hooks/use-auth';
import { adminFetch } from '../../../hooks/admin/admin-fetch';
import { toast } from '../../../lib/toast';

export const VALHEIM_LINK_TOKENS_PATH = '/admin/plugins/valheim/link-tokens';
export const VALHEIM_LINK_TOKENS_KEY = ['admin', 'plugins', 'valheim', 'link-tokens'] as const;

/** Status of every Valheim-mapped Pelican server. A refusal (plugin inactive) is an error, not a retry. */
export function useValheimLinkTokens(): UseQueryResult<ValheimLinkTokenStatus[]> {
    return useQuery<ValheimLinkTokenStatus[]>({
        queryKey: [...VALHEIM_LINK_TOKENS_KEY],
        queryFn: async () => ValheimLinkTokenListResponseSchema.parse(
            await adminFetch(VALHEIM_LINK_TOKENS_PATH, undefined, 'Failed to load mod tokens')).data,
        enabled: !!getAuthToken(),
        retry: false,
        staleTime: 30_000,
    });
}

/** Replace one server's status in the list cache — the status only, never the token. */
function useStoreStatus(): (status: ValheimLinkTokenStatus) => void {
    const qc = useQueryClient();
    return (status) => {
        qc.setQueryData<ValheimLinkTokenStatus[]>([...VALHEIM_LINK_TOKENS_KEY], (rows) =>
            rows?.map((r) => (r.pelicanServerId === status.pelicanServerId ? status : r)));
    };
}

export interface IssueVars { pelicanServerId: number; rotate: boolean }

/** Generate (`POST /:id`) or rotate (`POST /:id/rotate`). Resolves with the one response carrying the token. */
export function useIssueValheimLinkToken() {
    const store = useStoreStatus();
    return useMutation<ValheimLinkTokenIssued, Error, IssueVars>({
        mutationFn: async ({ pelicanServerId, rotate }) => {
            const path = `${VALHEIM_LINK_TOKENS_PATH}/${pelicanServerId}${rotate ? '/rotate' : ''}`;
            const body = await adminFetch(path, { method: 'POST', body: JSON.stringify({}) }, 'Failed to issue the token');
            return ValheimLinkTokenIssuedSchema.parse(body);
        },
        gcTime: 0,
        onSuccess: (issued) => store(issued.status),
    });
}

/** Revoke (`DELETE /:id`) — the one success that toasts. */
export function useRevokeValheimLinkToken() {
    const store = useStoreStatus();
    return useMutation<ValheimLinkTokenStatus, Error, number>({
        mutationFn: async (pelicanServerId) => ValheimLinkTokenStatusSchema.parse(await adminFetch(
            `${VALHEIM_LINK_TOKENS_PATH}/${pelicanServerId}`, { method: 'DELETE' }, 'Failed to revoke the token')),
        onSuccess: (status) => { store(status); toast.success('Mod token revoked'); },
    });
}
