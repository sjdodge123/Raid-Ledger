import { useQuery } from "@tanstack/react-query";
import type { GameTasteProfileResponseDto } from "@raid-ledger/contract";
import { getGameTasteProfile } from "../lib/api/games-api";

/**
 * ROK-1082: Fetch a game's taste profile (radar vector + axis dimensions).
 * 5-minute staleTime matches the player-vector hook.
 */
export function useGameTasteProfile(gameId: number | undefined) {
    return useQuery<GameTasteProfileResponseDto>({
        queryKey: ["gameTasteProfile", gameId],
        queryFn: async () => {
            if (!gameId) throw new Error("Game ID required");
            return getGameTasteProfile(gameId);
        },
        enabled: !!gameId,
        staleTime: 5 * 60 * 1000,
        retry: false,
    });
}
