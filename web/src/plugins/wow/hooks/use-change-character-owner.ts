/**
 * ROK-2128 — admin "Change owner": `PUT /admin/plugins/wow/characters/:id/owner`
 * moves a WoW character to another member (AdminGuard on the API). The API
 * answers 409 when the target already owns that name/identity and 404 for an
 * unknown character or user.
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { AdminCharacterOwnerRequestDto, AdminCharacterOwnerResultDto } from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api-client';

/** Calls the admin reassign endpoint for one character. */
export function changeCharacterOwner(characterId: string, body: AdminCharacterOwnerRequestDto): Promise<AdminCharacterOwnerResultDto> {
    return fetchApi(`/admin/plugins/wow/characters/${characterId}/owner`, {
        method: 'PUT',
        body: JSON.stringify(body),
    });
}

interface ChangeOwnerVars {
    characterId: string;
    userId: number;
}

/** Reassigns a character and refreshes every view that lists it under either owner. */
export function useChangeCharacterOwner(): UseMutationResult<AdminCharacterOwnerResultDto, Error, ChangeOwnerVars> {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ characterId, userId }: ChangeOwnerVars) => changeCharacterOwner(characterId, { userId }),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ['characters'] });
            void queryClient.invalidateQueries({ queryKey: ['me', 'characters'] });
            void queryClient.invalidateQueries({ queryKey: ['userProfile'] });
        },
    });
}
