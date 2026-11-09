/**
 * ROK-2147 — the addon folders a character's LedgerLink export reported.
 * Visible only to the owner and officers of the character's guild; the
 * server answers `{ visible: false, installed: null }` to anyone else, and a
 * 401/403/404 lands as a query error — both leave the card as it was.
 * The key ends in the viewer scope (same rule as `guild-queries.ts`): the
 * answer differs per viewer.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { CharacterInstalledAddonsResponseSchema, type CharacterInstalledAddonsResponse } from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api-client';
import { useAuth, useViewerCacheScope } from '../../../hooks/use-auth';

const STALE_MS = 60_000;

export function installedAddonsPath(characterId: string): string {
    return `/plugins/wow/characters/${characterId}/installed-addons`;
}

export function useCharacterInstalledAddons(characterId: string | undefined): UseQueryResult<CharacterInstalledAddonsResponse, Error> {
    const { isAuthenticated } = useAuth();
    const viewer = useViewerCacheScope();
    return useQuery({
        queryKey: ['plugins', 'wow', 'characters', characterId, 'installed-addons', viewer],
        queryFn: () => fetchApi(installedAddonsPath(characterId ?? ''), {}, CharacterInstalledAddonsResponseSchema),
        enabled: isAuthenticated && !!characterId,
        staleTime: STALE_MS,
        retry: false,
    });
}
