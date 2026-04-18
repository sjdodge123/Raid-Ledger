import { useQuery } from "@tanstack/react-query";
import { getTasteProfile } from "../lib/api-client";
import type { TasteProfileResponseDto } from "@raid-ledger/contract";

/**
 * ROK-949: Fetch a user's taste profile (radar + intensity + co-play
 * partners). Mirrors the 5-minute staleTime used by `useUserProfile`.
 */
export function useTasteProfile(userId: number | undefined) {
    return useQuery<TasteProfileResponseDto>({
        queryKey: ["userTasteProfile", userId],
        queryFn: async () => {
            if (!userId) throw new Error("User ID required");
            return getTasteProfile(userId);
        },
        enabled: !!userId,
        staleTime: 5 * 60 * 1000,
        retry: false,
    });
}
