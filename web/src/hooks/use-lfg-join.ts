/**
 * Raising a hand for a game (ROK-1453).
 *
 * Shared by every surface that can create an intent — the cold-start prompt
 * today, ROK-1464's group page next — so that they all invalidate the same
 * cache prefix. `['lfg']` covers the group list behind the tile chips, the
 * events banner count, the per-game detail read and the hearted list the
 * prompt itself is built from (the server drops a game from that list once the
 * caller holds a live intent on it).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createIntent } from '../lib/api/lfg-api';
import { toast } from '../lib/toast';

/**
 * Mutation that posts `POST /lfg` for a game id and refreshes every LFG read.
 *
 * @param onJoined - Called with the game id after the intent is created, for
 *   surfaces that want to confirm the action inline.
 */
export function useJoinGroup(onJoined?: (gameId: number) => void) {
    const queryClient = useQueryClient();

    return useMutation<void, Error, number>({
        mutationFn: async (gameId: number) => {
            await createIntent(gameId);
        },
        onSuccess: (_data, gameId) => {
            queryClient.invalidateQueries({ queryKey: ['lfg'] });
            onJoined?.(gameId);
        },
        onError: () => toast.error('Failed to join the group'),
    });
}
