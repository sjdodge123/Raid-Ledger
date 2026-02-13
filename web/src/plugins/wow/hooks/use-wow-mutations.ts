import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '../../../lib/toast';
import { importWowCharacter, refreshCharacterFromArmory } from '../api-client';
import type { ImportWowCharacterInput, RefreshCharacterInput } from '@raid-ledger/contract';

/**
 * Mutation hook for importing a WoW character from Blizzard Armory (ROK-234).
 * Importing with isMain=true triggers a server-side swap, so invalidate
 * all character-related caches to reflect the new main across views.
 */
export function useImportWowCharacter() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (dto: ImportWowCharacterInput) => importWowCharacter(dto),
        onSuccess: () => {
            toast.success('Character imported from Armory!');
            queryClient.invalidateQueries({ queryKey: ['me', 'characters'] });
            queryClient.invalidateQueries({ queryKey: ['characters'] });
            queryClient.invalidateQueries({ queryKey: ['userProfile'] });
        },
        onError: (error: Error) => {
            toast.error(error.message || 'Failed to import character');
        },
    });
}

/**
 * Mutation hook for refreshing a character from Blizzard Armory (ROK-234).
 */
export function useRefreshCharacterFromArmory() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ id, dto }: { id: string; dto: RefreshCharacterInput }) =>
            refreshCharacterFromArmory(id, dto),
        onSuccess: (_data, variables) => {
            toast.success('Character refreshed from Armory!');
            queryClient.invalidateQueries({ queryKey: ['me', 'characters'] });
            queryClient.invalidateQueries({ queryKey: ['characters', variables.id] });
        },
        onError: (error: Error) => {
            toast.error(error.message || 'Failed to refresh character');
        },
    });
}
