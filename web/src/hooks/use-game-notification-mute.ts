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

interface MuteContext { previous: GameInterestResponseDto | undefined }

/**
 * The write half alone, for surfaces that already know the state (the
 * muted-games list on the settings page) and must not fetch each game's
 * interest just to unmute it.
 */
export function useGameNotificationMuteMutation(gameId: number | undefined) {
    const queryClient = useQueryClient();
    const viewer = useViewerCacheScope();
    const queryKey = gameInterestQueryKey(gameId, viewer);
    return useMutation<GameNotificationMuteResponseDto, Error, boolean, MuteContext>({
        mutationFn: (muted) =>
            fetchApi<GameNotificationMuteResponseDto>(`/games/${gameId}/notification-mute`, {
                method: muted ? 'POST' : 'DELETE',
            }),
        onMutate: async (muted) => {
            await queryClient.cancelQueries({ queryKey });
            const previous = queryClient.getQueryData<GameInterestResponseDto>(queryKey);
            if (previous) {
                queryClient.setQueryData<GameInterestResponseDto>(queryKey, {
                    ...previous, notificationsMuted: muted,
                });
            }
            return { previous };
        },
        onError: (_err, _muted, context) => {
            if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
            toast.error('Failed to update notifications for this game');
        },
        onSettled: () => {
            void queryClient.invalidateQueries({ queryKey });
            void queryClient.invalidateQueries({ queryKey: gameMutesQueryKey(viewer) });
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
