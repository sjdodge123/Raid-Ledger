import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import type { WowForeverRealmRulesetsDto } from '@raid-ledger/contract';
import { fetchForeverRealmRulesets, updateForeverRealmRulesets } from '../api-client';

export const FOREVER_REALM_RULESETS_KEY = ['admin', 'plugins', 'blizzard', 'forever-realm-rulesets'] as const;

/**
 * Admin WoW Forever realm → ruleset map (ROK-1739): the saved list and a
 * whole-list save. A save writes the server's (sorted) reply into the cache
 * and invalidates the query so every open editor re-reads it.
 */
export function useForeverRealmRulesets(): {
    rulesets: UseQueryResult<WowForeverRealmRulesetsDto>;
    save: UseMutationResult<WowForeverRealmRulesetsDto, Error, WowForeverRealmRulesetsDto>;
} {
    const queryClient = useQueryClient();
    const rulesets = useQuery({ queryKey: [...FOREVER_REALM_RULESETS_KEY], queryFn: fetchForeverRealmRulesets, staleTime: 30_000 });
    const save = useMutation<WowForeverRealmRulesetsDto, Error, WowForeverRealmRulesetsDto>({
        mutationFn: updateForeverRealmRulesets,
        onSuccess: (saved) => {
            queryClient.setQueryData([...FOREVER_REALM_RULESETS_KEY], saved);
            void queryClient.invalidateQueries({ queryKey: [...FOREVER_REALM_RULESETS_KEY] });
        },
    });
    return { rulesets, save };
}
