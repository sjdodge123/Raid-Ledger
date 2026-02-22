import { useQuery } from '@tanstack/react-query';
import { fetchWowRealms, previewWowCharacter } from '../api-client';

/**
 * Hook to fetch WoW realm list for a given region and game variant.
 * Cached for 1 hour since realms rarely change.
 */
export function useWowRealms(region: string, gameVariant?: string) {
    return useQuery({
        queryKey: ['blizzard', 'realms', region, gameVariant ?? 'retail'],
        queryFn: () => fetchWowRealms(region, gameVariant),
        staleTime: 1000 * 60 * 60, // 1 hour
        gcTime: 1000 * 60 * 120, // 2 hours
    });
}

/**
 * Hook to preview a WoW character from the Blizzard API.
 * Only fires when all three fields are filled and `enabled` is true.
 */
export function useCharacterPreview(
    name: string,
    realm: string,
    region: string,
    enabled: boolean,
    gameVariant?: string,
) {
    return useQuery({
        queryKey: ['blizzard', 'character-preview', region, realm, name, gameVariant ?? 'retail'],
        queryFn: () => previewWowCharacter(name, realm, region, gameVariant),
        enabled: enabled && !!name.trim() && !!realm.trim() && !!region,
        staleTime: 1000 * 60 * 5, // 5 minutes
        retry: false,
    });
}
