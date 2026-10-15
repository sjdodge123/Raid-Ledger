/**
 * Per-game notification mute ("bell off", ROK-1797) — independent of the heart.
 *
 * The state is read from the game-interest query (`notificationsMuted`), the
 * same cache entry `useWantToPlay` fills, so the page makes no extra request.
 * The toggle is optimistic on that entry and rolls back on error; settling
 * invalidates it and the viewer's muted-games list. Both keys are
 * viewer-scoped (`game-interest-query-key.ts`).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
    GameInterestResponseDto,
    GameNotificationMuteResponseDto,
} from '@raid-ledger/contract';
import { fetchApi } from '../lib/api/fetch-api';
import { toast } from '../lib/toast';
import { getAuthToken, useViewerCacheScope } from './use-auth';
import { gameInterestQueryKey, gameMutesQueryKey } from './game-interest-query-key';

/**
 * The keys are pinned at `onMutate` and carried in the context, so a viewer
 * switch (admin impersonation) while the request is in flight cannot make the
 * rollback write one viewer's snapshot into another viewer's cache.
 */
interface MuteContext {
    previous: GameInterestResponseDto | undefined;
    interestKey: ReturnType<typeof gameInterestQueryKey>;
    mutesKey: ReturnType<typeof gameMutesQueryKey>;
}

/**
 * The write half alone, for surfaces that already know the state (the
 * muted-games list on the settings page) and must not fetch each game's
 * interest just to unmute it.
 */
export function useGameNotificationMuteMutation(gameId: number | undefined) {
    const queryClient = useQueryClient();
    const viewer = useViewerCacheScope();
    return useMutation<GameNotificationMuteResponseDto, Error, boolean, MuteContext>({
        mutationFn: (muted) =>
            fetchApi<GameNotificationMuteResponseDto>(`/games/${gameId}/notification-mute`, {
                method: muted ? 'POST' : 'DELETE',
            }),
        onMutate: async (muted) => {
            const interestKey = gameInterestQueryKey(gameId, viewer);
            const mutesKey = gameMutesQueryKey(viewer);
            await queryClient.cancelQueries({ queryKey: interestKey });
            const previous = queryClient.getQueryData<GameInterestResponseDto>(interestKey);
            if (previous) {
                queryClient.setQueryData<GameInterestResponseDto>(interestKey, {
                    ...previous, notificationsMuted: muted,
                });
            }
            return { previous, interestKey, mutesKey };
        },
        onError: (_err, _muted, context) => {
            if (context?.previous) queryClient.setQueryData(context.interestKey, context.previous);
            toast.error('Failed to update notifications for this game');
        },
        onSettled: (_data, _err, _muted, context) => {
            if (!context) return;
            void queryClient.invalidateQueries({ queryKey: context.interestKey });
            void queryClient.invalidateQueries({ queryKey: context.mutesKey });
        },
    });
}

/** Read + toggle the viewer's mute for one game. */
export function useGameNotificationMute(gameId: number | undefined) {
    const viewer = useViewerCacheScope();
    const interest = useQuery<GameInterestResponseDto>({
        queryKey: gameInterestQueryKey(gameId, viewer),
        queryFn: () => fetchApi<GameInterestResponseDto>(`/games/${gameId}/interest`),
        enabled: !!gameId && !!getAuthToken(),
        staleTime: 1000 * 60 * 5,
    });
    const mutation = useGameNotificationMuteMutation(gameId);
    return {
        muted: interest.data?.notificationsMuted ?? false,
        isReady: interest.isSuccess,
        isPending: mutation.isPending,
        setMuted: (muted: boolean) => mutation.mutate(muted),
    };
}
