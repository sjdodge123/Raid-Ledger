/**
 * ROK-1750: private poll share links — preview (public), join (redeem) and
 * reset (creator / admin). Reset invalidates the poll-page query so the new
 * token shows at once.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getPollSharePreview, joinPollShare, resetPollShareToken } from '../lib/api-client';
import { toast } from '../lib/toast';

/** Public preview for `/p/poll/:token`. A 404 (unknown / reset token) is not retried. */
export function usePollSharePreview(token: string | undefined) {
    return useQuery({
        queryKey: ['poll-share', 'preview', token],
        queryFn: () => getPollSharePreview(token ?? ''),
        enabled: !!token,
        retry: false,
    });
}

/** Redeem a share link for the signed-in viewer. */
export function useJoinPollShare() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (token: string) => joinPollShare(token),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ['standalone-polls'] });
            void queryClient.invalidateQueries({ queryKey: ['scheduling'] });
        },
    });
}

/** Rotate the share token; the old link stops working at once. */
export function useResetPollShareToken() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (matchId: number) => resetPollShareToken(matchId),
        onSuccess: () => {
            toast.success('New link created. The old link no longer works.');
            void queryClient.invalidateQueries({ queryKey: ['lineups'] });
            void queryClient.invalidateQueries({ queryKey: ['scheduling'] });
        },
        onError: (error: Error) => {
            toast.error(error.message || 'Failed to reset the link');
        },
    });
}
