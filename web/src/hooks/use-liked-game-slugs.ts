import { useMemo } from 'react';
import { useAuth } from './use-auth';
import { useUserHeartedGames } from './use-user-profile';

/**
 * Returns a Set of game slugs the current user has hearted.
 * Returns an empty Set when not authenticated or still loading.
 */
export function useLikedGameSlugs(): Set<string> {
    const { user } = useAuth();
    const { data: heartedData } = useUserHeartedGames(user?.id);

    return useMemo(() => {
        if (!heartedData?.data) return new Set<string>();
        return new Set(heartedData.data.map((g) => g.slug));
    }, [heartedData]);
}
