/**
 * ROK-1756 — admin "Unlink character": `POST /admin/plugins/wow/characters/:id/unlink`
 * DELETES a LedgerLink GUID-linked character (a squat holds the name, so
 * detaching the GUID alone is not enough) so the rightful owner can re-import.
 * The API answers 409 for a character with no GUID and 404 for an unknown id.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchApi } from '../../../lib/api-client';

/** Response of the unlink endpoint (api `AddonCharacterUnlinkResult`); never carries the GUID. */
export interface AddonCharacterUnlinkResult {
    characterId: string;
    userId: number;
}

export function unlinkAddonCharacter(characterId: string): Promise<AddonCharacterUnlinkResult> {
    return fetchApi(`/admin/plugins/wow/characters/${characterId}/unlink`, { method: 'POST' });
}

/** Invalidates every character view the deleted character could appear in. */
export function useUnlinkAddonCharacter() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (characterId: string) => unlinkAddonCharacter(characterId),
        onSuccess: (result) => {
            queryClient.removeQueries({ queryKey: ['characters', result.characterId] });
            void queryClient.invalidateQueries({ queryKey: ['characters'] });
            void queryClient.invalidateQueries({ queryKey: ['me', 'characters'] });
            void queryClient.invalidateQueries({ queryKey: ['userProfile'] });
        },
    });
}
