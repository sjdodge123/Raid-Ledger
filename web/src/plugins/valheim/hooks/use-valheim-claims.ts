/**
 * ROK-1836 L4 — claim + admin owner mutations and the claim-history query.
 * Every owner change invalidates the sheet, every list page and the history.
 */
import {
    useMutation,
    useQuery,
    useQueryClient,
    type QueryClient,
} from '@tanstack/react-query';
import type { ValheimClaimEvent } from '@raid-ledger/contract';
import { valheimArmoryKeys } from '../lib/valheim-armory-api';
import {
    assignValheimOwner,
    claimValheimCharacter,
    fetchValheimClaimEvents,
    valheimClaimKeys,
} from '../lib/valheim-armory-claims-api';
import { valheimMaterialsKeys } from './use-valheim-materials';
import { valheimRecipesKeys } from './use-valheim-recipes';

/** Refetch the sheet, every list page and the claim history for `id`. */
export async function invalidateOwnership(
    qc: QueryClient,
    id: number,
): Promise<void> {
    await Promise.all([
        qc.invalidateQueries({ queryKey: valheimArmoryKeys.detail(id) }),
        qc.invalidateQueries({
            queryKey: [...valheimArmoryKeys.all, 'characters'],
        }),
        qc.invalidateQueries({ queryKey: valheimClaimKeys.events(id) }),
        // ROK-1853 D9: personal chests follow the character's owner.
        qc.invalidateQueries({ queryKey: valheimMaterialsKeys.all }),
        // ROK-1854: the plan nets personal chests, which follow the owner too.
        qc.invalidateQueries({ queryKey: valheimRecipesKeys.all }),
    ]);
}

/** Claim a character as the signed-in member. Invalidates on success AND on error (a 409 means stale data). */
export function useClaimCharacter(id: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: () => claimValheimCharacter(id),
        onSettled: () => invalidateOwnership(qc, id),
    });
}

/** Admin: assign (`userId`) or remove (`null`) the owner. */
export function useAssignOwner(id: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (userId: number | null) =>
            assignValheimOwner(id, { userId }),
        onSettled: () => invalidateOwnership(qc, id),
    });
}

/** Admin: the character's owner-change audit trail (newest first); idle until `enabled`. */
export function useClaimEvents(id: number, enabled: boolean) {
    return useQuery<ValheimClaimEvent[]>({
        queryKey: valheimClaimKeys.events(id),
        queryFn: () => fetchValheimClaimEvents(id),
        enabled,
    });
}
